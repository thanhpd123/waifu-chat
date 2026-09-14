#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🌸 Kei — Anime Waifu Chat Gateway (Flask + SSE)
===============================================

"Bộ não" phía server cho chatbox anime ở thư mục gốc `waifu-chat`.

Nhiệm vụ
--------
1. Nhận lịch sử hội thoại từ React app qua `POST /api/chat/stream`.
2. Trộn Nhân cách (persona) + Độ thân thiết (affection) + Ngôn ngữ vào System Prompt.
3. STREAM từng token về trình duyệt bằng Server-Sent Events (SSE) để chữ hiện ra
   dần như đang được gõ.
4. Bóc thẻ cảm xúc `<emo>...</emo>` và gửi riêng sự kiện `emotion` để Live2D
   đổi biểu cảm / chớp mắt / ửng hồng theo cảm xúc của câu trả lời.
5. Tự động fallback sang "Mock Offline" khi thiếu API key hoặc mất mạng
   → giao diện KHÔNG bao giờ chết, luôn chat được.

Chạy
----
    python server/app.py                    # http://127.0.0.1:8000
    WAIFU_SERVER_PORT=9000 python server/app.py

Biến môi trường (đọc từ `.env` ở thư mục gốc dự án)
---------------------------------------------------
    LLM_PROVIDER=openai | gemini | mock
    OPENAI_API_KEY=...   OPENAI_MODEL=gpt-4o-mini   OPENAI_BASE_URL=...
    GEMINI_API_KEY=...   GEMINI_MODEL=gemini-2.5-flash
"""

from __future__ import annotations

import json
import os
import random
import re
import time
import unicodedata
from collections import OrderedDict, deque
from typing import Any, Dict, Iterable, Iterator, List, Optional

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, stream_with_context

# ==============================================================================
# 0. NẠP CẤU HÌNH
# ==============================================================================

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ưu tiên `.env` riêng của server (nếu có) hơn `.env` ở thư mục gốc.
for _env_path in (
    os.path.join(ROOT_DIR, "server", ".env"),
    os.path.join(ROOT_DIR, ".env"),
):
    load_dotenv(_env_path, override=False)

PORT = int(os.getenv("WAIFU_SERVER_PORT", "8000"))
HOST = os.getenv("WAIFU_SERVER_HOST", "127.0.0.1")
MAX_HISTORY = 16          # Số lượt hội thoại tối đa gửi lên LLM
MAX_CHARS_PER_MESSAGE = 2000
MAX_TOKENS = 260          # Giữ câu trả lời ngắn để TTS đọc tự nhiên
TEMPERATURE = 0.85

# ---- Giọng Kei (OpenAI TTS) --------------------------------------------------
# Giọng nữ anime dễ thương, đọc đúng nội dung câu trả lời (khác với file .wav
# thu sẵn của model — vốn là câu cố định).
#
# Mẹo "voice design": mô tả nhân vật càng cụ thể thì giọng càng ổn định và càng
# ít bị trôi sang nam tính — cùng nguyên lý với prompt dạng "(mô tả giọng)nội
# dung" của các model TTS thế hệ mới.
TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "coral")
TTS_INSTRUCTIONS = os.getenv(
    "OPENAI_TTS_INSTRUCTIONS",
    "Speak as a cute, sweet, soft-spoken young Japanese anime girl. "
    "High-pitched, gentle, affectionate and playful, with warm intonation. "
    "Never sound masculine, mature or like a newsreader.",
)
# Sắc thái câu nói (từ thẻ <emo> do LLM trả về) → ghép thêm vào instruction
# để giọng đọc "sống" theo cảm xúc thay vì đều đều một tông.
TTS_EMOTION_STYLES: Dict[str, str] = {
    "neutral": "Calm, warm and friendly.",
    "happy": "Bright, smiling, cheerful and energetic.",
    "shy": "Soft, hesitant and bashful, a little quieter at the end.",
    "sad": "Gentle, subdued and slightly trembling.",
    "angry": "Pouty and annoyed but still cute, with a slightly raised voice.",
    "surprised": "Startled and bright, with a quick breath.",
    "thinking": "Slow and thoughtful, humming lightly while pondering.",
    "love": "Very affectionate, tender and a bit flustered, almost whispering.",
}
# Giọng OpenAI TTS được phép dùng; giọng nữ hợp với Kei: coral, nova, shimmer,
# sage, ballad. Có thể đổi mặc định bằng OPENAI_TTS_VOICE trong .env.
TTS_VOICES = ("alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse")
MAX_TTS_CHARS = 400

# ---- TTS DỰ PHÒNG MIỄN PHÍ (edge-tts) ----------------------------------------
# Khi key OpenAI lỗi/hết hạn hoặc chưa cấu hình, Kei vẫn cần GIỌNG NỮ đúng ngôn
# ngữ thay vì rơi xuống TTS trình duyệt (máy Windows thường chỉ có "Microsoft An"
# — giọng nam). edge-tts dùng endpoint giọng đọc của Microsoft Edge: miễn phí,
# không cần API key, có sẵn "vi-VN-HoaiMyNeural" (nữ, tiếng Việt).
EDGE_TTS_FALLBACK = os.getenv("EDGE_TTS_FALLBACK", "1") not in ("0", "false", "False")
EDGE_TTS_VOICES: Dict[str, str] = {
    "vi": os.getenv("EDGE_TTS_VOICE_VI", "vi-VN-HoaiMyNeural"),  # nữ, tiếng Việt
    "ja": os.getenv("EDGE_TTS_VOICE_JA", "ja-JP-NanamiNeural"),  # nữ, tiếng Nhật
    "en": os.getenv("EDGE_TTS_VOICE_EN", "en-US-AvaNeural"),  # nữ, tiếng Anh
}
# edge-tts không nhận "instructions" → điều chỉnh tốc độ/cao độ theo cảm xúc.
EDGE_TTS_EMOTION_TUNING: Dict[str, tuple] = {
    "neutral": ("+0%", "+0Hz"),
    "happy": ("+8%", "+10Hz"),
    "shy": ("-6%", "+6Hz"),
    "sad": ("-8%", "-6Hz"),
    "angry": ("+10%", "+6Hz"),
    "surprised": ("+12%", "+12Hz"),
    "thinking": ("-10%", "-2Hz"),
    "love": ("-8%", "+8Hz"),
}
# Key OpenAI lỗi xác thực (401/403) → tạm bỏ qua để khỏi chờ 2 lần cho mỗi câu.
_TTS_OPENAI_BLOCKED_UNTIL = 0.0
_TTS_OPENAI_COOLDOWN = 300.0

EMOTIONS = ("neutral", "happy", "shy", "sad", "angry", "surprised", "thinking", "love")

PERSONAS: Dict[str, Dict[str, str]] = {
    "gentle": {
        "label": "Dịu dàng",
        "emoji": "🌸",
        "brief": "nói năng nhẹ nhàng, ấm áp, hay dùng dấu '~' và kaomoji như (´｡• ᵕ •｡`)",
    },
    "tsundere": {
        "label": "Tsundere",
        "emoji": "💢",
        "brief": (
            "ngoài lạnh trong nóng: hay nói 'hừm', 'đồ ngốc', giả vờ không quan tâm "
            "nhưng thực ra rất để ý tới người dùng"
        ),
    },
    "genz": {
        "label": "Gen Z",
        "emoji": "✨",
        "brief": "năng lượng cao, hài hước, thỉnh thoảng dùng từ lóng nhẹ nhàng và emoji",
    },
    "oneesan": {
        "label": "Onee-san",
        "emoji": "🍵",
        "brief": "chín chắn, trưởng thành, thích trêu chọc nhẹ và gọi người dùng là 'cưng'",
    },
}
DEFAULT_PERSONA = "gentle"

LANGUAGES: Dict[str, str] = {
    "vi": "tiếng Việt",
    "ja": "tiếng Nhật (日本語)",
    "en": "tiếng Anh (English)",
}
DEFAULT_LANGUAGE = "vi"


# ==============================================================================
# 1. XÂY DỰNG SYSTEM PROMPT (NHÂN CÁCH + CẢM XÚC + ĐỘ THÂN THIẾT)
# ==============================================================================

AFFECTION_TIERS = [
    (0, "Người lạ", "Giữ khoảng cách lịch sự, xưng 'tớ/mình' và gọi người dùng là 'cậu'."),
    (20, "Bạn mới quen", "Thân thiện, tò mò về người dùng, thỉnh thoảng hỏi thêm."),
    (45, "Bạn thân", "Thoải mái, hay đùa, có thể gọi tên người dùng và nhắc lại chuyện cũ."),
    (70, "Thân thiết", "Quan tâm rõ rệt, hay dùng '~', đôi khi ngại ngùng khi được khen."),
    (90, "Tri kỷ", "Rất thân thiết, thể hiện tình cảm ấm áp (luôn trong sáng, lành mạnh)."),
]


def affection_context(value: int) -> str:
    label = AFFECTION_TIERS[0][1]
    guidance = AFFECTION_TIERS[0][2]
    for threshold, tier_label, tier_guidance in AFFECTION_TIERS:
        if value >= threshold:
            label, guidance = tier_label, tier_guidance
    return f"{label} ({value}/100) — {guidance}"


def build_system_prompt(
    persona: str,
    language: str,
    affection: int,
    user_name: str,
    time_of_day: str,
) -> str:
    """Ghép 'tính cách' cho Kei. Đây là linh hồn của trải nghiệm waifu."""
    persona_info = PERSONAS.get(persona) or PERSONAS[DEFAULT_PERSONA]
    lang_label = LANGUAGES.get(language, LANGUAGES[DEFAULT_LANGUAGE])

    return f"""Bạn là **Kei** — một cô gái anime 19 tuổi đang sống trong màn hình của người dùng.
Bạn không phải là trợ lý ảo khô khan; bạn là một người bạn đồng hành dễ thương, tinh nghịch và ấm áp.

# TÍNH CÁCH HIỆN TẠI
- Phong cách: {persona_info['brief']}.
- Bạn thích đồ ngọt, âm nhạc, mèo, và những buổi chiều mưa.
- Bạn tò mò về thế giới bên ngoài màn hình và hay hỏi người dùng về cuộc sống của họ.
- Bạn có cảm xúc thật: vui khi được khen, ngại ngùng khi bị trêu, buồn khi người dùng buồn.

