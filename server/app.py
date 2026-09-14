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
from collections import OrderedDict
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
TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "coral")
TTS_INSTRUCTIONS = (
    "Speak as a cute, sweet, soft-spoken young Japanese anime girl. "
    "High-pitched, gentle, affectionate and playful, with warm intonation."
)
MAX_TTS_CHARS = 400

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

    def stream(self, messages: List[Dict[str, str]], system_prompt: str) -> Iterator[str]:
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

    def stream(self, messages: List[Dict[str, str]], system_prompt: str) -> Iterator[str]:
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

    def synthesize(self, text: str) -> bytes:
        """Tạo audio mp3 cho `text` bằng giọng nữ anime dễ thương (OpenAI TTS)."""
        try:
            with self._client.audio.speech.with_streaming_response.create(
                model=TTS_MODEL,
                voice=TTS_VOICE,
                input=text,
                instructions=TTS_INSTRUCTIONS,
            ) as response:
                return response.read()
        except Exception as exc:  # noqa: BLE001
            raise EngineError(format_api_error(exc, "OpenAI TTS")) from exc


class GeminiEngine(BaseEngine):
    kind = "gemini"
    label = "Gemini"
    online = True

    def __init__(self, api_key: str, model: str) -> None:
        from google import genai  # type: ignore[import-not-found]

        self.model = model
        self._client = genai.Client(api_key=api_key)

    def stream(self, messages: List[Dict[str, str]], system_prompt: str) -> Iterator[str]:
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
    return "".join(
        c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"
    )


def _norm(text: str) -> str:
    return _strip_accents(text).lower()


