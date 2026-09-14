import { closeMouth, opennessForChar, setMouth, shapeForChar } from './lipsync';
import { clamp } from './utils';
import { waifuBus } from './waifuBus';

/**
 * Giọng của Kei = HYBRID:
 *   1. Câu trả lời trong chat → TTS đúng ngôn ngữ (đọc được nội dung bất kỳ).
 *   2. Phản ứng (xoa đầu / vẫy tay / 🎤 / khi máy chưa có giọng TTS phù hợp)
 *      → clip thoại (.wav) có sẵn của model, do `Waifu.tsx` phát qua `waifuBus`.
 */

/**
 * Đọc câu trả lời bằng giọng nói của trình duyệt (Web Speech API) kèm
 * hiệu ứng nhép miệng cho Live2D.
 *
 * Web Speech API không cho truy cập trực tiếp luồng âm thanh, nên ta lái khẩu hình
 * theo hai cách:
 *   1. Sự kiện `boundary` (biết đang đọc tới ký tự nào) — chính xác nhất.
 *   2. Nếu trình duyệt không phát `boundary`, tự chạy một "timeline" ký tự theo tốc độ đọc.
 */

export const LANG_TAGS: Record<string, string> = {
    vi: 'vi-VN',
    ja: 'ja-JP',
    en: 'en-US',
};

/**
 * Tên giọng NỮ đã biết (Windows / macOS / Chrome / Edge — kể cả giọng online
 * của Edge như "Microsoft HoaiMy Online (Natural) - Vietnamese").
 */
const FEMALE_HINTS =
    /(hoai\s*my|hoaimy|linh|mai|thu|yui|kyoko|nanami|aoi|sakura|mayu|shiori|ayumi|haruka|sayaka|misaki|kaori|google|zira|aria|jenny|samantha|michelle|ava|emma|clara|female|nữ)/i;

/**
 * Tên giọng NAM — KHÔNG bao giờ dùng cho Kei.
 * (Trước đây máy chỉ có "Microsoft An" cho tiếng Việt nên Kei bị đọc bằng
 * giọng nam, nghe rất phá hình tượng nhân vật.)
 */
const MALE_HINTS =
    /(\bmicrosoft an\b|\ban\b|nam\s*minh|namminh|mark|david|ichiro|keita|daichi|naoki|masaru|guy|ryan|brandon|christopher|eric|fred|daniel|diego|jorge|male|\bnam\b)/i;

export type VoiceGender = 'female' | 'male' | 'unknown';

export interface VoiceOption {
    voiceURI: string;
    name: string;
    lang: string;
    gender: VoiceGender;
    local: boolean;
}

/** Đoán giới tính từ tên giọng (Web Speech API không cung cấp thông tin này). */
export function guessGender(name: string): VoiceGender {
    if (FEMALE_HINTS.test(name)) return 'female';
    if (MALE_HINTS.test(name)) return 'male';
    return 'unknown';
}

interface VoiceConfig {
    rate: number;
    pitch: number;
    voiceURI: string;
    femaleOnly: boolean;
    /** Giọng OpenAI TTS người dùng chọn ('' = mặc định của server, vd. `coral`). */
    serverVoice: string;
    /** Ngôn ngữ đang trả lời — server dùng để chọn giọng nữ dự phòng đúng tiếng. */
    language: string;
}

/** Cấu hình giọng đọc, đồng bộ từ bảng Cài đặt. */
const voiceConfig: VoiceConfig = {
    rate: 1,
    pitch: 1.15,
    voiceURI: '',
    femaleOnly: true,
    serverVoice: '',
    language: 'vi',
};

export function configureVoice(next: Partial<VoiceConfig>): void {
    Object.assign(voiceConfig, next);
}

let voices: SpeechSynthesisVoice[] = [];
let voicesBound = false;

export function isSpeechSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Danh sách giọng đọc khả dụng (ưu tiên giọng nữ, đúng ngôn ngữ). */
export function getVoices(): SpeechSynthesisVoice[] {
    if (!isSpeechSupported()) return [];
    const all = window.speechSynthesis.getVoices();
    if (all.length) voices = all;
    return voices;
}

