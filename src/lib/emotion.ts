import type { Emotion } from './types';

/**
 * Bảng điều khiển "khuôn mặt" của Live2D.
 *
 * Các tham số dưới đây đều tồn tại trong `kei_vowels_pro.cdi3.json`:
 *   ParamCheek (Blush), ParamEyeLSmile / ParamEyeRSmile, ParamEyeLOpen / ParamEyeROpen,
 *   ParamBrowLY / ParamBrowRY, ParamBrowLForm / ParamBrowRForm, ParamAngleZ / ParamAngleY.
 */
export interface EmotionPose {
    /** 0 → 1: gò má ửng hồng. */
    cheek: number;
    /** 0 → 1: mắt cong hình chữ U (cười). */
    eyeSmile: number;
    /** 0 → 1.4: độ mở của mắt. */
    eyeOpen: number;
    /** -1 → 1: lông mày lên/xuống. */
    browY: number;
    /** -1 → 1: dáng lông mày (âm = xếch trong). */
    browForm: number;
    /** -30 → 30: nghiêng đầu (cộng thêm vào ParamAngleZ). */
    headTilt: number;
    /** -1 → 1: ngẩng/cúi đầu (cộng thêm vào ParamAngleY). */
    headPitch: number;
}

export const NEUTRAL_POSE: EmotionPose = {
    cheek: 0,
    eyeSmile: 0,
    eyeOpen: 1,
    browY: 0,
    browForm: 0,
    headTilt: 0,
    headPitch: 0,
};

/** Tư thế khuôn mặt cho từng cảm xúc. */
export const EMOTION_POSES: Record<Emotion, EmotionPose> = {
    neutral: { ...NEUTRAL_POSE },
    happy: { cheek: 0.35, eyeSmile: 1, eyeOpen: 1, browY: 0.35, browForm: 0.15, headTilt: 4, headPitch: -0.2 },
    shy: { cheek: 1, eyeSmile: 0.45, eyeOpen: 0.78, browY: 0.2, browForm: -0.35, headTilt: -9, headPitch: 0.45 },
    sad: { cheek: 0.12, eyeSmile: 0, eyeOpen: 0.55, browY: -0.65, browForm: -0.9, headTilt: -6, headPitch: 0.55 },
    angry: { cheek: 0.3, eyeSmile: 0, eyeOpen: 0.72, browY: -0.35, browForm: 1, headTilt: 0, headPitch: -0.15 },
    surprised: { cheek: 0.2, eyeSmile: 0, eyeOpen: 1.35, browY: 0.85, browForm: 0.4, headTilt: 0, headPitch: -0.35 },
    thinking: { cheek: 0.05, eyeSmile: 0.1, eyeOpen: 0.85, browY: 0.15, browForm: 0.3, headTilt: 7, headPitch: -0.15 },
    love: { cheek: 0.9, eyeSmile: 0.85, eyeOpen: 0.9, browY: 0.3, browForm: 0.1, headTilt: -6, headPitch: 0.1 },
};

export interface EmotionMeta {
    label: string;
    emoji: string;
    /** Màu nhấn cho bubble / viền tin nhắn. */
    accent: string;
}

export const EMOTION_META: Record<Emotion, EmotionMeta> = {
    neutral: { label: 'Bình thường', emoji: '🌸', accent: '#8be9fd' },
    happy: { label: 'Vui vẻ', emoji: '✨', accent: '#ffd166' },
    shy: { label: 'Ngại ngùng', emoji: '💗', accent: '#ff9ec7' },
    sad: { label: 'Buồn', emoji: '💧', accent: '#7aa2f7' },
    angry: { label: 'Dỗi', emoji: '💢', accent: '#ff7b72' },
    surprised: { label: 'Bất ngờ', emoji: '❗', accent: '#c39bff' },
    thinking: { label: 'Suy nghĩ', emoji: '💭', accent: '#9ece6a' },
    love: { label: 'Thương thương', emoji: '💖', accent: '#ff79c6' },
};

const EMOTION_ALIASES: Record<string, Emotion> = {
    normal: 'neutral',
    happy: 'happy',
    joy: 'happy',
    excited: 'happy',
    shy: 'shy',
    embarrassed: 'shy',
    blush: 'shy',
    sad: 'sad',
    cry: 'sad',
    lonely: 'sad',
    angry: 'angry',
    mad: 'angry',
    annoyed: 'angry',
    surprised: 'surprised',
    shock: 'surprised',
    thinking: 'thinking',
    curious: 'thinking',
    love: 'love',
    lovey: 'love',
    affectionate: 'love',
};

/** Chuẩn hoá giá trị cảm xúc nhận từ server (chấp nhận cả alias tiếng Anh). */
export function normalizeEmotion(raw: unknown): Emotion {
    if (typeof raw !== 'string') return 'neutral';
    const key = raw.trim().toLowerCase();
    if (key in EMOTION_META) return key as Emotion;
    return EMOTION_ALIASES[key] ?? 'neutral';
}

const EMO_TAG_RE = /<\s*\/?\s*emo\s*>/gi;
const EMO_LEAK_RE = /^\s*(?:neutral|happy|shy|sad|angry|surprised|thinking|love)\s*[:\-–—,]?\s*\n?\s*/i;

/**
 * Dọn nội dung Kei trả về: bóc thẻ cảm xúc còn sót và tên cảm xúc bị "rò" ở đầu câu.
 * Đây là lớp bảo hiểm phía client để UI luôn sạch dù backend có lỗi nhỏ.
 */
export function sanitizeAssistantText(text: string): string {
    let out = text.replace(EMO_TAG_RE, ' ');
    const leak = EMO_LEAK_RE.exec(out);
    if (leak) {
        const rest = out.slice(leak[0].length);
        if (/^[A-ZÀ-Ỹ~*(「]/.test(rest.trimStart())) out = rest;
    }
    return out.replace(/[ \t]{2,}/g, ' ').replace(/^\s+/, '');
}

export function detectEmotion(text: string): Emotion {
    const t = text.toLowerCase();
    if (/(hihi|haha|vui|tuyệt|hay quá|yay|✨|≧▽≦|dễ thương quá)/.test(t)) return 'happy';
    if (/(ngại|đỏ mặt|\/\/\/|hể|ơ\.\.\.|cậu khen|xấu hổ)/.test(t)) return 'shy';
    if (/(buồn|mệt|khóc|huhu|xin lỗi|đừng bỏ|một mình)/.test(t)) return 'sad';
    if (/(hừm|giận|dỗi|đồ ngốc|không phải đâu|💢)/.test(t)) return 'angry';
    if (/(ôi|thật sao|không thể tin|❗|bất ngờ|hả\?)/.test(t)) return 'surprised';
    if (/(để xem|hmm|nghĩ đã|💭|chờ kei)/.test(t)) return 'thinking';
    if (/(thương|yêu|thích cậu|💖|cưng)/.test(t)) return 'love';
    return 'neutral';
}
