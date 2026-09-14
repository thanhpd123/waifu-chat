/**
 * Kiểu dữ liệu dùng chung cho toàn bộ app Kei.
 */

/** 8 cảm xúc mà backend có thể trả về qua thẻ `<emo>...</emo>`. */
export type Emotion =
    | 'neutral'
    | 'happy'
    | 'shy'
    | 'sad'
    | 'angry'
    | 'surprised'
    | 'thinking'
    | 'love';

export type Role = 'user' | 'assistant';

export interface ChatMessage {
    id: string;
    role: Role;
    content: string;
    /** Cảm xúc gắn với tin nhắn (chỉ có ở tin của Kei). */
    emotion?: Emotion;
    at: number;
    /** Đang được stream về (hiện con trỏ gõ chữ). */
    streaming?: boolean;
    /** Tin nhắn hệ thống (mất kết nối, thông báo...). */
    system?: boolean;
}

export interface PersonaInfo {
    id: string;
    label: string;
    emoji: string;
}

export interface LanguageInfo {
    id: string;
    label: string;
}

export interface EngineInfo {
    kind: string;
    label: string;
    model: string;
    online: boolean;
}

export interface TtsStatus {
    /** Backend có giọng AI dùng được (OpenAI hoặc edge-tts dự phòng). */
    available: boolean;
    /** `openai` | `edge-tts` | `browser` */
    provider: string;
    model: string;
    voice: string;
    /** Có bật provider dự phòng miễn phí (edge-tts) hay không. */
    fallback?: boolean;
    /** Lỗi gần nhất khi gọi TTS (key hết hạn, hết quota…) — null nếu đang chạy tốt. */
    last_error: string | null;
}

export interface HealthPayload {
    ok: boolean;
    engine: EngineInfo;
    last_error: string | null;
    personas: PersonaInfo[];
    languages: LanguageInfo[];
    tts?: TtsStatus;
}

export interface WaifuSettings {
    persona: string;
    language: string;
    userName: string;
    /** Bật đọc câu trả lời bằng giọng nói của trình duyệt. */
    voiceEnabled: boolean;
    /** Tốc độ đọc: 0.7 (chậm) → 1.3 (nhanh). */
    ttsRate: number;
    /** Cao độ giọng trình duyệt: 0.8 (trầm) → 1.5 (cao, kiểu anime). */
    ttsPitch: number;
    /** voiceURI giọng trình duyệt người dùng tự chọn ('' = tự chọn giọng nữ). */
    ttsVoiceURI: string;
    /** Giọng OpenAI TTS ('' = dùng mặc định của server, ví dụ `coral`). */
    ttsServerVoice: string;
    /** Chỉ dùng giọng nữ — thà không đọc còn hơn để giọng nam đọc lời Kei. */
    voiceFemaleOnly: boolean;
    /** Bật hiệu ứng âm thanh khi chạm vào Kei. */
    sfxEnabled: boolean;
    /** Kei tự chơi motion ngẫu nhiên khi rảnh. */
    autoMotion: boolean;
    /** Lớp cánh hoa anh đào rơi. */
    petals: boolean;
}

export const DEFAULT_SETTINGS: WaifuSettings = {
    persona: 'gentle',
    language: 'vi',
    userName: 'cậu',
    voiceEnabled: false,
    ttsRate: 1,
    ttsPitch: 1.15,
    ttsVoiceURI: '',
    ttsServerVoice: '',
    voiceFemaleOnly: true,
    sfxEnabled: true,
    autoMotion: true,
    petals: true,
};

/* ---------------------------------- SSE ---------------------------------- */

export interface StreamMetaEvent {
    type: 'meta';
    engine: EngineInfo;
    persona: string;
    language: string;
}
export interface StreamEmotionEvent {
    type: 'emotion';
    emotion: Emotion;
}
export interface StreamDeltaEvent {
    type: 'delta';
    text: string;
}
export interface StreamNoticeEvent {
    type: 'notice';
    message: string;
}
export interface StreamDoneEvent {
    type: 'done';
    text: string;
    emotion: Emotion;
}
export interface StreamErrorEvent {
    type: 'error';
    message: string;
}

export type StreamEvent =
    | StreamMetaEvent
    | StreamEmotionEvent
    | StreamDeltaEvent
    | StreamNoticeEvent
    | StreamDoneEvent
    | StreamErrorEvent;

export interface ChatRequest {
    messages: Array<{ role: Role; content: string }>;
    persona: string;
    language: string;
    affection: number;
    userName: string;
    timeOfDay: string;
}