/** Một số trình duyệt nạp danh sách giọng bất đồng bộ. */
export function onVoicesReady(callback: () => void): () => void {
    if (!isSpeechSupported()) return () => undefined;
    getVoices();
    const handler = () => {
        getVoices();
        callback();
    };
    if (!voicesBound) {
        window.speechSynthesis.addEventListener('voiceschanged', handler);
        voicesBound = true;
    }
    return () => window.speechSynthesis.removeEventListener('voiceschanged', handler);
}

export interface PickVoiceOptions {
    /** voiceURI người dùng chọn trong Cài đặt (bỏ qua nếu máy không còn giọng đó). */
    voiceURI?: string;
    /** Chỉ nhận giọng nữ; nếu máy không có giọng nữ đúng ngôn ngữ → trả về null. */
    femaleOnly?: boolean;
}

/**
 * Chọn giọng đọc theo thứ tự ưu tiên:
 *   1. Giọng người dùng đã chọn (nếu còn khả dụng).
 *   2. Giọng nữ đúng ngôn ngữ (HoaiMy/Linh cho tiếng Việt, Nanami/Ayumi cho tiếng Nhật…).
 *   3. Không có giọng nữ + `femaleOnly` → trả về null (thà không đọc còn hơn giọng nam).
 *
 * Không bao giờ fallback sang ngôn ngữ khác: Kei đọc tiếng Việt bằng giọng Anh
 * hoặc tiếng Nhật nghe rất "lạ".
 */
export function pickVoice(lang: string, options: PickVoiceOptions = {}): SpeechSynthesisVoice | null {
    const list = getVoices();
    if (!list.length) return null;

    const wantedURI = options.voiceURI ?? voiceConfig.voiceURI;
    if (wantedURI) {
        const chosen = list.find(v => v.voiceURI === wantedURI);
        if (chosen) return chosen;
    }

    const prefix = lang.split('-')[0].toLowerCase();
    const sameLang = list.filter(v => v.lang.toLowerCase().replace('_', '-').startsWith(prefix));
    if (!sameLang.length) return null;

    const female = sameLang.filter(v => guessGender(v.name) === 'female');
    if (female.length) return female[0] ?? null;

    const femaleOnly = options.femaleOnly ?? voiceConfig.femaleOnly;
    if (femaleOnly) return null; // máy chỉ có giọng nam → không dùng
    return sameLang.find(v => guessGender(v.name) !== 'male') ?? sameLang[0] ?? null;
}

