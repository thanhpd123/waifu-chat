/** Tiện ích nhỏ dùng chung. */

/** Sinh id duy nhất (có fallback cho môi trường không hỗ trợ crypto.randomUUID). */
export function uid(): string {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Lời chào theo thời điểm trong ngày — dùng cho gợi ý & bối cảnh gửi lên Kei. */
export function timeOfDay(): { text: string; greeting: string } {
    const hour = new Date().getHours();
    if (hour < 5) return { text: 'đêm khuya (0h–5h)', greeting: 'Khuya rồi đó, cậu chưa ngủ sao?' };
    if (hour < 11) return { text: 'buổi sáng (5h–11h)', greeting: 'Chào buổi sáng~ Hôm nay của cậu thế nào?' };
    if (hour < 14) return { text: 'buổi trưa (11h–14h)', greeting: 'Trưa rồi, cậu ăn gì chưa đó?' };
    if (hour < 18) return { text: 'buổi chiều (14h–18h)', greeting: 'Buổi chiều yên bình nhỉ~ Cậu đang làm gì thế?' };
    if (hour < 22) return { text: 'buổi tối (18h–22h)', greeting: 'Tối rồi~ Hôm nay cậu có chuyện gì vui không?' };
    return { text: 'đêm muộn (22h–24h)', greeting: 'Muộn rồi đó nha, đừng thức khuya quá~' };
}

/** Rút gọn văn bản để hiển thị trong thông báo. */
export function shorten(text: string, max = 60): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
