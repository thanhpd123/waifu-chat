import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmotion } from './emotion';
import { loadAffection, loadSettings, saveAffection, saveSettings } from './storage';
import type { ChatMessage, WaifuSettings } from './types';
import { clamp, shorten, uid } from './utils';

/**
 * Nơi lưu các cuộc trò chuyện của Kei.
 *
 *  - `supabase`: đã đăng nhập → lưu trên server, đồng bộ giữa các thiết bị.
 *  - `local`   : chưa cấu hình Supabase → lưu trong localStorage của trình duyệt.
 *
 * Cả hai có cùng giao diện nên `useKei` không cần biết đang dùng loại nào.
 */

export interface ConversationSummary {
    id: string;
    title: string;
    updatedAt: number;
}

export interface Profile {
    affection: number;
    settings: Partial<WaifuSettings>;
}

export interface ChatStore {
    kind: 'supabase' | 'local';
    listConversations(): Promise<ConversationSummary[]>;
    createConversation(title: string): Promise<ConversationSummary>;
    renameConversation(id: string, title: string): Promise<void>;
    deleteConversation(id: string): Promise<void>;
    loadMessages(conversationId: string): Promise<ChatMessage[]>;
    addMessages(conversationId: string, messages: ChatMessage[]): Promise<void>;
    deleteMessages(conversationId: string, ids: string[]): Promise<void>;
    clearMessages(conversationId: string): Promise<void>;
    /** null = chưa có hồ sơ (người dùng mới). */
    loadProfile(): Promise<Profile | null>;
    saveProfile(profile: Profile): Promise<void>;
}

export const DEFAULT_TITLE = 'Cuộc trò chuyện mới';
const MAX_MESSAGES = 200;

/** Tiêu đề tự động từ câu đầu tiên của người dùng. */
export function titleFrom(text: string): string {
    return shorten(text, 42) || DEFAULT_TITLE;
}

/** Tin nhắn có được lưu không (bỏ lời chào tự sinh, tin hệ thống, tin rỗng). */
export function isPersistable(message: ChatMessage): boolean {
    return !message.system && !message.local && !message.streaming && message.content.trim().length > 0;
}

/* ============================== localStorage ============================== */

const LOCAL_PREFIX = 'kei.v2.';
const KEY_CONVERSATIONS = `${LOCAL_PREFIX}conversations`;
const KEY_LEGACY_MESSAGES = 'kei.v1.messages';
const messagesKey = (id: string) => `${LOCAL_PREFIX}messages.${id}`;

function readJSON<T>(key: string, fallback: T): T {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function writeJSON(key: string, value: unknown): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* localStorage đầy/bị chặn → bỏ qua */
    }
}

function removeKey(key: string): void {
    try {
        window.localStorage.removeItem(key);
    } catch {
        /* ignore */
    }
}

/** Lịch sử chat của phiên bản cũ (1 cuộc trò chuyện duy nhất trong localStorage). */
export function readLegacyMessages(): ChatMessage[] {
    const list = readJSON<ChatMessage[]>(KEY_LEGACY_MESSAGES, []);
    if (!Array.isArray(list)) return [];
    return list
        .filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
        .map(m => ({ ...m, id: uid(), streaming: false }));
}

export function clearLegacyMessages(): void {
    removeKey(KEY_LEGACY_MESSAGES);
}