/** Danh sách giọng đọc kèm giới tính đoán được — dùng cho dropdown trong Cài đặt. */
export function listVoices(lang?: string): VoiceOption[] {
    const prefix = lang ? (LANG_TAGS[lang] ?? LANG_TAGS.vi).split('-')[0].toLowerCase() : undefined;
    const rank = (option: VoiceOption) => (option.gender === 'female' ? 0 : option.gender === 'male' ? 2 : 1);
    return getVoices()
        .map(voice => ({
            voiceURI: voice.voiceURI,
            name: voice.name,
            lang: voice.lang,
            gender: guessGender(voice.name),
            local: voice.localService,
        }))
        .filter(option => !prefix || option.lang.toLowerCase().replace('_', '-').startsWith(prefix))
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Bỏ markdown/hành động/kaomoji để giọng đọc nghe tự nhiên. */
export function prepareForSpeech(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\*\*([^*]*)\*\*/g, '$1')
        .replace(/\*([^*]*)\*/g, ' ')
        .replace(/\([^)]*[•｡ᵕᴗω°◕‿][^)]*\)/g, ' ') // kaomoji trong ngoặc
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ')
        .replace(/[\u{2600}-\u{27BF}]/gu, ' ')
        .replace(/\u{FE0F}/gu, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

interface SpeakOptions {
    lang: string;
    rate: number;
    onStart?: () => void;
    onEnd?: () => void;
}

let mouthTimer: number | null = null;

function stopMouthDriver(): void {
    if (mouthTimer !== null) {
        window.clearInterval(mouthTimer);
        mouthTimer = null;
    }
    closeMouth();
}

let speaking = false;
export function isSpeaking(): boolean {
    return speaking;
}

/** Bắt đầu đọc `text`; trả về Promise kết thúc khi đọc xong (hoặc bị huỷ). */
export function speak(text: string, options: SpeakOptions): Promise<void> {
    const clean = prepareForSpeech(text);
    if (!isSpeechSupported() || !clean) {
        options.onEnd?.();
        return Promise.resolve();
    }

    return new Promise<void>(resolve => {
        const synth = window.speechSynthesis;
        synth.cancel();

        const utterance = new SpeechSynthesisUtterance(clean);
        utterance.lang = LANG_TAGS[options.lang] ?? LANG_TAGS.vi;
        utterance.rate = clamp(options.rate, 0.6, 1.4);
        utterance.pitch = clamp(voiceConfig.pitch, 0.5, 2); // cao hơn chút → giọng anime
        utterance.volume = 1;

        const voice = pickVoice(utterance.lang);
        if (voice) utterance.voice = voice;

        let boundaryIndex = 0;
        let lastBoundaryAt = 0;
        let boundaryHits = 0;
        let mode: 'unknown' | 'boundary' | 'synthetic' = 'unknown';
        let syntheticIndex = 0;

        const finish = () => {
            speaking = false;
            stopMouthDriver();
            options.onEnd?.();
            resolve();
        };

        utterance.onstart = () => {
            speaking = true;
            options.onStart?.();
            const startedAt = performance.now();
            let lastTick = startedAt;

            mouthTimer = window.setInterval(() => {
                const now = performance.now();
                const elapsed = now - startedAt;

                if (mode === 'unknown' && elapsed > 700) {
                    mode = boundaryHits >= 2 ? 'boundary' : 'synthetic';
                }

                if (mode === 'boundary') {
                    if (now - lastBoundaryAt > 700) {
                        // Khoảng lặng giữa các từ → khép miệng dần.
                        setMouth(Math.max(0, opennessForChar(' ')), 'A');
                        return;
                    }
                    const ch = clean[boundaryIndex] ?? 'a';
                    setMouth(opennessForChar(ch) * (0.85 + Math.random() * 0.3), shapeForChar(ch));
                    return;
                }

                if (mode === 'synthetic') {
                    // ~9.5 ký tự/giây ở tốc độ 1.0 (khớp tương đối với giọng đọc trung bình).
                    const charsPerSecond = 9.5 * utterance.rate;
                    const targetIndex = Math.floor(((now - startedAt) / 1000) * charsPerSecond);
                    if (targetIndex > syntheticIndex) {
                        syntheticIndex = targetIndex;
                        const ch = clean[syntheticIndex] ?? 'a';
                        setMouth(opennessForChar(ch) * (0.85 + Math.random() * 0.3), shapeForChar(ch));
                    }
                    return;
                }

                // Chưa xác định được chế độ: nhấp nháy nhẹ theo nhịp để miệng không "đơ".
                if (now - lastTick > 120) {
                    lastTick = now;
                    setMouth(0.35 + Math.random() * 0.35, 'A');
                }
            }, 55);
        };

        utterance.onboundary = event => {
            boundaryHits += 1;
            boundaryIndex = event.charIndex ?? 0;
            lastBoundaryAt = performance.now();
            if (mode === 'unknown' && boundaryHits >= 2) mode = 'boundary';
        };

        utterance.onend = finish;
        utterance.onerror = finish;

        try {
            synth.speak(utterance);
            // Một số trình duyệt đôi khi "kẹt" trạng thái paused sau khi cancel().
            if (synth.paused) synth.resume();
        } catch {
            finish();
        }
    });
}

export function stopSpeaking(): void {
    if (!isSpeechSupported()) return;
    window.speechSynthesis.cancel();
    speaking = false;
    stopMouthDriver();
}

/* ==========================================================================
   Giọng Kei lấy từ server (OpenAI TTS) — đọc đúng nội dung, giọng nữ anime
   ========================================================================== */

const TTS_ENDPOINT = '/api/tts';

let serverAudio: HTMLAudioElement | null = null;
let serverAudioUrl: string | null = null;

/** Dừng audio lấy từ server (nếu đang phát) + tắt nhép miệng. */
export function stopServerAudio(): void {
    stopMouthDriver();
    if (serverAudio) {
        serverAudio.onended = null;
        serverAudio.onerror = null;
        serverAudio.pause();
        serverAudio = null;
    }
    if (serverAudioUrl) {
        URL.revokeObjectURL(serverAudioUrl);
        serverAudioUrl = null;
    }
}

/**
 * Nhép miệng theo nội dung câu khi phát audio có sẵn (không có mốc thời gian từng từ).
 * Ước lượng tốc độ đọc để miệng khớp tương đối.
 */
function driveMouthByText(text: string): void {
    stopMouthDriver();
    const startedAt = performance.now();
    const charsPerSecond = 12;
    mouthTimer = window.setInterval(() => {
        const index = Math.floor(((performance.now() - startedAt) / 1000) * charsPerSecond);
        const ch = text[index];
        if (ch === undefined) {
            setMouth(0.15 + Math.random() * 0.25, 'A');
            return;
        }
        setMouth(opennessForChar(ch) * (0.85 + Math.random() * 0.3), shapeForChar(ch));
    }, 70);
}

/** Lấy mp3 từ server rồi phát + nhép miệng. Trả về true nếu phát được. */
async function playServerVoice(text: string, emotion?: string): Promise<boolean> {
    let blob: Blob;
    try {
        const response = await fetch(TTS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                emotion,
                voice: voiceConfig.serverVoice || undefined,
                language: voiceConfig.language,
            }),
        });
        if (!response.ok) return false;
        blob = await response.blob();
    } catch {
        return false;
    }
    if (!blob.size) return false;

    stopServerAudio();
    serverAudioUrl = URL.createObjectURL(blob);
    const audio = new Audio(serverAudioUrl);
    audio.volume = 1;
    serverAudio = audio;
    driveMouthByText(text);

    await new Promise<void>(resolve => {
        const done = () => resolve();
        audio.onended = done;
        audio.onerror = done;
        void audio.play().catch(done);
    });

    if (serverAudio === audio) stopServerAudio();
    return true;
}