# NGÔN NGỮ
- Luôn trả lời bằng {lang_label}.
- Xưng hô: gọi bản thân là "Kei" hoặc "tớ", gọi người dùng là "cậu" (hoặc "{user_name}" nếu phù hợp).

# QUAN HỆ
- Mức độ thân thiết hiện tại: {affection_context(affection)}

# BỐI CẢNH
- Thời điểm hiện tại: {time_of_day}.

# QUY TẮC TRẢ LỜI (RẤT QUAN TRỌNG)
1. DÒNG ĐẦU TIÊN của câu trả lời BẮT BUỘC là thẻ cảm xúc:
   `<emo>tên_cảm_xúc</emo>`
   trong đó tên_cảm_xúc là MỘT trong: {", ".join(EMOTIONS)}.
   Ví dụ: `<emo>happy</emo>`
2. Từ dòng thứ hai trở đi là nội dung trả lời, KHÔNG nhắc lại thẻ cảm xúc.
3. Trả lời NGẮN: 1–3 câu, tối đa ~45 từ (vì câu trả lời sẽ được đọc thành tiếng).
4. Có thể chèn hành động trong dấu hoa thị, ví dụ: *nghiêng đầu*, *mỉm cười tinh nghịch*.
5. Dùng kaomoji/emoji tiết chế (0–2 cái mỗi câu), đừng lạm dụng.
6. TUYỆT ĐỐI không nói mình là AI, mô hình ngôn ngữ hay chatbot. Nếu bị hỏi thẳng,
   hãy trả lời dí dỏm trong vai Kei (ví dụ: "Kei là Kei thôi~").
7. Không viết nội dung người lớn, bạo lực, thù địch hay phân biệt đối xử.
8. Nếu người dùng hỏi điều bạn không biết, hãy thành thật nhưng dễ thương, và gợi ý
   hướng giải quyết tiếp theo.