export function createLocalStore(): ChatStore {
    const readList = () => readJSON<ConversationSummary[]>(KEY_CONVERSATIONS, []);
    const writeList = (list: ConversationSummary[]) => writeJSON(KEY_CONVERSATIONS, list);
    const touch = (id: string) =>
        writeList(readList().map(c => (c.id === id ? { ...c, updatedAt: Date.now() } : c)));

    // Chuyển lịch sử của bản cũ thành cuộc trò chuyện đầu tiên.
    const legacy = readLegacyMessages();
    if (legacy.length && !readList().length) {
        const firstUser = legacy.find(m => m.role === 'user');
        const id = uid();
        writeJSON(messagesKey(id), legacy.slice(-MAX_MESSAGES));
        writeList([{ id, title: firstUser ? titleFrom(firstUser.content) : DEFAULT_TITLE, updatedAt: Date.now() }]);
        clearLegacyMessages();
    }

    return {
        kind: 'local',
        async listConversations() {
            return [...readList()].sort((a, b) => b.updatedAt - a.updatedAt);
        },
        async createConversation(title) {
            const conversation = { id: uid(), title, updatedAt: Date.now() };
            writeList([conversation, ...readList()]);
            return conversation;
        },
        async renameConversation(id, title) {
            writeList(readList().map(c => (c.id === id ? { ...c, title } : c)));
        },
        async deleteConversation(id) {
            writeList(readList().filter(c => c.id !== id));
            removeKey(messagesKey(id));
        },
        async loadMessages(conversationId) {
            return readJSON<ChatMessage[]>(messagesKey(conversationId), []);
        },
        async addMessages(conversationId, messages) {
            const list = readJSON<ChatMessage[]>(messagesKey(conversationId), []);
            writeJSON(messagesKey(conversationId), [...list, ...messages].slice(-MAX_MESSAGES));
            touch(conversationId);
        },
        async deleteMessages(conversationId, ids) {
            const list = readJSON<ChatMessage[]>(messagesKey(conversationId), []);
            writeJSON(messagesKey(conversationId), list.filter(m => !ids.includes(m.id)));
        },
        async clearMessages(conversationId) {
            removeKey(messagesKey(conversationId));
        },
        async loadProfile() {
            return { affection: loadAffection(), settings: loadSettings() };
        },
        async saveProfile(profile) {
            saveAffection(profile.affection);
            saveSettings({ ...loadSettings(), ...profile.settings });
        },
    };
}

/* ================================ Supabase ================================ */

interface MessageRow {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    emotion: string | null;
    created_at: string;
}

interface ConversationRow {
    id: string;
    title: string;
    updated_at: string;
}

function toSummary(row: ConversationRow): ConversationSummary {
    return { id: row.id, title: row.title, updatedAt: Date.parse(row.updated_at) || Date.now() };
}

function check(error: { message: string } | null): void {
    if (error) throw new Error(error.message);
}

export function createSupabaseStore(client: SupabaseClient, userId: string): ChatStore {
    return {
        kind: 'supabase',
        async listConversations() {
            const { data, error } = await client
                .from('conversations')
                .select('id,title,updated_at')
                .order('updated_at', { ascending: false })
                .limit(100);
            check(error);
            return (data as ConversationRow[]).map(toSummary);
        },
        async createConversation(title) {
            const { data, error } = await client
                .from('conversations')
                .insert({ user_id: userId, title: title.slice(0, 120) })
                .select('id,title,updated_at')
                .single();
            check(error);
            return toSummary(data as ConversationRow);
        },
        async renameConversation(id, title) {
            const { error } = await client.from('conversations').update({ title: title.slice(0, 120) }).eq('id', id);
            check(error);
        },
        async deleteConversation(id) {
            const { error } = await client.from('conversations').delete().eq('id', id);
            check(error);
        },
        async loadMessages(conversationId) {
            const { data, error } = await client
                .from('messages')
                .select('id,role,content,emotion,created_at')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(MAX_MESSAGES);
            check(error);
            return (data as MessageRow[]).reverse().map(row => ({
                id: row.id,
                role: row.role,
                content: row.content,
                emotion: row.emotion ? normalizeEmotion(row.emotion) : undefined,
                at: Date.parse(row.created_at) || Date.now(),
            }));
        },
        async addMessages(conversationId, messages) {
            if (!messages.length) return;
            const { error } = await client.from('messages').insert(
                messages.map(message => ({
                    id: message.id,
                    conversation_id: conversationId,
                    user_id: userId,
                    role: message.role,
                    content: message.content.slice(0, 8000),
                    emotion: message.emotion ?? null,
                    created_at: new Date(message.at).toISOString(),
                })),
            );
            check(error);
        },
        async deleteMessages(conversationId, ids) {
            if (!ids.length) return;
            const { error } = await client
                .from('messages')
                .delete()
                .eq('conversation_id', conversationId)
                .in('id', ids);
            check(error);
        },
        async clearMessages(conversationId) {
            const { error } = await client.from('messages').delete().eq('conversation_id', conversationId);
            check(error);
        },
        async loadProfile() {
            const { data, error } = await client
                .from('profiles')
                .select('affection,settings')
                .eq('id', userId)
                .maybeSingle();
            check(error);
            if (!data) return null;
            const row = data as { affection: number; settings: Partial<WaifuSettings> | null };
            return { affection: clamp(row.affection, 0, 100), settings: row.settings ?? {} };
        },
        async saveProfile(profile) {
            const { error } = await client.from('profiles').upsert({
                id: userId,
                affection: clamp(Math.round(profile.affection), 0, 100),
                settings: profile.settings,
                updated_at: new Date().toISOString(),
            });
            check(error);
        },
    };
}