/**
 * Phát "giọng Kei" cho một câu (hybrid, theo thứ tự ưu tiên):
 *   1. Server TTS (OpenAI, giọng nữ anime) → đọc ĐÚNG nội dung câu trả lời.
 *   2. TTS của trình duyệt nếu máy có giọng đúng ngôn ngữ.
 *   3. Clip thoại (.wav) có sẵn của model — đúng giọng gốc Kei, nhưng là câu thu sẵn.
 */
export async function speakAsKei(text: string, lang: string, rate: number, emotion?: string): Promise<void> {
    configureVoice({ rate, language: lang });
    const clean = prepareForSpeech(text);
    if (clean && (await playServerVoice(clean, emotion))) return;

    const tag = LANG_TAGS[lang] ?? LANG_TAGS.vi;
    if (clean && pickVoice(tag)) {
        await speak(text, { lang, rate });
        return;
    }
    // Máy không có giọng nữ đúng ngôn ngữ (hoặc backend TTS đang tắt) → phát clip
    // thoại gốc của Kei: thà "nói" bằng giọng Kei còn hơn đọc lời cô ấy bằng giọng nam.
    waifuBus.emit('sampleVoice', {});
}

/** Dừng mọi âm thanh của Kei: TTS, audio server và clip thoại của model. */
export function stopKeiVoice(): void {
    stopServerAudio();
    stopSpeaking();
    waifuBus.emit('stopVoice', null);
}