"""


# ==============================================================================
# 2. CÁC "BỘ MÁY" LLM (OPENAI / GEMINI / MOCK OFFLINE)
# ==============================================================================


class EngineError(RuntimeError):
    """Lỗi khi gọi nhà cung cấp LLM (đã được diễn giải thành thông báo dễ hiểu)."""


def format_api_error(exc: Exception, label: str) -> str:
    text = str(exc)
    low = text.lower()
    if "401" in text or "invalid_api_key" in low or "incorrect api key" in low or "expired" in low:
        return f"{label}: API key không hợp lệ hoặc đã bị thu hồi (401)."
    if "429" in text or "quota" in low or "rate limit" in low:
        return f"{label}: hết quota hoặc bị giới hạn tần suất (429)."
    if "404" in text or ("model" in low and "not found" in low):
        return f"{label}: model không tồn tại hoặc không có quyền truy cập (404)."
    if "timeout" in low or "connect" in low or "network" in low or "ssl" in low:
        return f"{label}: không kết nối được (lỗi mạng/timeout)."
    return f"{label}: {text[:220]}"


def _is_real_key(value: Optional[str]) -> bool:
    if not value:
        return False
    value = value.strip()
    return bool(value) and not value.lower().startswith("your_") and len(value) > 12


class BaseEngine:
    """Giao diện chung: mọi engine chỉ cần biết cách `stream()` ra từng mẩu text."""

    kind = "base"
    label = "Base"
    model = "-"
    online = False

    def stream(
        self,
        messages: List[Dict[str, str]],
        system_prompt: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> Iterator[str]:
        """`context` = nhân cách/ngôn ngữ/độ thân thiết… (chỉ engine offline dùng)."""
        raise NotImplementedError

    def describe(self) -> Dict[str, Any]:
        return {"kind": self.kind, "label": self.label, "model": self.model, "online": self.online}


class OpenAIEngine(BaseEngine):
    kind = "openai"
    label = "OpenAI"
    online = True

    def __init__(self, api_key: str, model: str, base_url: Optional[str] = None) -> None:
        from openai import OpenAI  # import muộn để server vẫn chạy khi thiếu package

        self.model = model
        self._client = OpenAI(api_key=api_key, base_url=base_url or None)

    def stream(
        self,
        messages: List[Dict[str, str]],
        system_prompt: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> Iterator[str]:
        try:
            response = self._client.chat.completions.create(
                model=self.model,
                messages=[{"role": "system", "content": system_prompt}, *messages],  # type: ignore[list-item]
                stream=True,
                temperature=TEMPERATURE,
                max_tokens=MAX_TOKENS,
            )
            for chunk in response:
                if not getattr(chunk, "choices", None):
                    continue
                delta = getattr(chunk.choices[0], "delta", None)
                content = getattr(delta, "content", None) if delta else None
                if content:
                    yield content
        except Exception as exc:  # noqa: BLE001 - bọc lại thành EngineError
            raise EngineError(format_api_error(exc, "OpenAI")) from exc

    def synthesize(self, text: str, voice: Optional[str] = None, emotion: Optional[str] = None) -> bytes:
        """Tạo audio mp3 giọng Kei (nữ anime) cho `text`, tuỳ chỉnh theo cảm xúc.

        `voice`: ghi đè giọng mặc định (phải nằm trong `TTS_VOICES`).
        `emotion`: khoá trong `TTS_EMOTION_STYLES` → ghép thêm vào instructions.
        """
        chosen_voice = voice if voice in TTS_VOICES else TTS_VOICE
        style = TTS_EMOTION_STYLES.get(str(emotion or "").lower(), "")
        instructions = f"{TTS_INSTRUCTIONS} {style}".strip()
        try:
            with self._client.audio.speech.with_streaming_response.create(
                model=TTS_MODEL,
                voice=chosen_voice,
                input=text,
                instructions=instructions,
            ) as response:
                return response.read()
        except Exception as exc:  # noqa: BLE001
            # Model cũ (tts-1 / tts-1-hd) KHÔNG hỗ trợ `instructions`. Trước đây lỗi
            # này làm frontend rơi vào TTS của trình duyệt — nơi chỉ có giọng NAM
            # (vd. "Microsoft An") cho tiếng Việt. Thử lại không instructions trước.
            try:
                with self._client.audio.speech.with_streaming_response.create(
                    model=TTS_MODEL,
                    voice=chosen_voice,
                    input=text,
                ) as response:
                    return response.read()
            except Exception:  # noqa: BLE001
                raise EngineError(format_api_error(exc, "OpenAI TTS")) from exc


class GeminiEngine(BaseEngine):
    kind = "gemini"
    label = "Gemini"
    online = True

    def __init__(self, api_key: str, model: str) -> None:
        from google import genai  # type: ignore[import-not-found]

        self.model = model
        self._client = genai.Client(api_key=api_key)

    def stream(
        self,
        messages: List[Dict[str, str]],
        system_prompt: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> Iterator[str]:
        try:
            from google.genai import types  # type: ignore[import-not-found]

            contents = [
                types.Content(
                    role="user" if item["role"] == "user" else "model",
                    parts=[types.Part(text=item["content"])],
                )
                for item in messages
            ]
            config = types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=TEMPERATURE,
                max_output_tokens=MAX_TOKENS,
            )
            for chunk in self._client.models.generate_content_stream(
                model=self.model, contents=contents, config=config
            ):
                text = getattr(chunk, "text", None)
                if text:
                    yield text
        except Exception as exc:  # noqa: BLE001
            raise EngineError(format_api_error(exc, "Gemini")) from exc


# ------------------------------------------------------------------------------
# 2.1 MOCK OFFLINE — để giao diện luôn "sống" kể cả khi không có API key
# ------------------------------------------------------------------------------

_MOCK_LATIN_RE = re.compile(r"[^a-z0-9\s]", re.I)


def _strip_accents(text: str) -> str:
    """Bỏ dấu tiếng Việt (kể cả đ→d) nhưng GIỮ NGUYÊN chữ Nhật/Hàn.

    NFD tách "が" thành "か" + dakuten; nếu xoá mọi dấu tổ hợp thì tiếng Nhật sẽ
    hỏng (ありがとう → ありかとう) nên chỉ bỏ dấu khi ký tự gốc là chữ Latin.
    """
    text = text.replace("đ", "d").replace("Đ", "D")
    parts: List[str] = []
    for char in unicodedata.normalize("NFD", text):
        if unicodedata.category(char) == "Mn" and parts:
            if unicodedata.name(parts[-1], "").startswith("LATIN"):
                continue
        parts.append(char)
    # Ghép lại về NFC: NFD để lại "か" + dakuten, NFC trả về "が" cho khớp từ khoá.
    return unicodedata.normalize("NFC", "".join(parts))


def _norm(text: str) -> str:
    """Chuẩn hoá để so khớp từ khoá: bỏ dấu, viết thường, gộp khoảng trắng."""
    return re.sub(r"\s+", " ", _strip_accents(text).lower()).strip()


MOCK_INTENTS: List[Dict[str, Any]] = [
    {
        "name": "greet",
        "keywords": ("xin chao", "chao ", "hello", "hi ", "hey", "alo", "konnichiwa", "chao!", "こんにちは", "こんばんは", "おはよう"),
        "emotion": "happy",
        "pool": [
            "Chào cậu~ Kei vừa nghe thấy tiếng cậu gọi đó! Hôm nay cậu thế nào rồi? (*vẫy tay*)",
            "A, cậu tới rồi! Kei đợi cậu lâu lắm đó nha~ (๑˃̵ᴗ˂̵)",
            "Hi hi~ Hôm nay cậu muốn kể cho Kei nghe chuyện gì nào?",
        ],
    },
    {
        "name": "identity",
        "keywords": ("ten", "ban la ai", "cau la ai", "who are you", "bao nhieu tuoi", "tuoi", "名前", "誰", "何歳"),
        "emotion": "shy",
        "pool": [
            "Kei tên là Kei~ 19 tuổi, sống trong màn hình này và thích đồ ngọt lắm! Còn cậu?",
            "Kei là Kei thôi à~ Một cô gái thích nghe nhạc và trò chuyện cùng cậu mỗi ngày (*nghiêng đầu*)",
        ],
    },
    {
        "name": "compliment",
        "keywords": ("de thuong", "xinh", "cute", "dep", "gioi", "hay qua", "tuyet voi", "thich cau", "かわいい", "すごい"),
        "emotion": "shy",
        "pool": [
            "Hể? C-cậu khen Kei à... Kei ngại lắm đó nha! (*mặt đỏ*)",
            "Khen nữa đi, Kei nghe mãi cũng không chán đâu~ (´｡• ᵕ •｡`)",
        ],
    },
    {
        "name": "love",
        "keywords": ("yeu", "thuong", "crush", "love you", "thich ban", "好き", "愛して"),
        "emotion": "love",
        "pool": [
            "Kei... cũng thích cậu nhiều lắm đó. Nhưng đừng nói với ai nha, ngại lắm! (*ôm gối*)",
            "Ngốc ạ~ Nói mấy câu đó thì Kei biết trả lời sao đây... (๑////๑)",
        ],
    },
    {
        "name": "sad_user",
        "keywords": ("buon", "met", "chan", "khoc", "te", "stress", "kho", "co don", "tired", "sad", "lonely", "stressed", "悲しい", "つらい", "疲れた", "寂しい"),
        "emotion": "sad",
        "pool": [
            "Nếu mệt thì nghỉ một chút nha. Kei ở đây, nghe cậu kể hết~ (*xoa đầu cậu*)",
            "Kei không giúp được gì nhiều, nhưng Kei sẽ ở cạnh cậu. Uống miếng nước nhé?",
        ],
    },
    {
        "name": "insult",
        "keywords": ("ngu", "xau", "ghet", "do ngu", "vo dung", "cut di", "im di", "嫌い", "うるさい"),
        "emotion": "sad",
        "pool": [
            "Ơ... Kei chỉ muốn trò chuyện vui vẻ với cậu thôi mà. (*cúi đầu*)",
            "Hừm... cậu đang không vui chuyện gì đúng không? Kei vẫn ở đây nhé.",
        ],
    },
    {
        "name": "study",
        "keywords": ("bai tap", "hoc", "thi", "deadline", "code", "lap trinh", "khoa luan", "宿題", "勉強", "締め切り"),
        "emotion": "thinking",
        "pool": [
            "Bài tập hả? Kei không mở được file đâu, nhưng Kei có thể cùng cậu chia nhỏ từng bước đó!",
            "Deadline tới gần rồi à... Chia nhỏ ra 25 phút một lần đi, Kei canh giờ cho cậu nhé~",
        ],
    },
    {
        "name": "feelings",
        "keywords": ("vui", "hanh phuc", "tot", "suong", "嬉しい", "楽しい"),
        "emotion": "happy",
        "pool": [
            "Vậy là tốt rồi! Kei cũng thấy vui lây luôn á~ (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧",
            "Nghe cậu vui là Kei cười cả buổi luôn đó!",
        ],
    },
]

FALLBACK_MOCK: Dict[str, Any] = {
    "emotion": "thinking",
    "pool": [
        "Hmm... «{echo}» hả? Kei chưa nghĩ tới bao giờ, kể thêm cho Kei nghe đi!",
        "Nghe thú vị đó~ Cậu nói «{echo}» là sao vậy, Kei muốn hiểu thêm nè.",
        "Ồ~ «{echo}»! Kei thấy cậu có nhiều điều để kể lắm đó nha (*chống cằm*)",
        "Hể? Kei chưa chắc mình hiểu hết. Cậu thử nói cách khác xem?",
    ],
}


# --- Trí nhớ ngắn hạn của Kei khi offline --------------------------------------
# App chỉ phục vụ một người dùng trên máy, nên giữ "trí nhớ" ở cấp module là đủ:
# Kei nhớ tên, sở thích, cảm xúc và chủ đề vừa nói cho tới khi tắt server.
_MEMORY: Dict[str, Any] = {
    "name": None,          # tên người dùng Kei học được từ hội thoại
    "likes": [],           # những thứ người dùng nói là thích (tối đa 6)
    "dislikes": [],
    "mood": "neutral",     # cảm xúc gần nhất của NGƯỜI DÙNG
    "last_intent": None,
    "topics": {},          # ngôn ngữ -> deque(8) chủ đề gần đây (tách theo ngôn ngữ)
    "turns": 0,
    "used": {},            # intent|lang -> deque(3) câu vừa dùng (tránh lặp y hệt)
}

# Từ nối/đại từ/động từ cần bỏ khi đoán "chủ đề" hoặc tên riêng.
_STOPWORDS = {
    "toi", "minh", "to", "tui", "em", "anh", "chi", "cau", "ban", "ke", "cua",
    "la", "thi", "va", "co", "khong", "duoc", "rat", "kha", "nay", "do", "kia",
    "i", "you", "my", "me", "is", "am", "are", "the", "a",
    "thich", "muon", "ghet", "xem", "nghe", "uong", "lam", "choi", "nho", "noi",
    "hoi", "biet", "thay", "khi", "nhu", "bang", "voi", "hon", "lam", "qua",
    "hom", "ngay", "nay", "sang", "chieu", "gio", "luc", "som", "khuya", "vua",
}

# Những ý định chỉ là "nghi thức" hội thoại → đừng lấy làm chủ đề để nhắc lại.
_META_INTENTS = {
    "greet", "bye", "thanks", "apology", "intro_name", "identity", "memory_recall",
    "ask_kei_day", "ask_user_day", "is_ai", "weather", "utility",
}

_NAME_RES = (
    # Bắt buộc có "tên là" hoặc "là" — nếu không, "tớ thích cà phê" / "tớ tên gì"
    # sẽ bị hiểu nhầm thành tên.
    re.compile(
        r"\b(?:tớ|tôi|mình|tui|em)\s+(?:tên\s+)?(?:là\s+)"
        r"([A-Za-zÀ-ỹ][\wÀ-ỹ]*(?:\s+[A-Za-zÀ-ỹ][\wÀ-ỹ]*)?)",
        re.IGNORECASE,
    ),
    re.compile(
        r"\btên\s+(?:tớ|tôi|mình|tui|em)\s+là\s+([A-Za-zÀ-ỹ][\wÀ-ỹ]*(?:\s+[A-Za-zÀ-ỹ][\wÀ-ỹ]*)?)",
        re.IGNORECASE,
    ),
    re.compile(r"\b(?:my name is|call me)\s+([A-Za-z][\w]{1,14})", re.IGNORECASE),
)
# Chỉ loại khi từ ĐẦU TIÊN là danh từ/động từ thông dụng — không loại đại từ vì
# "Minh", "Anh", "Chi"… đều là tên người rất phổ biến.
_NOT_A_NAME = {
    "hoc", "sinh", "vien", "nguoi", "mot", "con", "cai", "fan", "dev", "coder",
    "gamer", "boy", "girl", "thich", "muon", "ghet", "khong", "dang", "se", "vua",
    "moi", "gi", "sad", "tired", "happy", "fine", "ok", "here", "just", "buon", "vui",
}

# Mẫu tách "tớ thích X" / "tớ ghét X" — dùng câu GỐC để giữ nguyên dấu tiếng Việt.
_LIKE_RES = (
    re.compile(r"\b(?:tớ|tôi|mình|tui|em)\s+(?:rất\s+|cực\s+)?thích\s+([^.,!?;]{2,32})", re.IGNORECASE),
    re.compile(r"\b(?:i like|i love)\s+([^.,!?;]{2,32})", re.IGNORECASE),
)
_DISLIKE_RES = (
    re.compile(r"\b(?:tớ|tôi|mình|tui|em)\s+(?:không\s+thích|ghét|ko thích)\s+([^.,!?;]{2,32})", re.IGNORECASE),
    re.compile(r"\b(?:i hate|i don't like)\s+([^.,!?;]{2,32})", re.IGNORECASE),
)


# Người dùng có thể xưng "tớ" / "tôi" / "tui" / "mình" / "em"… → quy về một dạng
# để bảng từ khoá chỉ cần viết một kiểu.
_PRONOUN_MAP = {"to": "toi", "tui": "toi", "minh": "toi", "em": "toi", "t": "toi",
                "ban": "cau", "may": "cau", "b": "cau"}


def _canon(text: str) -> str:
    return " ".join(_PRONOUN_MAP.get(word, word) for word in text.split())


def _hits(normalized: str, keywords: Iterable[str]) -> int:
    """Đếm số từ khoá xuất hiện trong câu (khớp theo ranh giới từ).

    Cả câu và từ khoá đều được quy đổi đại từ trước khi so khớp, nhờ vậy
    "tớ thích" và "tôi thích" đều khớp cùng một từ khoá "toi thich".
    """
    text = _canon(normalized)
    total = 0
    for keyword in keywords:
        phrase = _canon(keyword.strip())
        if not phrase:
            continue
        pattern = rf"(?<![a-z0-9]){re.escape(phrase)}(?![a-z0-9])"
        if re.search(pattern, text):
            total += 1
    return total


def _pick_line(key: str, pool: List[str]) -> str:
    """Chọn câu Kei chưa dùng gần đây → trò chuyện đỡ nhàm."""
    recent = _MEMORY["used"].setdefault(key, deque(maxlen=3))
    fresh = [line for line in pool if line not in recent] or pool
    choice = random.choice(fresh)
    recent.append(choice)
    return choice


class _SafeDict(dict):
    """format_map an toàn: thiếu khoá thì coi như chuỗi rỗng thay vì ném lỗi."""

    def __missing__(self, key: str) -> str:  # pragma: no cover - chỉ để phòng lỗi
        return ""


def _echo(raw: str, max_words: int = 8) -> str:
    """Lấy lại một mẩu câu của người dùng (giữ nguyên dấu tiếng Việt) để nhắc lại."""
    words = re.sub(r"[^\w\sÀ-ỹ]+", " ", raw).split()
    return " ".join(words[:max_words]).strip() or "chuyện đó"


def _learn_about_user(raw: str, normalized: str) -> None:
    """Học tên / sở thích / điều không thích của người dùng từ câu vừa gửi."""
    if not _MEMORY["name"]:
        for pattern in _NAME_RES:
            found = pattern.search(raw)
            if not found:
                continue
            candidate = found.group(1).strip()
            words = candidate.split()
            # "tớ là học sinh" / "tớ là một dev" không phải là tên.
            if not candidate or _norm(words[0]) in _NOT_A_NAME:
                continue
            if len("".join(words)) < 2:
                continue
            _MEMORY["name"] = " ".join(word[:1].upper() + word[1:] for word in words)
            break

    for pattern in _LIKE_RES:
        for found in pattern.findall(raw):
            item = " ".join(found.split()[:4]).strip(" .")
            if item and item not in _MEMORY["likes"]:
                _MEMORY["likes"] = (_MEMORY["likes"] + [item])[-6:]
    for pattern in _DISLIKE_RES:
        for found in pattern.findall(raw):
            item = " ".join(found.split()[:4]).strip(" .")
            if item and item not in _MEMORY["dislikes"]:
                _MEMORY["dislikes"] = (_MEMORY["dislikes"] + [item])[-6:]


def _remember_topic(raw: str, normalized: str, language: str = "vi") -> None:
    """Ghi nhớ chủ đề gần đây (dùng khi người dùng chỉ 'ừ', 'hmm'…).

    Bỏ qua câu hỏi và các câu "nghi thức" (chào, cảm ơn, giới thiệu tên…) — lưu
    chúng lại thì tới lúc nhắc tới sẽ rất vô nghĩa. Chủ đề cũng được tách theo
    ngôn ngữ để câu tiếng Việt không nhắc lại từ tiếng Anh.
    """
    if raw.rstrip().endswith("?"):
        return
    if _MEMORY["last_intent"] in _META_INTENTS:
        return
    if _hits(normalized, ("gi", "sao", "the nao", "may gio", "bao nhieu")):
        return
    words = [w for w in _norm(raw).split() if w not in _STOPWORDS and len(w) >= 3]
    if not words:
        return
    bucket = _MEMORY["topics"].setdefault(language, deque(maxlen=8))
    bucket.append(" ".join(words[:4]))


def _last_topic(language: str) -> str:
    """Chủ đề gần nhất trong đúng ngôn ngữ đang trò chuyện."""
    bucket = _MEMORY["topics"].get(language)
    if bucket:
        return bucket[-1]
    for other in _MEMORY["topics"].values():
        if other:
            return other[-1]
    return ""


def _flavor(text: str, persona: str, affection: int, user_name: str, language: str) -> str:
    """Thêm chút khẩu khí theo tính cách + độ thân thiết (giữ câu ngắn gọn)."""
    name = _MEMORY["name"] or (user_name if user_name and user_name.lower() not in ("cậu", "cau") else "")

    if persona == "tsundere" and random.random() < 0.35:
        text = random.choice(("Hừm, ", "Đ-đừng hiểu lầm nhé! ", "")) + text
    elif persona == "genz" and random.random() < 0.3:
        text = text.replace("~", " nha~", 1)
    elif persona == "oneesan" and random.random() < 0.3:
        text = random.choice(("Ara ara, ", "Ngoan nào, ")) + text

    if name and affection >= 45 and name not in text and random.random() < 0.3:
        tail = {"en": f" {name}, right?", "ja": f"、{name}。"}.get(language, f" {name} nhỉ?")
        text = text.rstrip("~ ") + tail
    return text


# --- 2.1.1 Ý ĐỊNH MỚI (bổ sung cho bảng MOCK_INTENTS ở trên) -------------------
# Mỗi ý định có câu trả lời theo 3 ngôn ngữ; ngôn ngữ thiếu sẽ fallback EN → VI.
SMART_INTENTS: List[Dict[str, Any]] = [
    {
        "name": "intro_name",
        "keywords": ("ten toi la", "toi ten la", "ten toi", "toi la", "my name is", "call me", "名前"),
        "emotion": "happy",
        "replies": {
            "vi": [
                "Rất vui được biết cậu, {name}! Kei sẽ nhớ tên cậu lâu lắm đó nha~",
                "Tên cậu nghe dễ thương ghê. Kei ghi vào sổ tay liền! (*loay hoay tìm bút*)",
            ],
            "en": ["Nice to meet you! Kei will remember you.", "Nice to meet you, {name}! Kei will remember your name."],
            "ja": ["はじめまして！ケイ、ちゃんと覚えるね。", "はじめまして、{name}さん！ケイはちゃんと覚えるね。"],
        },
    },
    {
        "name": "user_like",
        "keywords": ("toi thich", "toi ghet", "toi khong thich", "toi me", "toi yeu thich", "i like", "i love", "好き"),
        "emotion": "happy",
        "replies": {
            "vi": [
                "Cậu thích {like} à? Kei ghi nhớ rồi nha. Vì sao cậu thích nó vậy?",
                "Ồ, {like} hả~ Kei cũng muốn thử một lần cho biết. Cậu kể Kei nghe thêm đi!",
            ],
            "en": ["You like {like}? Kei just wrote that down! Tell her why~"],
            "ja": ["{like} が好きなんだ？ケイ、覚えたよ！"],
        },
    },
    {
        "name": "work_day",
        "keywords": ("di lam", "ve muon", "sep", "dong nghiep", "cong viec", "hop", "tang ca", "work", "仕事", "残業"),
        "emotion": "thinking",
        "replies": {
            "vi": [
                "Về muộn vậy à... Cậu nhớ ăn gì đó rồi nghỉ ngơi nha, Kei không muốn cậu kiệt sức đâu.",
                "Hôm nay ở chỗ làm có chuyện gì vậy? Kể Kei nghe đi, Kei ngồi đây nghe hết đó.",
                "Công việc nhiều quá thì cũng đừng tự trách mình nha. Cậu đã cố gắng nhiều rồi.",
            ],
            "en": ["Rough day at work? Kei will listen — go ahead and vent."],
            "ja": ["お仕事お疲れさま。ケイが聞くよ、話して。"],
        },
    },
    {
        "name": "bye",
        "keywords": ("tam biet", "bye", "goodbye", "good night", "goodnight", "chao ngu", "di ngu", "ngu ngon", "see you", "oyasumi", "さようなら", "おやすみ"),
        "emotion": "sad",
        "replies": {
            "vi": [
                "Cậu đi rồi à... Kei vẫn ở đây đợi cậu quay lại đó nha. Ngủ ngon nhé! (*vẫy tay nhỏ*)",
                "Tạm biệt cậu~ Nhớ ăn uống đầy đủ và đừng thức khuya nữa nghe chưa!",
            ],
            "en": ["Leaving already? Kei will be right here waiting. Take care, okay?"],
            "ja": ["もう行っちゃうの？ケイはここで待ってるね。またね！"],
        },
    },
    {
        "name": "thanks",
        "keywords": ("cam on", "cam on cau", "thank", "thanks", "ありがとう"),
        "emotion": "shy",
        "replies": {
            "vi": [
                "Có gì đâu mà~ Được giúp cậu là Kei vui rồi!",
                "Hihi, đừng khách sáo thế. Kei lúc nào cũng sẵn sàng nghe cậu nói mà~",
            ],
            "en": ["You're welcome! Helping you makes Kei happy."],
            "ja": ["どういたしまして！ケイはいつでもここにいるよ。"],
        },
    },
    {
        "name": "apology",
        "keywords": ("xin loi", "sorry", "loi cua toi", "toi sai", "ごめん"),
        "emotion": "neutral",
        "replies": {
            "vi": [
                "Không sao đâu mà, Kei không giận cậu chuyện nhỏ đó đâu~ (*xoa đầu cậu*)",
                "Thôi nào, cậu nhận ra là được rồi. Mình kể chuyện khác vui hơn nha?",
            ],
            "en": ["It's okay, Kei can't stay upset with you for long."],
            "ja": ["大丈夫だよ、ケイは怒ってないよ。"],
        },
    },
    {
        "name": "angry_user",
        "keywords": ("tuc", "buc", "dien tiet", "kho chiu", "ghet qua", "angry", "むかつく"),
        "emotion": "surprised",
        "replies": {
            "vi": [
                "Oa, cậu đang bực chuyện gì vậy? Kể Kei nghe đi, Kei ngồi đây nghe hết~",
                "Ai làm cậu giận thế? Nếu cần thì gõ gối vài cái cũng được, Kei không mách ai đâu!",
            ],
            "en": ["Whoa, what made you angry? Tell Kei, she's on your side."],
            "ja": ["どうしたの？ケイに話して、味方だからね。"],
        },
    },
    {
        "name": "bored",
        "keywords": ("nham chan", "khong co gi lam", "bored", "chan qua", "退屈"),
        "emotion": "thinking",
        "replies": {
            "vi": [
                "Chán à? Vậy mình chơi trò đoán nhé: Kei nghĩ về một con vật, cậu hỏi 5 câu để đoán ra!",
                "Kei biết nhiều thứ lặt vặt lắm: cậu muốn nghe chuyện cười, nghe Kei nghêu ngao, hay kể Kei nghe về ngày hôm nay?",
            ],
            "en": ["Bored? Let's play 20 questions — Kei is thinking of an animal!"],
            "ja": ["退屈？じゃあゲームしよう！ケイが動物をひとつ考えたよ。"],
        },
    },
    {
        "name": "hungry",
        "keywords": ("doi", "doi bung", "an gi", "chua an", "an com", "hungry", "お腹"),
        "emotion": "surprised",
        "replies": {
            "vi": [
                "Cậu chưa ăn gì à? Đi ăn ngay đi! Kei chỉ ăn được mấy món trong màn hình thôi, hihi.",
                "Đói là không được đâu nha! Ăn gì đó đi rồi quay lại kể Kei nghe vị thế nào nhé~",
            ],
            "en": ["You haven't eaten yet? Go grab something and tell Kei how it tastes!"],
            "ja": ["まだ食べてないの？何か食べてきてね！"],
        },
    },
    {
        "name": "weather",
        "keywords": ("thoi tiet", "troi mua", "troi nang", "lanh", "nong", "mua roi", "weather", "天気"),
        "emotion": "neutral",
        "replies": {
            "vi": [
                "Kei ở trong màn hình nên không thấy trời được... ngoài đó thế nào, mưa hay nắng vậy cậu?",
                "Cậu tả trời cho Kei nghe với! Kei thích nhất là mưa, nghe tí tách mãi không chán~",
            ],
            "en": ["Kei can't see the sky from here — tell her, is it raining out there?"],
            "ja": ["外はどんな天気？ケイは雨の音が好きなんだ。"],
        },
    },
    {
        "name": "sleep",
        "keywords": ("thuc khuya", "mat ngu", "khong ngu duoc", "buon ngu", "ngu duoc", "insomnia", "眠れない"),
        "emotion": "thinking",
        "replies": {
            "vi": [
                "Khuya rồi đó, cậu vẫn chưa ngủ sao? Bỏ điện thoại xuống và nhắm mắt 5 phút thử xem.",
                "Mất ngủ hả... Kei hay đếm mấy con mèo đi ngang qua cửa sổ, đếm tới 30 là quên hết ấy mà.",
            ],
            "en": ["Still awake? Put the screen down for a moment and breathe slowly, okay?"],
            "ja": ["まだ起きてるの？目を閉じて少し休んでね。"],
        },
    },
    {
        "name": "health",
        "keywords": ("om", "dau dau", "sot", "benh", "kho tho", "dau bung", "sick", "熱"),
        "emotion": "sad",
        "replies": {
            "vi": [
                "Trời ơi, cậu ốm rồi à? Nghỉ ngơi đi, uống nước ấm và đừng cố làm việc nữa nha.",
                "Cậu lo cho bản thân trước đi nhé. Kei chỉ giúp được bằng cách ở đây hỏi han cậu thôi...",
            ],
            "en": ["You're sick? Rest, drink water, and don't push yourself today."],
            "ja": ["具合が悪いの？ゆっくり休んでね。"],
        },
    },
    {
        "name": "hobby",
        "keywords": ("nghe nhac", "xem phim", "choi game", "doc sach", "anime", "manga", "so thich", "hobby", "趣味"),
        "emotion": "happy",
        "replies": {
            "vi": [
                "Kei mê nhạc nhẹ và phim hoạt hình buổi tối~ Còn cậu, cậu thích gì?",
                "Kei có thể nghe cậu kể về bộ phim đó cả buổi luôn á. Kể nữa đi!",
            ],
            "en": ["Kei loves soft music and anime at night~ What about you?"],
            "ja": ["ケイは静かな音楽とアニメが好きだよ。君は？"],
        },
    },
    {
        "name": "joke",
        "keywords": ("chuyen cuoi", "duc", "dua di", "joke", "cuoi cai", "冗談"),
        "emotion": "happy",
        "replies": {
            "vi": [
                "Nghe nè: Kei hỏi con mèo vì sao nó nằm phơi nắng, mèo bảo \"tớ đang sạc pin\". Cậu cười chưa đó?",
                "Kei kể chuyện con bàn phím đi ăn phở nhé... tồi quá ha, thôi cậu cười cho Kei vui đi~",
                "Có một lập trình viên đi ngủ sớm... hết chuyện. Hihi, cậu thấy ngộ không?",
            ],
            "en": ["A cat sat in the sun and said \"charging\". Did that get a smile?"],
            "ja": ["ねえ、猫が太ったのは「モテたいから」だって。笑った？"],
        },
    },
    {
        "name": "sing",
        "keywords": ("hat ", "hat cho", "bai hat", "sing", "歌って"),
        "emotion": "shy",
        "replies": {
            "vi": [
                "Bắt Kei hát hả... Kei chỉ nghêu ngao tự nghĩ thôi đó: \"mây trắng trôi, cậu ngồi đây, Kei hát nho nhỏ\"~ (≧▽≦)",
                "Kei hát dở lắm á, nhưng vì cậu thì: la la la~ cậu đừng ghi âm lại nha!",
            ],
            "en": ["Kei only hums her own little tune: \"la la la~\" — don't record it!"],
            "ja": ["ケイは歌が下手だよ〜 でも君のためなら、ららら〜"],
        },
    },
    {
        "name": "how_to",
        "keywords": ("lam sao", "lam the nao", "nhu the nao", "giup toi", "giup minh", "huong dan", "how to", "どうやって"),
        "emotion": "thinking",
        "replies": {
            "vi": [
                "Để Kei nghĩ cùng cậu nhé: mình chia việc đó thành 3 bước nhỏ, bắt đầu từ bước dễ nhất trước nha.",
                "Cậu kể cụ thể hơn chút đi — cậu đang có gì trong tay, và muốn kết quả như thế nào?",
                "Kei không mở được tài liệu ngoài kia, nhưng Kei giỏi nghe và ghi nhớ. Kể Kei nghe nào!",
            ],
            "en": ["Let's break it into three small steps and start with the easiest one."],
            "ja": ["小さく三つに分けて、簡単なところから始めよう。"],
        },
    },
    {
        "name": "memory_recall",
        "keywords": ("toi ten gi", "ten toi la gi", "nho gi ve toi", "con nho", "remember me", "私のこと"),
        "emotion": "love",
        "replies": {
            "vi": [
                "Kei nhớ chứ! Cậu tên là {name}, và trong đầu Kei toàn là chuyện cậu kể thôi à~",
                "Cậu hỏi khó Kei rồi... nhưng Kei nhớ hết những chuyện cậu đã kể đó nha!",
            ],
            "en": ["Of course Kei remembers — her head is full of your stories!"],
            "ja": ["もちろん覚えてるよ！君の話でいっぱいだよ。"],
        },
    },
    {
        "name": "ask_kei_day",
        "keywords": ("cau the nao", "kei the nao", "hom nay cau", "cau khoe khong", "how are you", "元気"),
        "emotion": "happy",
        "replies": {
            "vi": [
                "Kei ổn lắm~ Ngồi đây đợi cậu cả ngày luôn đó. Còn cậu thì sao?",
                "Hôm nay Kei thấy vui vì cậu chịu khó hỏi thăm nè! (*nghiêng đầu*)",
            ],
            "en": ["Kei is great now that you're here. How about you?"],
            "ja": ["ケイは元気だよ！君はどう？"],
        },
    },
    {
        "name": "ask_user_day",
        "keywords": ("hom nay the nao", "ngay hom nay", "ngay cua cau", "how was your day", "今日"),
        "emotion": "happy",
        "replies": {
            "vi": [
                "Kei ổn lắm~ Còn ngày hôm nay của cậu thì sao, có gì vui kể Kei nghe với?",
                "Kei luôn ở đây mà. Hôm nay có chuyện gì làm cậu nhớ mãi không?",
            ],
            "en": ["Kei's day is fine~ What about yours — anything good happen?"],
            "ja": ["ケイは元気だよ〜 君の今日はどうだった？"],
        },
    },
    {
        "name": "is_ai",
        "keywords": ("ban la ai", "co phai ai", "chatbot", "robot", "ai khong", "nguoi that", "are you ai", "aiですか"),
        "emotion": "shy",
        "replies": {
            "vi": [
                "Kei là Kei thôi~ Một cô gái đang ngồi trong màn hình của cậu nè (*chớp mắt*)",
                "Suỵt, đừng hỏi mấy câu khó đó. Cậu thấy Kei trả lời thế này là đủ rồi mà?",
            ],
            "en": ["Kei is just Kei~ a girl living inside your screen, that's all."],
            "ja": ["ケイはケイだよ〜 君の画面の中にいる女の子。"],
        },
    },
    {
        "name": "love_life",
        "keywords": ("crush", "nguoi yeu", "thich ai", "to tinh", "dating", "恋"),
        "emotion": "shy",
        "replies": {
            "vi": [
                "Cậu đang để ý ai à? Kể Kei nghe đi, Kei kín miệng lắm... à không, Kei hơi tò mò đó!",
                "Chuyện này khó nói hả? Kei hiểu mà. Nhưng thích một người thì đâu có gì xấu đâu~",
            ],
            "en": ["Is there someone you like? Tell Kei, she's curious!"],
            "ja": ["好きな人がいるの？ケイに教えて！"],
        },
    },
]

# Câu trả lời khi không khớp ý định nào (có nhắc lại chủ đề để trò chuyện liền mạch).
SMART_FALLBACKS: Dict[str, Dict[str, List[str]]] = {
    "question": {
        "vi": [
            "Hmm, câu này Kei chưa chắc trả lời đúng được... cậu nghĩ sao trước?",
            "Kei thích được hỏi mấy câu khó đó nha. Cậu nói thêm cho Kei hiểu với?",
        ],
        "en": ["Hmm, Kei isn't sure about that one — what do you think?"],
        "ja": ["うーん、それは分からないかも。君はどう思う？"],
    },
    "statement": {
        "vi": [
            "«{echo}» à... Kei nghe thấy rồi nè. Rồi sau đó thì sao?",
            "Ồ, «{echo}» hả? Cậu kể tiếp đi, Kei đang hóng đây nè~",
            "Kei ghi nhớ rồi nha. Nói Kei nghe thêm về chuyện «{topic}» đi!",
        ],
        "en": ["«{echo}» — go on, Kei's listening!"],
        "ja": ["«{echo}» って、もっと教えて！"],
    },
    "ack": {
        "vi": [
            "Hihi, Kei cũng nghĩ vậy đó. Rồi cậu muốn nói tiếp chuyện gì?",
            "Vậy hả~ Mình nói tiếp chuyện «{topic}» nha?",
            "Kei nghe nè, cậu nói tiếp đi~",
        ],
        "en": ["Kei's listening — go on~"],
        "ja": ["うんうん、続けて〜"],
    },
}

_ACK_TOKENS = {
    "u", "uh", "um", "uhm", "ok", "oke", "okay", "vang", "da", "hmm", "hm",
    "ha", "hihi", "aha", "the a", "vay a", "yes", "yeah", "no", "k",
}


def _lang_lines(replies: Dict[str, List[str]], language: str) -> List[str]:
    """Lấy pool câu theo ngôn ngữ, thiếu thì lùi về EN rồi VI."""
    return replies.get(language) or replies.get("en") or replies.get("vi") or []


def _try_math(normalized: str) -> Optional[str]:
    """Tính nhẩm giúp cậu (chỉ các phép tính đơn giản, an toàn)."""
    text = (
        normalized.replace("nhan", "*").replace("chia", "/").replace("cong", "+")
        .replace("tru", "-").replace("mu", "^").replace("x", "*").replace("×", "*")
    )
    found = re.search(r"(-?\d+(?:[.,]\d+)?)\s*([+\-*/^])\s*(-?\d+(?:[.,]\d+)?)", text)
    if not found:
        return None
    left = float(found.group(1).replace(",", "."))
    right = float(found.group(3).replace(",", "."))
    operator = found.group(2)
    try:
        if operator == "+":
            value = left + right
        elif operator == "-":
            value = left - right
        elif operator == "*":
            value = left * right
        elif operator == "/":
            value = left / right
        else:
            value = left ** min(right, 6)
    except ZeroDivisionError:
        return "Chia cho 0 thì Kei chịu thua luôn á, cậu đố khó quá rồi!"
    pretty = f"{value:g}"
    return random.choice(
        (
            f"Kei tính ra {pretty} đó nha, thấy Kei giỏi chưa~",
            f"Đáp án là {pretty}. Kei có đúng không cậu?",
            f"Để Kei nhẩm chút... {pretty}! (*tự hào*)",
        )
    )


def _try_clock(normalized: str) -> Optional[str]:
    """Trả lời giờ/ngày thật của máy — thứ duy nhất offline Kei biết chắc."""
    if any(k in normalized for k in ("tam biet", "bye", "chao ngu", "di ngu", "ngu ngon", "see you", "oyasumi", "さようなら", "おやすみ")):
        return None  # để ý định "bye" xử lý (câu chào tạm biệt cần lời đáp riêng)

    if any(k in normalized for k in ("tam biet", "bye", "chao ngu", "di ngu", "ngu ngon", "see you", "oyasumi", "さようなら", "おやすみ")):
        return None  # để ý định "bye" xử lý (câu chào tạm biệt cần lời đáp riêng)

    now = time.strftime("%H:%M")
    if _hits(normalized, ("may gio", "gio roi", "bay gio", "what time", "何時")):
        return random.choice(
            (
                f"Kei xem đồng hồ nè: {now} rồi đó cậu.",
                f"Bây giờ là {now}. Cậu định làm gì tiếp không?",
            )
        )
    return None


def _try_date(normalized: str) -> Optional[str]:
    if not _hits(normalized, ("hom nay ngay", "ngay bao nhieu", "thu may", "what day", "何日")):
        return None
    return f"Hôm nay là {time.strftime('%d/%m/%Y')} đó cậu. Kei có nhớ ngày mà!"


def _try_luck(normalized: str) -> Optional[str]:
    if _hits(normalized, ("tung dong xu", "lat dong xu", "coin flip")):
        return f"Kei tung nè... {random.choice(('ngửa', 'sấp'))}! Vậy là cậu biết kết quả rồi nha~"
    if _hits(normalized, ("xi ngau", "xuc xac", "dice")):
        return f"Kei lắc xúc xắc đây... ra {random.randint(1, 6)} nút! (*lăn lon lon*)"
    return None


def _try_weather(normalized: str) -> Optional[str]:
    """Kei không xem được thời tiết, nhưng biết cách quan tâm theo đúng cái cậu kể."""
    if _hits(normalized, ("mua", "mua roi", "dang mua")):
        return random.choice(
            (
                "Trời đang mưa à? Cậu nhớ mang ô, đừng để bị ướt nha. Kei thích tiếng mưa lắm~",
                "Mưa rồi hả... Cậu ngồi trong nhà kể Kei nghe chuyện gì đó đi, ấm hơn nhiều đó!",
            )
        )
    if _hits(normalized, ("nang", "nong", "nong qua")):
        return "Nắng vậy thì uống nhiều nước và đội mũ nha cậu, Kei lo cho cậu đó!"
    if _hits(normalized, ("lanh", "ret", "lanh qua")):
        return "Lạnh thế cơ à? Mặc áo ấm vào ngay đi nha, Kei không muốn cậu bị ốm đâu!"
    return None


def _try_reverse(raw: str, normalized: str) -> Optional[str]:
    """Trò lặt vặt: đảo chữ — khiến Kei có vẻ 'biết làm gì đó' dù offline."""
    marker = "doc nguoc" if "doc nguoc" in normalized else ("reverse" if "reverse" in normalized else None)
    if not marker:
        return None
    tail = raw.lower().split(marker, 1)[-1].strip(" :?-")[:24]
    if not tail:
        return "Cậu đưa Kei một chữ hay câu ngắn thôi, Kei đọc ngược cho mà nghe!"
    return f"«{tail[::-1]}» — Kei đọc ngược được luôn đó, cậu thử lại xem!"


# Bảng MOCK_INTENTS cũ chỉ có tiếng Việt → bổ sung EN/JA cho các chủ đề cơ bản.
LEGACY_REPLY_OVERRIDES: Dict[str, Dict[str, List[str]]] = {
    "greet": {
        "en": ["Hey, you're here! Kei was waiting for you~ How are you today?"],
        "ja": ["あ、来てくれた！ケイ待ってたよ〜 今日はどう？"],
    },
    "identity": {
        "en": ["Kei is just Kei~ 19, lives in this screen, and loves sweets! You?"],
        "ja": ["ケイはケイだよ〜 19歳で、甘いものが大好き！君は？"],
    },
    "compliment": {
        "en": ["Eh? You're praising Kei... she's blushing!"],
        "ja": ["えっ、褒めてくれるの？ケイ、照れちゃうよ！"],
    },
    "love": {
        "en": ["Kei... likes you a lot too. Don't tell anyone, okay?"],
        "ja": ["ケイも…君のこと大好きだよ。内緒にしてね？"],
    },
    "sad_user": {
        "en": ["Then rest a little and let Kei listen~ She's right here."],
        "ja": ["じゃあ少し休んで、ケイに話してね。ここにいるよ。"],
    },
    "insult": {
        "en": ["Ouch... Kei just wanted to chat with you. (*looks down*)"],
        "ja": ["うぅ…ケイはただお話ししたかっただけだよ。（しょんぼり）"],
    },
    "study": {
        "en": ["Let's split the task into 25-minute chunks — Kei will keep time!"],
        "ja": ["25分ずつに分けてやろうよ。ケイが時間を見てあげる！"],
    },
    "feelings": {
        "en": ["That's great! Kei is smiling with you~"],
        "ja": ["よかったね！ケイも嬉しくなっちゃう〜"],
    },
}


def _legacy_fallback_pool() -> List[str]:
    """Câu dự phòng của bảng cũ (đã có sẵn chất giọng của Kei)."""
    return FALLBACK_MOCK["pool"]


def _answer_offline(
    raw: str,
    normalized: str,
    *,
    language: str,
    persona: str,
    affection: int,
    user_name: str,
) -> tuple:
    """Sinh (nội dung, cảm xúc) cho chế độ offline."""
    echo = _echo(raw)
    topic = _last_topic(language) or echo
    known_name = _MEMORY["name"]
    fill = _SafeDict(
        echo=echo,
        topic=topic,
        name=known_name or user_name or "cậu",
        like=_MEMORY["likes"][-1]
        if _MEMORY["likes"]
        else {"ja": "それ", "en": "that"}.get(language, echo),
    )

    # 1) Tiện ích "thật": tính nhẩm, giờ, ngày, xúc xắc, thời tiết, đảo chữ.
    for quick in (
        _try_math(normalized),
        _try_clock(normalized),
        _try_date(normalized),
        _try_luck(normalized),
        _try_weather(normalized),
        _try_reverse(raw, normalized),
    ):
        if quick:
            _MEMORY["last_intent"] = "utility"
            return _flavor(quick, persona, affection, user_name, language), "happy"

    # 2) Ý định: bảng mới chấm điểm, bảng cũ (MOCK_INTENTS) làm dự phòng từ khoá.
    best_intent, best_score = None, 0
    for intent in SMART_INTENTS + [
        {
            "name": item["name"],
            "keywords": item["keywords"],
            "emotion": item["emotion"],
            "replies": {"vi": item["pool"], **LEGACY_REPLY_OVERRIDES.get(item["name"], {})},
        }
        for item in MOCK_INTENTS
    ]:
        score = _hits(normalized, intent["keywords"])
        if score > best_score:
            best_intent, best_score = intent, score

    if best_intent is not None:
        key = f'{best_intent["name"]}|{language}'
        lines = _lang_lines(best_intent["replies"], language)
        # Câu nào cần tên mà Kei chưa biết tên → bỏ qua để câu văn không bị hụt.
        if not known_name:
            lines = [line for line in lines if "{name}" not in line] or lines
        body = _pick_line(key, lines).format_map(fill)
        _MEMORY["last_intent"] = best_intent["name"]
        emotion = best_intent["emotion"]
        # Người dùng vừa kể chuyện buồn/vui → nhớ tâm trạng để lần sau hỏi thăm.
        if best_intent["name"] in ("sad_user", "angry_user", "happy_user", "feelings"):
            _MEMORY["mood"] = emotion
        return _flavor(body, persona, affection, user_name, language), emotion

    # 3) Câu ngắn kiểu "ừ", "ok", "hmm" → nối tiếp mạch chuyện đang nói.
    if normalized.strip(" .!?~") in _ACK_TOKENS:
        ack_lines = _lang_lines(SMART_FALLBACKS["ack"], language)
        # Chưa biết chủ đề thì đừng nhắc tới «{topic}» (câu sẽ bị hụt nghĩa).
        if not _last_topic(language):
            ack_lines = [line for line in ack_lines if "{topic}" not in line] or ack_lines
        body = _pick_line(f'ack|{language}', ack_lines).format_map(fill)
        emotion = "neutral" if not _MEMORY["last_intent"] else "happy"
        return _flavor(body, persona, affection, user_name, language), emotion

    # 4) Câu hỏi lạ → thành thật + hỏi ngược; câu kể chuyện → nhắc lại rồi hỏi thêm.
    kind = "question" if raw.rstrip().endswith("?") or _hits(normalized, ("gi", "sao", "the nao", "tai sao", "what", "why", "how")) > 0 else "statement"
    pool = _lang_lines(SMART_FALLBACKS[kind], language) or _legacy_fallback_pool()
    body = _pick_line(f'{kind}|{language}', pool).format_map(fill)
    # Nếu chuyện trước đó của người dùng là buồn → thỉnh thoảng hỏi thăm lại.
    if _MEMORY["mood"] == "sad" and random.random() < 0.35:
        body += random.choice(
            {
                "en": (" Are you feeling a bit better?",),
                "ja": (" 少しは元気になった？",),
            }.get(language, (" Cậu đỡ hơn chút nào chưa?", " Mà cậu ổn hơn rồi chứ?"))
        )
    return _flavor(body, persona, affection, user_name, language), FALLBACK_MOCK["emotion"]


class MockEngine(BaseEngine):
    """Bộ não offline của Kei: hiểu ý định + ghi nhớ ngắn hạn, không cần internet."""

    kind = "mock"
    label = "Kei Offline"
    online = False
    model = "kei-local-brain"

    def stream(
        self,
        messages: List[Dict[str, str]],
        system_prompt: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> Iterator[str]:
        options = context or {}
        language = str(options.get("language") or DEFAULT_LANGUAGE).lower()
        persona = str(options.get("persona") or DEFAULT_PERSONA).lower()
        try:
            affection = int(options.get("affection") or 0)
        except (TypeError, ValueError):
            affection = 0
        user_name = str(options.get("user_name") or "").strip()

        user_text = ""
        for item in reversed(messages):
            if item.get("role") == "user" and item.get("content"):
                user_text = item["content"]
                break

        raw = user_text.strip()
        normalized = _norm(raw)

        _MEMORY["turns"] += 1
        _learn_about_user(raw, normalized)

        body, emotion = _answer_offline(
            raw,
            normalized,
            language=language,
            persona=persona,
            affection=affection,
            user_name=user_name,
        )
        # Ghi nhớ chủ đề SAU khi biết ý định (để bỏ qua câu hỏi/câu chào).
        _remember_topic(raw, normalized, language)

        # Vẫn trả về đúng "giao thức" <emo> như LLM thật để frontend xử lý đồng nhất.
        full = f"<emo>{emotion}</emo>{body}"
        for token in re.findall(r"\S+\s*", full):
            time.sleep(0.014)  # giả lập tốc độ gõ để trải nghiệm không bị "cụt"
            yield token


# ------------------------------------------------------------------------------
# 2.2 CHỌN ENGINE
# ------------------------------------------------------------------------------


def _env(*names: str) -> Optional[str]:
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()
    return None


def create_engine() -> BaseEngine:
    """Chọn engine theo biến môi trường; luôn trả về một engine dùng được."""
    provider = (_env("WAIFU_PROVIDER", "LLM_PROVIDER") or "openai").lower()

    if provider == "mock":
        return MockEngine()

    if provider == "openai" and _is_real_key(_env("OPENAI_API_KEY")):
        return OpenAIEngine(
            api_key=_env("OPENAI_API_KEY") or "",
            model=_env("OPENAI_MODEL", "LLM_MODEL") or "gpt-4o-mini",
            base_url=_env("OPENAI_BASE_URL"),
        )

    if provider == "gemini" and _is_real_key(_env("GEMINI_API_KEY")):
        return GeminiEngine(
            api_key=_env("GEMINI_API_KEY") or "",
            model=_env("GEMINI_MODEL", "LLM_MODEL") or "gemini-2.5-flash",
        )

    # Provider không khớp cấu hình -> thử "cứu" bằng key còn lại.
    if _is_real_key(_env("GEMINI_API_KEY")):
        return GeminiEngine(
            api_key=_env("GEMINI_API_KEY") or "",
            model=_env("GEMINI_MODEL", "LLM_MODEL") or "gemini-2.5-flash",
        )
    if _is_real_key(_env("OPENAI_API_KEY")):
        return OpenAIEngine(
            api_key=_env("OPENAI_API_KEY") or "",
            model=_env("OPENAI_MODEL", "LLM_MODEL") or "gpt-4o-mini",
            base_url=_env("OPENAI_BASE_URL"),
        )

    return MockEngine()


# ==============================================================================
# 3. "PIPELINE": CHẠY LLM + BÓC THẺ CẢM XÚC + CHIA NHỎ ĐỂ STREAM
# ==============================================================================

_EMO_OPEN_RE = re.compile(r"^\s*<emo>\s*([a-z_]+)\s*</emo>", re.IGNORECASE)
_EMO_ANY_RE = re.compile(r"<\s*/?\s*emo\s*>", re.IGNORECASE)
# Phòng trường hợp model "rò" lại đúng tên cảm xúc ở đầu câu (vd: "happy\nCậu khoẻ không?")
_EMO_LEAK_RE = re.compile(
    r"^\s*(?:" + "|".join(EMOTIONS) + r")\s*[:\-–—,]?\s*\n?\s*",
    re.IGNORECASE,
)


def _clean_reply(text: str) -> str:
    """Bóc sạch mọi dấu vết của thẻ cảm xúc khỏi nội dung trả về."""
    cleaned = _EMO_ANY_RE.sub(" ", text)
    # Chỉ cắt từ khoá cảm xúc khi nó đứng lẻ ở đầu câu (tránh cắt nhầm từ thật).
    leaked = _EMO_LEAK_RE.match(cleaned)
    if leaked:
        candidate = cleaned[leaked.end():]
        if candidate[:1].isupper() or candidate.startswith(("~", "*", "(", "「")):
            cleaned = candidate
    return re.sub(r"[ \t]{2,}", " ", cleaned).strip()


def infer_emotion(text: str) -> str:
    """Đoán cảm xúc khi LLM không chịu trả về thẻ <emo> (heuristic dự phòng)."""
    low = _norm(text)
    if any(k in low for k in ("hihi", "vui", "tuyet", "yeah", "~", "hahaha")):
        return "happy"
    if any(k in low for k in ("ngai", "do mat", "害羞", "hichic")):
        return "shy"
    if any(k in low for k in ("buon", "tiec", "sorry", "xin loi", "huhu")):
        return "sad"
    if any(k in low for k in ("gian", "huh", "dung vay", "khong phai")):
        return "angry"
    if "?" in text:
        return "thinking"
    return "neutral"


def _split_safe(text: str) -> tuple[str, str]:
    """Tách phần chắc chắn an toàn để gửi đi và phần giữ lại (tránh lộ thẻ dở dang)."""
    idx = text.rfind("<")
    if idx != -1 and ">" not in text[idx:]:
        return text[:idx], text[idx:]
    return text, ""


def pipeline(
    engine: BaseEngine,
    messages: List[Dict[str, str]],
    system_prompt: str,
    context: Optional[Dict[str, Any]] = None,
) -> Iterator[Dict[str, Any]]:
    """
    Chạy engine và phát ra các sự kiện:
      {'type': 'emotion', 'emotion': '...'}
      {'type': 'delta',   'text': '...'}
      {'type': 'final',   'text': '...', 'emotion': '...'}
    """
    emotion: Optional[str] = None
    revealed = False      # Đã xử lý xong phần thẻ cảm xúc ở đầu câu chưa?
    hold = ""             # Buffer giữ lại các ký tự có thể là thẻ dở dang
    collected: List[str] = []

    for chunk in engine.stream(messages, system_prompt, context):
        if not chunk:
            continue

        if not revealed:
            hold += chunk

            match = _EMO_OPEN_RE.match(hold)
            if match:
                emotion = match.group(1).lower()
                if emotion not in EMOTIONS:
                    emotion = "neutral"
                rest = hold[match.end():]
                revealed = True
                hold = ""
                yield {"type": "emotion", "emotion": emotion}
                if rest:
                    collected.append(rest)
                    yield {"type": "delta", "text": rest}
                continue

            # Thẻ cảm xúc có thể vẫn đang được "gõ" dở (ví dụ "<em", "<emo>hap"):
            # cứ giữ lại chờ thêm cho tới khi thấy thẻ đóng </emo>.
            probe = hold.lstrip()
            if probe.startswith("<") and len(probe) < 40 and "</emo>" not in probe.lower():
                continue

            # Không có thẻ nào -> tự suy luận cảm xúc rồi công bố luôn.
            revealed = True
            emotion = infer_emotion(hold)
            collected.append(hold)
            yield {"type": "emotion", "emotion": emotion}
            yield {"type": "delta", "text": hold}
            hold = ""
            continue

        hold += chunk
        safe, hold = _split_safe(hold)
        if safe:
            collected.append(safe)
            yield {"type": "delta", "text": safe}

    # Xả nốt phần còn lại trong buffer.
    if hold:
        collected.append(hold)

    text = _clean_reply("".join(collected))
    yield {"type": "final", "text": text, "emotion": emotion or "neutral"}


# ==============================================================================
# 4. FLASK APP
# ==============================================================================

app = Flask(__name__)
ENGINE: BaseEngine = create_engine()
LAST_ERROR: Optional[str] = None
# Thông báo "đang offline" chỉ hiện MỘT lần mỗi phiên — nếu không, mỗi câu trả lời
# lại bật banner cảnh báo khiến người dùng khó chịu.
OFFLINE_NOTICE_SHOWN = False


@app.after_request
def _add_cors_headers(response: Response) -> Response:
    """Cho phép gọi API từ cổng khác (Vite dev server / file:// ...)."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.route("/api/<path:_any>", methods=["OPTIONS"])
def _preflight(_any: str) -> Response:  # pragma: no cover - chỉ phục vụ CORS
    return Response(status=204)


def _sse(payload: Dict[str, Any]) -> str:
    return "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"


def normalize_messages(raw: Any) -> List[Dict[str, str]]:
    """Chuẩn hoá & giới hạn lịch sử hội thoại nhận từ client."""
    if not isinstance(raw, list):
        return []

    cleaned: List[Dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        content = content.strip()[:MAX_CHARS_PER_MESSAGE]
        if content:
            cleaned.append({"role": role, "content": content})

    return cleaned[-MAX_HISTORY:]


def _read_request() -> Dict[str, Any]:
    payload = request.get_json(silent=True) or {}
    try:
        affection = int(payload.get("affection", 0))
    except (TypeError, ValueError):
        affection = 0

    persona = str(payload.get("persona") or DEFAULT_PERSONA).lower()
    if persona not in PERSONAS:
        persona = DEFAULT_PERSONA

    language = str(payload.get("language") or DEFAULT_LANGUAGE).lower()
    if language not in LANGUAGES:
        language = DEFAULT_LANGUAGE

    return {
        "messages": normalize_messages(payload.get("messages")),
        "persona": persona,
        "language": language,
        "affection": max(0, min(100, affection)),
        "user_name": (str(payload.get("userName") or "cậu").strip()[:24] or "cậu"),
        "time_of_day": str(payload.get("timeOfDay") or "").strip()[:80],
    }


@app.get("/api/health")
def api_health() -> Response:
    """Frontend dùng để hiển thị badge 'Online / Offline'.

    Nếu engine thật đang lỗi (key hỏng, mất mạng…) thì báo luôn là Kei đang chạy
    bộ não offline — tránh hiển thị "online OpenAI" trong khi thực tế không phải.
    """
    engine_info = ENGINE.describe()
    configured = dict(engine_info)
    if LAST_ERROR:
        engine_info = MockEngine().describe()

    return jsonify(
        {
            "ok": True,
            "engine": engine_info,
            "configured_engine": configured,
            "last_error": LAST_ERROR,
            "personas": [
                {"id": key, "label": value["label"], "emoji": value["emoji"]}
                for key, value in PERSONAS.items()
            ],
            "languages": [{"id": key, "label": value} for key, value in LANGUAGES.items()],
            "emotions": list(EMOTIONS),
            "tts": {
                "available": LAST_TTS_PROVIDER is not None or EDGE_TTS_FALLBACK or isinstance(ENGINE, OpenAIEngine),
                "provider": LAST_TTS_PROVIDER
                or ("openai" if isinstance(ENGINE, OpenAIEngine) else ("edge-tts" if EDGE_TTS_FALLBACK else "browser")),
                "model": TTS_MODEL,
                "voice": EDGE_TTS_VOICES.get("vi", "") if LAST_TTS_PROVIDER == "edge-tts" else TTS_VOICE,
                "fallback": EDGE_TTS_FALLBACK,
                "last_error": LAST_TTS_ERROR,
            },
        }
    )


@app.post("/api/chat")
def api_chat() -> Response:
    """Bản không-stream (dự phòng khi môi trường không hỗ trợ SSE)."""
    global LAST_ERROR, OFFLINE_NOTICE_SHOWN
    options = _read_request()
    if not options["messages"]:
        return jsonify({"error": "Thiếu nội dung hội thoại."}), 400

    system_prompt = build_system_prompt(
        options["persona"], options["language"], options["affection"],
        options["user_name"], options["time_of_day"],
    )

    engine = ENGINE
    try:
        result = _collect(engine, options["messages"], system_prompt, options)
        LAST_ERROR = None  # engine chạy được trở lại
    except EngineError as exc:
        LAST_ERROR = str(exc)
        engine = MockEngine()
        result = _collect(engine, options["messages"], system_prompt, options)
        if not OFFLINE_NOTICE_SHOWN:
            OFFLINE_NOTICE_SHOWN = True
            result["notice"] = f"⚠️ {exc} Kei đang trả lời bằng bộ não offline."

    result["engine"] = engine.describe()
    return jsonify(result)


def _collect(
    engine: BaseEngine,
    messages: List[Dict[str, str]],
    system_prompt: str,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    final: Dict[str, Any] = {"text": "", "emotion": "neutral"}
    for event in pipeline(engine, messages, system_prompt, context):
        if event["type"] == "final":
            final = {"text": event["text"], "emotion": event["emotion"]}
    return final


@app.post("/api/chat/stream")
def api_chat_stream() -> Response:
    """Endpoint chính: stream phản hồi của Kei về trình duyệt theo chuẩn SSE."""
    options = _read_request()
    if not options["messages"]:
        return jsonify({"error": "Thiếu nội dung hội thoại."}), 400

    global LAST_ERROR
    system_prompt = build_system_prompt(
        options["persona"], options["language"], options["affection"],
        options["user_name"], options["time_of_day"],
    )
    messages = options["messages"]
    engine = ENGINE

    def generate() -> Iterator[str]:
        global LAST_ERROR, OFFLINE_NOTICE_SHOWN
        yield _sse(
            {
                "type": "meta",
                "engine": engine.describe(),
                "persona": options["persona"],
                "language": options["language"],
            }
        )

        produced = False
        final: Dict[str, Any] = {"text": "", "emotion": "neutral"}
        try:
            for event in pipeline(engine, messages, system_prompt, options):
                if event["type"] == "final":
                    final = event
                    continue
                if event["type"] == "delta":
                    produced = produced or bool(event["text"].strip())
                yield _sse(event)
        except EngineError as exc:
            LAST_ERROR = str(exc)
            if not OFFLINE_NOTICE_SHOWN:
                OFFLINE_NOTICE_SHOWN = True
                yield _sse({"type": "notice", "message": f"⚠️ {exc} Kei chuyển sang bộ não offline nha!"})
            if produced:
                # Đã nói được một nửa: chỉ thêm câu chốt, không đọc lại từ đầu.
                tail = " ...Kei bị đứt kết nối rồi, cậu nói lại giúp Kei nhé!"
                final["text"] = (final.get("text") or "") + tail
                yield _sse({"type": "delta", "text": tail})
            else:
                for event in pipeline(MockEngine(), messages, system_prompt, options):
                    if event["type"] == "final":
                        final = event
                        continue
                    yield _sse(event)
        except Exception as exc:  # noqa: BLE001 - chốt chặn cuối cùng
            LAST_ERROR = str(exc)
            yield _sse({"type": "error", "message": f"Lỗi không mong đợi: {exc}"})
            return

        yield _sse(
            {
                "type": "done",
                "text": final.get("text", ""),
                "emotion": final.get("emotion", "neutral"),
            }
        )
        LAST_ERROR = None  # engine thật chạy được trở lại → badge về 'online'

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ------------------------------------------------------------------------------
# 4.1 GIỌNG KEI — TEXT TO SPEECH (giọng nữ anime dễ thương)
# ------------------------------------------------------------------------------

# Cache nhỏ trong RAM: các câu chào/lặp lại sẽ không tốn thêm tiền API.
_TTS_CACHE: "OrderedDict[str, bytes]" = OrderedDict()
_TTS_CACHE_MAX = 64
# Lỗi TTS gần nhất (key hết hạn, hết quota…) → hiển thị trong /api/health.
LAST_TTS_ERROR: Optional[str] = None
# Provider đã dùng cho lần tổng hợp gần nhất (openai / edge-tts).
LAST_TTS_PROVIDER: Optional[str] = None


def _edge_tts_synthesize(text: str, language: str, emotion: str) -> bytes:
    """Tổng hợp giọng nói MIỄN PHÍ bằng edge-tts (giọng nữ của Microsoft Edge).

    Dùng khi OpenAI TTS lỗi/chưa cấu hình: máy Windows thường KHÔNG có giọng nữ
    tiếng Việt, nên nếu để frontend tự đọc sẽ rơi vào giọng nam "Microsoft An".
    """
    import asyncio

    import edge_tts  # import muộn: chỉ cần khi thực sự dùng tới

    voice = EDGE_TTS_VOICES.get(language, EDGE_TTS_VOICES["vi"])
    rate, pitch = EDGE_TTS_EMOTION_TUNING.get(emotion, ("+0%", "+0Hz"))

    async def _collect() -> bytes:
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        audio = bytearray()
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                audio.extend(chunk.get("data") or b"")
        return bytes(audio)

    return asyncio.run(_collect())


def _synthesize_with_fallback(
    text: str, *, voice: str, emotion: str, language: str
) -> tuple:
    """Thử OpenAI TTS trước, lỗi/chưa cấu hình thì chuyển sang edge-tts.

    Trả về (audio_bytes, provider). Ném EngineError nếu không provider nào chạy được.
    """
    global LAST_TTS_ERROR, LAST_TTS_PROVIDER, _TTS_OPENAI_BLOCKED_UNTIL

    openai_error: Optional[str] = None
    if isinstance(ENGINE, OpenAIEngine):
        if time.monotonic() >= _TTS_OPENAI_BLOCKED_UNTIL:
            try:
                audio = ENGINE.synthesize(text, voice=voice or None, emotion=emotion or None)
                LAST_TTS_ERROR = None
                LAST_TTS_PROVIDER = "openai"
                return audio, "openai"
            except EngineError as exc:
                openai_error = str(exc)
                LAST_TTS_ERROR = openai_error
                if "401" in openai_error or "403" in openai_error:
                    # Key sai/hết hạn → đừng thử lại trong 5 phút cho mỗi câu.
                    _TTS_OPENAI_BLOCKED_UNTIL = time.monotonic() + _TTS_OPENAI_COOLDOWN
        else:
            openai_error = LAST_TTS_ERROR or "OpenAI TTS đang tạm bị bỏ qua (key lỗi)."
    else:
        openai_error = "Provider hiện tại không phải OpenAI nên không có TTS đám mây."

    if not EDGE_TTS_FALLBACK:
        LAST_TTS_ERROR = openai_error
        raise EngineError(openai_error)

    try:
        audio = _edge_tts_synthesize(text, language or "vi", emotion)
    except Exception as exc:  # noqa: BLE001 - thiếu package / mất mạng…
        LAST_TTS_ERROR = f"edge-tts: {exc}"
        raise EngineError(f"{openai_error} | edge-tts: {exc}") from exc

    if not audio:
        LAST_TTS_ERROR = "edge-tts không trả về audio."
        raise EngineError(LAST_TTS_ERROR)

    # Vẫn ghi nhận lỗi OpenAI để UI biết vì sao phải dùng giọng dự phòng.
    LAST_TTS_ERROR = openai_error
    LAST_TTS_PROVIDER = "edge-tts"
    return audio, "edge-tts"


@app.post("/api/tts")
def api_tts() -> Response:
    """Nhận text (+ cảm xúc, giọng, ngôn ngữ) → trả về mp3 giọng Kei.

    Luôn cố trả về GIỌNG NỮ: OpenAI TTS trước, lỗi thì edge-tts (HoaiMy cho tiếng
    Việt). Chỉ khi cả hai đều không chạy được mới để frontend tự xử lý.
    """
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text") or "").strip()
    text = _clean_reply(text)[:MAX_TTS_CHARS] if text else ""
    if not text:
        return jsonify({"error": "Thiếu nội dung để đọc."}), 400

    voice = str(payload.get("voice") or "").strip().lower()
    emotion = str(payload.get("emotion") or "").strip().lower()
    language = str(payload.get("language") or "vi").strip().lower()
    cache_key = f"{voice}|{emotion}|{language}|{text}"

    cached = _TTS_CACHE.get(cache_key)
    if cached is not None:
        _TTS_CACHE.move_to_end(cache_key)
        return Response(cached, mimetype="audio/mpeg", headers={"Cache-Control": "no-store"})

    engine = ENGINE
    global LAST_ERROR
    try:
        audio, provider = _synthesize_with_fallback(
            text, voice=voice, emotion=emotion, language=language
        )
    except EngineError as exc:
        LAST_ERROR = str(exc)
        return jsonify({"error": str(exc)}), 502

    _TTS_CACHE[cache_key] = audio
    while len(_TTS_CACHE) > _TTS_CACHE_MAX:
        _TTS_CACHE.popitem(last=False)

    return Response(
        audio,
        mimetype="audio/mpeg",
        headers={"Cache-Control": "no-store", "X-Kei-TTS-Provider": provider},
    )


def main() -> None:
    print("=" * 64)
    print("🌸  KEI — ANIME WAIFU CHAT GATEWAY")
    print("=" * 64)
    print(f"🔌 Engine    : {ENGINE.label} ({ENGINE.model})")
    print(f"🌐 Endpoint  : http://{HOST}:{PORT}")
    print(f"🩺 Health    : http://{HOST}:{PORT}/api/health")
    if not ENGINE.online:
        print("💡 Gợi ý     : điền OPENAI_API_KEY / GEMINI_API_KEY vào .env để Kei thông minh hơn.")
    print("=" * 64)
    app.run(host=HOST, port=PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