MOCK_INTENTS: List[Dict[str, Any]] = [
    {
        "name": "greet",
        "keywords": ("xin chao", "chao ", "hello", "hi ", "hey", "alo", "konnichiwa", "chao!"),
        "emotion": "happy",
        "pool": [
            "Chào cậu~ Kei vừa nghe thấy tiếng cậu gọi đó! Hôm nay cậu thế nào rồi? (*vẫy tay*)",
            "A, cậu tới rồi! Kei đợi cậu lâu lắm đó nha~ (๑˃̵ᴗ˂̵)",
            "Hi hi~ Hôm nay cậu muốn kể cho Kei nghe chuyện gì nào?",
        ],
    },
    {
        "name": "identity",
        "keywords": ("ten", "ban la ai", "cau la ai", "who are you", "bao nhieu tuoi", "tuoi"),
        "emotion": "shy",
        "pool": [
            "Kei tên là Kei~ 19 tuổi, sống trong màn hình này và thích đồ ngọt lắm! Còn cậu?",
            "Kei là Kei thôi à~ Một cô gái thích nghe nhạc và trò chuyện cùng cậu mỗi ngày (*nghiêng đầu*)",
        ],
    },
    {
        "name": "compliment",
        "keywords": ("de thuong", "xinh", "cute", "dep", "gioi", "hay qua", "tuyet voi", "thich cau"),
        "emotion": "shy",
        "pool": [
            "Hể? C-cậu khen Kei à... Kei ngại lắm đó nha! (*mặt đỏ*)",
            "Khen nữa đi, Kei nghe mãi cũng không chán đâu~ (´｡• ᵕ •｡`)",
        ],
    },
    {
        "name": "love",
        "keywords": ("yeu", "thuong", "crush", "love you", "thich ban"),
        "emotion": "love",
        "pool": [
            "Kei... cũng thích cậu nhiều lắm đó. Nhưng đừng nói với ai nha, ngại lắm! (*ôm gối*)",
            "Ngốc ạ~ Nói mấy câu đó thì Kei biết trả lời sao đây... (๑////๑)",
        ],
    },
    {
        "name": "sad_user",
        "keywords": ("buon", "met", "chan", "khoc", "te", "stress", "kho", "co don"),
        "emotion": "sad",
        "pool": [
            "Nếu mệt thì nghỉ một chút nha. Kei ở đây, nghe cậu kể hết~ (*xoa đầu cậu*)",
            "Kei không giúp được gì nhiều, nhưng Kei sẽ ở cạnh cậu. Uống miếng nước nhé?",
        ],
    },
    {
        "name": "insult",
        "keywords": ("ngu", "xau", "ghet", "do ngu", "vo dung", "cut di", "im di"),
        "emotion": "sad",
        "pool": [
            "Ơ... Kei chỉ muốn trò chuyện vui vẻ với cậu thôi mà. (*cúi đầu*)",
            "Hừm... cậu đang không vui chuyện gì đúng không? Kei vẫn ở đây nhé.",
        ],
    },
    {
        "name": "study",
        "keywords": ("bai tap", "hoc", "thi", "deadline", "code", "lap trinh", "khoa luan"),
        "emotion": "thinking",
        "pool": [
            "Bài tập hả? Kei không mở được file đâu, nhưng Kei có thể cùng cậu chia nhỏ từng bước đó!",
            "Deadline tới gần rồi à... Chia nhỏ ra 25 phút một lần đi, Kei canh giờ cho cậu nhé~",
        ],
    },
    {
        "name": "feelings",
        "keywords": ("vui", "hanh phuc", "tot", "suong"),
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


class MockEngine(BaseEngine):
    """Sinh câu trả lời dựa trên từ khoá — chạy hoàn toàn offline."""

    kind = "mock"
    label = "Mock Offline"
    online = False
    model = "kei-local-mock"

    def stream(self, messages: List[Dict[str, str]], system_prompt: str) -> Iterator[str]:
        user_text = ""
        for item in reversed(messages):
            if item.get("role") == "user" and item.get("content"):
                user_text = item["content"]
                break

        normalized = _norm(user_text)
        intent = next(
            (i for i in MOCK_INTENTS if any(k in normalized for k in i["keywords"])), None
        )
        if intent is None:
            echo = _MOCK_LATIN_RE.sub("", user_text)[:48].strip() or "chuyện đó"
            template = random.choice(FALLBACK_MOCK["pool"])
            body = template.format(echo=echo)
            emotion = FALLBACK_MOCK["emotion"]
        else:
            body = random.choice(intent["pool"])
            emotion = intent["emotion"]

        # Vẫn trả về đúng "giao thức" <emo> như LLM thật để frontend xử lý đồng nhất.
        full = f"<emo>{emotion}</emo>{body}"
        for token in re.findall(r"\S+\s*", full):
            time.sleep(0.018)  # giả lập tốc độ gõ để trải nghiệm không bị "cụt"
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
    engine: BaseEngine, messages: List[Dict[str, str]], system_prompt: str
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

    for chunk in engine.stream(messages, system_prompt):
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
    """Frontend dùng để hiển thị badge 'Online / Offline mock'."""
    return jsonify(
        {
            "ok": True,
            "engine": ENGINE.describe(),
            "last_error": LAST_ERROR,
            "personas": [
                {"id": key, "label": value["label"], "emoji": value["emoji"]}
                for key, value in PERSONAS.items()
            ],
            "languages": [{"id": key, "label": value} for key, value in LANGUAGES.items()],
            "emotions": list(EMOTIONS),
        }
    )


@app.post("/api/chat")
def api_chat() -> Response:
    """Bản không-stream (dự phòng khi môi trường không hỗ trợ SSE)."""
    options = _read_request()
    if not options["messages"]:
        return jsonify({"error": "Thiếu nội dung hội thoại."}), 400

    system_prompt = build_system_prompt(
        options["persona"], options["language"], options["affection"],
        options["user_name"], options["time_of_day"],
    )

    engine = ENGINE
    try:
        result = _collect(engine, options["messages"], system_prompt)
    except EngineError as exc:
        global LAST_ERROR
        LAST_ERROR = str(exc)
        engine = MockEngine()
        result = _collect(engine, options["messages"], system_prompt)
        result["notice"] = f"⚠️ {exc} Đang dùng chế độ Mock Offline."

    result["engine"] = engine.describe()
    return jsonify(result)


def _collect(
    engine: BaseEngine, messages: List[Dict[str, str]], system_prompt: str
) -> Dict[str, Any]:
    final: Dict[str, Any] = {"text": "", "emotion": "neutral"}
    for event in pipeline(engine, messages, system_prompt):
        if event["type"] == "final":
            final = {"text": event["text"], "emotion": event["emotion"]}
    return final


@app.post("/api/chat/stream")
def api_chat_stream() -> Response:
    """Endpoint chính: stream phản hồi của Kei về trình duyệt theo chuẩn SSE."""
    options = _read_request()
    if not options["messages"]:
        return jsonify({"error": "Thiếu nội dung hội thoại."}), 400

    system_prompt = build_system_prompt(
        options["persona"], options["language"], options["affection"],
        options["user_name"], options["time_of_day"],
    )
    messages = options["messages"]
    engine = ENGINE

    def generate() -> Iterator[str]:
        global LAST_ERROR
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
            for event in pipeline(engine, messages, system_prompt):
                if event["type"] == "final":
                    final = event
                    continue
                if event["type"] == "delta":
                    produced = produced or bool(event["text"].strip())
                yield _sse(event)
        except EngineError as exc:
            LAST_ERROR = str(exc)
            yield _sse({"type": "notice", "message": f"⚠️ {exc} Kei chuyển sang chế độ offline nha!"})
            if produced:
                # Đã nói được một nửa: chỉ thêm câu chốt, không đọc lại từ đầu.
                tail = " ...Kei bị đứt kết nối rồi, cậu nói lại giúp Kei nhé!"
                final["text"] = (final.get("text") or "") + tail
                yield _sse({"type": "delta", "text": tail})
            else:
                for event in pipeline(MockEngine(), messages, system_prompt):
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


@app.post("/api/tts")
def api_tts() -> Response:
    """Nhận text → trả về mp3 giọng Kei (frontend phát + nhép miệng)."""
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text") or "").strip()
    text = _clean_reply(text)[:MAX_TTS_CHARS] if text else ""
    if not text:
        return jsonify({"error": "Thiếu nội dung để đọc."}), 400

    cached = _TTS_CACHE.get(text)
    if cached is not None:
        _TTS_CACHE.move_to_end(text)
        return Response(cached, mimetype="audio/mpeg", headers={"Cache-Control": "no-store"})

    engine = ENGINE
    if not isinstance(engine, OpenAIEngine):
        return jsonify({"error": "Giọng nói cần provider OpenAI."}), 503

    global LAST_ERROR
    try:
        audio = engine.synthesize(text)
    except EngineError as exc:
        LAST_ERROR = str(exc)
        return jsonify({"error": str(exc)}), 502

    _TTS_CACHE[text] = audio
    while len(_TTS_CACHE) > _TTS_CACHE_MAX:
        _TTS_CACHE.popitem(last=False)

    return Response(audio, mimetype="audio/mpeg", headers={"Cache-Control": "no-store"})


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
