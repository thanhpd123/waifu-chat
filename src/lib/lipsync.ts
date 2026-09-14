/**
 * Kênh chia sẻ trạng thái "miệng" giữa lớp giọng nói (voice.ts) và lớp Live2D (Waifu.tsx).
 *
 * Voice engine ghi vào đây ở tần suất thấp (theo sự kiện `boundary` của SpeechSynthesis),
 * còn Waifu đọc ở mỗi frame render và tự làm mượt → không cần bắn event 60 lần/giây.
 */
export type MouthShape = 'A' | 'I' | 'U' | 'E' | 'O';

export interface MouthState {
    /** Độ mở miệng 0 → 1. */
    open: number;
    /** Khẩu hình nguyên âm đang phát âm (model kei_vowels_pro có ParamA/I/U/E/O). */
    shape: MouthShape;
    /** Có đang đọc TTS hay không. */
    active: boolean;
}

export const mouthState: MouthState = { open: 0, shape: 'A', active: false };

export function setMouth(open: number, shape: MouthShape = 'A'): void {
    mouthState.open = open < 0 ? 0 : open > 1 ? 1 : open;
    mouthState.shape = shape;
    mouthState.active = true;
}

export function closeMouth(): void {
    mouthState.open = 0;
    mouthState.active = false;
}

/**
 * Quy đổi một ký tự thành khẩu hình nguyên âm gần đúng.
 * Hỗ trợ cả tiếng Việt có dấu, tiếng Nhật (romaji/kana) và tiếng Anh.
 */
const VOWEL_PATTERNS: Array<[RegExp, MouthShape]> = [
    [/[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂÂ]/, 'A'],
    [/[iíìỉĩịyýỳỷỹỵIYÝỲỶỸỴ]/, 'I'],
    [/[uúùủũụưứừửữựUÙÚỦŨỤƯ]/, 'U'],
    [/[eéèẻẽẹêếềểễệEÈÉÊ]/, 'E'],
    [/[oóòỏõọôốồổỗộơớờởỡợOÒÓÔƠ]/, 'O'],
];

export function shapeForChar(ch: string): MouthShape {
    for (const [pattern, shape] of VOWEL_PATTERNS) {
        if (pattern.test(ch)) return shape;
    }
    // Phụ tố / khoảng lặng: hé miệng nhẹ ở khẩu hình A.
    return 'A';
}

/** Độ mở miệng ước lượng theo loại ký tự (nguyên âm mở to hơn phụ âm). */
export function opennessForChar(ch: string): number {
    if (/\s/.test(ch)) return 0;
    if (/[.,!?;:~…—-]/.test(ch)) return 0.08;
    return VOWEL_PATTERNS.some(([pattern]) => pattern.test(ch)) ? 0.72 : 0.32;
}
