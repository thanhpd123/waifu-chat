import type { Emotion } from './types';

/**
 * Event bus siêu nhẹ nối ChatPanel ↔ Waifu.
 *
 * Dùng bus thay vì đẩy state qua props vì các sự kiện này mang tính "tức thời"
 * (Kei đổi nét mặt, đang suy nghĩ, được xoa đầu...) — không cần re-render cây React.
 */
export interface WaifuEvents {
    /** Đổi biểu cảm khuôn mặt. */
    emote: { emotion: Emotion; durationMs?: number };
    /** Bật/tắt bong bóng suy nghĩ "..." trên đầu Kei. */
    thinking: { active: boolean };
    /** Kei được xoa đầu / chạm vào. */
    pat: { source: 'hit' | 'click' };
    /**
     * Phát "giọng Kei" — chính là file thoại (.wav) có sẵn của model Live2D,
     * KHÔNG phải TTS. `index` chọn bản thoại: 0 = en, 1 = jp, 2 = ko, 3 = zh.
     */
    sampleVoice: { index?: number };
    /** Dừng giọng đang phát. */
    stopVoice: null;
    /** Kei vừa được cộng điểm thân thiết. */
    affectionUp: { level: number; delta: number };
}

type Handler<T> = (payload: T) => void;

const listeners = new Map<keyof WaifuEvents, Set<Handler<never>>>();

export const waifuBus = {
    on<K extends keyof WaifuEvents>(event: K, handler: Handler<WaifuEvents[K]>): () => void {
        let group = listeners.get(event);
        if (!group) {
            group = new Set<Handler<never>>();
            listeners.set(event, group);
        }
        group.add(handler as Handler<never>);
        return () => {
            group?.delete(handler as Handler<never>);
        };
    },

    emit<K extends keyof WaifuEvents>(event: K, payload: WaifuEvents[K]): void {
        const group = listeners.get(event);
        if (!group) return;
        for (const handler of group) {
            (handler as Handler<WaifuEvents[K]>)(payload);
        }
    },
};
