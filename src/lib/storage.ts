import { clamp } from './utils';
import { DEFAULT_SETTINGS } from './types';
import type { ChatMessage, WaifuSettings } from './types';

const PREFIX = 'kei.v1.';
const KEY_MESSAGES = `${PREFIX}messages`;
const KEY_SETTINGS = `${PREFIX}settings`;
const KEY_AFFECTION = `${PREFIX}affection`;
const KEY_FIRST_SEEN = `${PREFIX}firstSeen`;

const MAX_STORED_MESSAGES = 80;

function read<T>(key: string, fallback: T): T {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function write(key: string, value: unknown): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* localStorage đầy hoặc bị chặn → bỏ qua, không làm chết app */
    }
}

export function loadMessages(): ChatMessage[] {
    const messages = read<ChatMessage[]>(KEY_MESSAGES, []);
    if (!Array.isArray(messages)) return [];
    return messages
        .filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
        .map(m => ({ ...m, streaming: false }))
        .slice(-MAX_STORED_MESSAGES);
}

export function saveMessages(messages: ChatMessage[]): void {
    write(KEY_MESSAGES, messages.filter(m => !m.system && m.content.trim()).slice(-MAX_STORED_MESSAGES));
}

export function clearMessages(): void {
    try {
        window.localStorage.removeItem(KEY_MESSAGES);
    } catch {
        /* ignore */
    }
}

export function loadSettings(): WaifuSettings {
    const stored = read<Partial<WaifuSettings>>(KEY_SETTINGS, {});
    return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(settings: WaifuSettings): void {
    write(KEY_SETTINGS, settings);
}

export function loadAffection(): number {
    return clamp(Number(read<number>(KEY_AFFECTION, 0)) || 0, 0, 100);
}

export function saveAffection(value: number): void {
    write(KEY_AFFECTION, clamp(value, 0, 100));
}

/** Ngày đầu tiên bắt đầu trò chuyện — dùng cho "kỷ niệm" trong bảng thông tin. */
export function firstSeen(): number {
    const existing = read<number>(KEY_FIRST_SEEN, 0);
    if (existing) return existing;
    const now = Date.now();
    write(KEY_FIRST_SEEN, now);
    return now;
}

export function resetAll(): void {
    try {
        [KEY_MESSAGES, KEY_SETTINGS, KEY_AFFECTION].forEach(key => window.localStorage.removeItem(key));
    } catch {
        /* ignore */
    }
}
/* --------------------------- Gợi ý cho người mới --------------------------- */

const KEY_HINT_SEEN = `${PREFIX}hintSeen`;

export function hasSeenHint(): boolean {
    return read<boolean>(KEY_HINT_SEEN, false) === true;
}

export function markHintSeen(): void {
    write(KEY_HINT_SEEN, true);
}