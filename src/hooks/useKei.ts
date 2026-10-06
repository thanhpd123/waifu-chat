import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchHealth, streamChat } from '../lib/api';
import {
    DEFAULT_TITLE,
    clearLegacyMessages,
    isPersistable,
    readLegacyMessages,
    titleFrom,
} from '../lib/chatStore';
import type { ChatStore, ConversationSummary } from '../lib/chatStore';
import { detectEmotion, sanitizeAssistantText } from '../lib/emotion';
import { firstSeen, loadAffection, loadSettings, saveAffection, saveSettings } from '../lib/storage';
import { DEFAULT_SETTINGS } from '../lib/types';
import type { ChatMessage, EngineInfo, HealthPayload, PersonaInfo, WaifuSettings } from '../lib/types';
import { clamp, timeOfDay, uid } from '../lib/utils';
import { speakAsKei, stopKeiVoice, configureVoice } from '../lib/voice';
import { waifuBus } from '../lib/waifuBus';

/** Điểm thân thiết cộng thêm mỗi lần trò chuyện. */
const AFFECTION_PER_MESSAGE = 2;
const AFFECTION_BONUS_LONG_MESSAGE = 1;
const AFFECTION_START_BONUS = 5;
/** Gom các thay đổi cài đặt/độ thân thiết rồi mới ghi lên server. */
const PROFILE_SAVE_DELAY = 900;

function greetingMessage(): ChatMessage {
    const { greeting } = timeOfDay();
    return {
        id: uid(),
        role: 'assistant',
        content: `Kei đây~ ${greeting} (*chớp mắt*)`,
        at: Date.now(),
        local: true,
    };
}

interface UseKeiOptions {
    /** Nơi lưu các cuộc trò chuyện (Supabase khi đã đăng nhập, localStorage nếu không). */
    store: ChatStore;
    /** Tên gọi mặc định của người dùng (lấy từ tài khoản đăng nhập). */
    defaultUserName?: string;
}

/**
 * "Bộ não" phía React: quản lý các cuộc trò chuyện, cấu hình, độ thân thiết và kết nối backend.
 */
export function useKei({ store, defaultUserName }: UseKeiOptions) {
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [settings, setSettings] = useState<WaifuSettings>(() => loadSettings());
    const [affection, setAffection] = useState<number>(() => loadAffection() || AFFECTION_START_BONUS);
    const [profileReady, setProfileReady] = useState(false);
    const [engine, setEngine] = useState<EngineInfo | null>(null);
    const [health, setHealth] = useState<HealthPayload | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const affectionRef = useRef(affection);
    affectionRef.current = affection;
    const activeIdRef = useRef(activeId);
    activeIdRef.current = activeId;

    /** Lỗi khi lưu (mất mạng, phiên hết hạn…) chỉ báo nhẹ, không chặn việc chat. */
    const reportStoreError = useCallback((error: unknown) => {
        console.error('[Kei] Lỗi lưu trữ:', error);
        setNotice('Kei chưa lưu được cuộc trò chuyện (mất mạng hoặc phiên đăng nhập hết hạn?).');
    }, []);

    const persist = useCallback(
        (conversationId: Promise<string | null>, list: ChatMessage[]) => {
            const items = list.filter(isPersistable);
            if (!items.length) return;
            void conversationId
                .then(id => (id ? store.addMessages(id, items) : undefined))
                .catch(reportStoreError);
        },
        [store, reportStoreError],
    );

    /** Đưa cuộc trò chuyện lên đầu danh sách (vừa có tin nhắn mới). */
    const bumpConversation = useCallback((id: string) => {
        setConversations(current => {
            const found = current.find(c => c.id === id);
            if (!found) return current;
            return [{ ...found, updatedAt: Date.now() }, ...current.filter(c => c.id !== id)];
        });
    }, []);

    /* ------------------------------ Khởi động ------------------------------ */

    useEffect(() => {
        let alive = true;
        (async () => {
            const payload = await fetchHealth();
            if (!alive) return;
            setHealth(payload);
            setEngine(
                payload?.engine ?? { kind: 'local-mock', label: 'Kei Offline', model: 'trong-trình-duyệt', online: false },
            );
            if (!payload) {
                setNotice('Chưa kết nối được server Kei — đang dùng chế độ trò chuyện offline.');
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    /** Nạp hồ sơ (độ thân thiết + cài đặt) và danh sách cuộc trò chuyện. */
    useEffect(() => {
        let alive = true;
        firstSeen();
        (async () => {
            try {
                const profile = await store.loadProfile();
                if (!alive) return;
                if (profile) {
                    setAffection(profile.affection || AFFECTION_START_BONUS);
                    setSettings(current => ({ ...current, ...profile.settings }));
                }
            } catch (error) {
                if (alive) reportStoreError(error);
            }
            if (alive) {
                // Tài khoản mới: lấy tên từ Google/email thay vì "cậu" mặc định.
                if (defaultUserName) {
                    setSettings(current =>
                        current.userName === DEFAULT_SETTINGS.userName ? { ...current, userName: defaultUserName } : current,
                    );
                }
                setProfileReady(true);
            }

            try {
                let list = await store.listConversations();
                // Lần đầu đăng nhập: chuyển lịch sử cũ trong trình duyệt lên tài khoản.
                const legacy = store.kind === 'supabase' && !list.length ? readLegacyMessages() : [];
                if (legacy.length) {
                    const firstUser = legacy.find(m => m.role === 'user');
                    const created = await store.createConversation(
                        firstUser ? titleFrom(firstUser.content) : DEFAULT_TITLE,
                    );
                    await store.addMessages(created.id, legacy.filter(isPersistable));
                    clearLegacyMessages();
                    list = [created];
                }
                if (!alive) return;
                setConversations(list);
                const latest = list[0];
                if (latest) {
                    const history = await store.loadMessages(latest.id);
                    if (!alive) return;
                    setActiveId(latest.id);
                    setMessages(history);
                }
            } catch (error) {
                if (alive) reportStoreError(error);
            } finally {
                if (alive) setLoadingHistory(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, [store, defaultUserName, reportStoreError]);

    /**
     * Lời chào khi hộp thư trống — cuộc trò chuyện mới, hoặc sau khi xoá lịch sử.
     * Lời chào chỉ để hiển thị (`local`), không lưu vào database.
     */
    const messagesEmpty = messages.length === 0;
    useEffect(() => {
        if (!messagesEmpty || loadingHistory) return;
        setMessages([greetingMessage()]);
    }, [messagesEmpty, loadingHistory]);

    /* ------------------------------- Lưu trữ ------------------------------- */

    // Bản sao trong localStorage để lần mở sau hiện ngay, không phải chờ server.
    useEffect(() => {
        saveSettings(settings);
    }, [settings]);

    useEffect(() => {
        saveAffection(affection);
    }, [affection]);

    useEffect(() => {
        if (!profileReady) return;
        const timer = window.setTimeout(() => {
            void store.saveProfile({ affection, settings }).catch(reportStoreError);
        }, PROFILE_SAVE_DELAY);
        return () => window.clearTimeout(timer);
    }, [store, profileReady, affection, settings, reportStoreError]);

    /* ------------------------------- Hành động ----------------------------- */

    const addAffection = useCallback((delta: number) => {
        const current = affectionRef.current;
        const next = clamp(current + delta, 0, 100);
        if (next === current) return;
        // Cập nhật ref ngay để nhiều lần cộng liên tiếp không bị "đè" nhau,
        // và chỉ phát sự kiện SAU khi rời khỏi pha render (tránh warning của React).
        affectionRef.current = next;
        setAffection(next);
        waifuBus.emit('affectionUp', { level: next, delta: next - current });
    }, []);

    /** Id cuộc trò chuyện hiện tại; tạo mới (đặt tên theo câu đầu tiên) nếu chưa có. */
    const ensureConversation = useCallback(
        async (firstText: string): Promise<string | null> => {
            const existing = activeIdRef.current;
            if (existing) {
                bumpConversation(existing);
                return existing;
            }
            try {
                const created = await store.createConversation(titleFrom(firstText));
                activeIdRef.current = created.id;
                setActiveId(created.id);
                setConversations(current => [created, ...current.filter(c => c.id !== created.id)]);
                return created.id;
            } catch (error) {
                reportStoreError(error);
                return null;
            }
        },
        [store, bumpConversation, reportStoreError],
    );

    const finishStream = useCallback(
        (
            assistantId: string,
            conversationId: Promise<string | null>,
            payload: { text: string; emotion: ChatMessage['emotion']; offline: boolean },
        ) => {
            setMessages(current =>
                current.map(message =>
                    message.id === assistantId
                        ? {
                            ...message,
                            content: payload.text || message.content,
                            emotion: payload.emotion ?? message.emotion,
                            streaming: false,
                        }
                        : message,
                ),
            );
            if (payload.text) {
                persist(conversationId, [
                    { id: assistantId, role: 'assistant', content: payload.text, emotion: payload.emotion, at: Date.now() },
                ]);
            }
            waifuBus.emit('thinking', { active: false });
            waifuBus.emit('emote', { emotion: payload.emotion ?? 'neutral', durationMs: 7000 });

            // Kei "nói": giọng nữ anime từ server (đúng nội dung), có fallback.
            // Truyền kèm cảm xúc để server đổi sắc thái giọng theo thẻ <emo>.
            if (payload.text && settingsRef.current.voiceEnabled) {
                void speakAsKei(
                    payload.text,
                    settingsRef.current.language,
                    settingsRef.current.ttsRate,
                    payload.emotion ?? undefined,
                );
            }
        },
        [persist],
    );

    const runStream = useCallback(
        async (history: ChatMessage[], conversationId: Promise<string | null>) => {
            const request = {
                messages: history
                    .filter(m => !m.system && m.content.trim())
                    .map(m => ({ role: m.role, content: m.content })),
                persona: settingsRef.current.persona,
                language: settingsRef.current.language,
                affection: affectionRef.current,
                userName: settingsRef.current.userName || 'cậu',
                timeOfDay: timeOfDay().text,
            };

            const assistantId = uid();
            setMessages(current => [
                ...current,
                { id: assistantId, role: 'assistant', content: '', at: Date.now(), streaming: true, emotion: 'thinking' },
            ]);
            setBusy(true);
            waifuBus.emit('thinking', { active: true });

            const controller = new AbortController();
            abortRef.current = controller;

            let acc = '';

            try {
                await streamChat(
                    request,
                    {
                        onMeta: info => setEngine(info),
                        onNotice: message => setNotice(message),
                        onEmotion: emotion => {
                            waifuBus.emit('emote', { emotion, durationMs: 6000 });
                            setMessages(current =>
                                current.map(m => (m.id === assistantId ? { ...m, emotion } : m)),
                            );
                        },
                        onDelta: text => {
                            acc += text;
                            waifuBus.emit('thinking', { active: false });
                            const snapshot = sanitizeAssistantText(acc);
                            setMessages(current =>
                                current.map(m => (m.id === assistantId ? { ...m, content: snapshot } : m)),
                            );
                        },
                        onDone: payload => {
                            const text = sanitizeAssistantText(payload.text || acc);
                            finishStream(assistantId, conversationId, {
                                text,
                                emotion: payload.emotion ?? detectEmotion(text),
                                offline: payload.offline,
                            });
                        },
                        onError: message => {
                            setNotice(message);
                            setMessages(current =>
                                current.map(m =>
                                    m.id === assistantId
                                        ? { ...m, streaming: false, system: true, content: m.content || message }
                                        : m,
                                ),
                            );
                            waifuBus.emit('thinking', { active: false });
                        },
                    },
                    controller.signal,
                );
            } catch {
                waifuBus.emit('thinking', { active: false });
                setMessages(current =>
                    current.map(m => (m.id === assistantId ? { ...m, streaming: false } : m)),
                );
            } finally {
                abortRef.current = null;
                setBusy(false);
                setMessages(current =>
                    current.some(m => m.id === assistantId && m.streaming)
                        ? current.map(m => (m.id === assistantId ? { ...m, streaming: false } : m))
                        : current,
                );
            }
        },
        [finishStream],
    );

    /** Gửi một tin nhắn mới của người dùng. */
    const send = useCallback(
        (raw: string) => {
            const text = raw.trim();
            if (!text) return;

            stopKeiVoice();
            setNotice(null);

            const userMessage: ChatMessage = { id: uid(), role: 'user', content: text, at: Date.now() };
            const history = [...messages, userMessage];
            setMessages(history);
            addAffection(
                AFFECTION_PER_MESSAGE + (text.length > 60 ? AFFECTION_BONUS_LONG_MESSAGE : 0),
            );
            // Không chờ tạo cuộc trò chuyện xong mới hỏi Kei → trả lời nhanh như trước.
            const conversationId = ensureConversation(text);
            persist(conversationId, [userMessage]);
            void runStream(history, conversationId);
        },
        [messages, addAffection, ensureConversation, persist, runStream],
    );

    /** Gửi lại câu hỏi cuối cùng (bỏ câu trả lời gần nhất của Kei). */
    const regenerate = useCallback(() => {
        if (busy) return;
        const lastUserIndex = [...messages].reverse().findIndex(m => m.role === 'user');
        if (lastUserIndex === -1) return;
        const cutIndex = messages.length - lastUserIndex;
        const history = messages.slice(0, cutIndex);
        const removed = messages.slice(cutIndex).filter(isPersistable).map(m => m.id);
        const id = activeIdRef.current;
        if (id && removed.length) void store.deleteMessages(id, removed).catch(reportStoreError);
        stopKeiVoice();
        setMessages(history);
        void runStream(history, Promise.resolve(id));
    }, [busy, messages, runStream, store, reportStoreError]);

    const stop = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        stopKeiVoice();
        setBusy(false);
        waifuBus.emit('thinking', { active: false });
        setMessages(current => current.map(m => (m.streaming ? { ...m, streaming: false } : m)));
    }, []);

    /** Xoá toàn bộ tin nhắn của cuộc trò chuyện đang mở (giữ lại cuộc trò chuyện). */
    const clear = useCallback(() => {
        stop();
        const id = activeIdRef.current;
        if (id) void store.clearMessages(id).catch(reportStoreError);
        setMessages([]);
    }, [stop, store, reportStoreError]);

    /* --------------------------- Quản lý phiên chat -------------------------- */

    const newConversation = useCallback(() => {
        stop();
        setNotice(null);
        activeIdRef.current = null;
        setActiveId(null);
        setMessages([]);
    }, [stop]);

    const selectConversation = useCallback(
        async (id: string) => {
            if (id === activeIdRef.current) return;
            stop();
            setNotice(null);
            activeIdRef.current = id;
            setActiveId(id);
            setLoadingHistory(true);
            setMessages([]);
            try {
                const history = await store.loadMessages(id);
                if (activeIdRef.current === id) setMessages(history);
            } catch (error) {
                reportStoreError(error);
            } finally {
                if (activeIdRef.current === id) setLoadingHistory(false);
            }
        },
        [stop, store, reportStoreError],
    );

    const renameConversation = useCallback(
        (id: string, title: string) => {
            const clean = title.trim().slice(0, 120);
            if (!clean) return;
            setConversations(current => current.map(c => (c.id === id ? { ...c, title: clean } : c)));
            void store.renameConversation(id, clean).catch(reportStoreError);
        },
        [store, reportStoreError],
    );

    const deleteConversation = useCallback(
        (id: string) => {
            setConversations(current => current.filter(c => c.id !== id));
            void store.deleteConversation(id).catch(reportStoreError);
            if (id === activeIdRef.current) newConversation();
        },
        [store, newConversation, reportStoreError],
    );

    const changeSettings = useCallback((patch: Partial<WaifuSettings>) => {
        setSettings(current => ({ ...current, ...patch }));
    }, []);

    /** Đẩy cấu hình giọng xuống module voice (dùng chung cho mọi lần đọc). */
    useEffect(() => {
        configureVoice({
            rate: settings.ttsRate,
            pitch: settings.ttsPitch,
            voiceURI: settings.ttsVoiceURI,
            femaleOnly: settings.voiceFemaleOnly,
            serverVoice: settings.ttsServerVoice,
            language: settings.language,
        });
    }, [
        settings.ttsRate,
        settings.ttsPitch,
        settings.ttsVoiceURI,
        settings.voiceFemaleOnly,
        settings.ttsServerVoice,
        settings.language,
    ]);

    const resetAffection = useCallback(() => setAffection(0), []);

    const personas = useMemo<PersonaInfo[]>(
        () =>
            health?.personas ?? [
                { id: DEFAULT_SETTINGS.persona, label: 'Dịu dàng', emoji: '🌸' },
                { id: 'tsundere', label: 'Tsundere', emoji: '💢' },
                { id: 'genz', label: 'Gen Z', emoji: '✨' },
                { id: 'oneesan', label: 'Onee-san', emoji: '🍵' },
            ],
        [health],
    );

    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content);

    return {
        messages,
        settings,
        affection,
        engine,
        tts: health?.tts ?? null,
        busy,
        notice,
        personas,
        languages: health?.languages ?? [
            { id: 'vi', label: 'Tiếng Việt' },
            { id: 'ja', label: '日本語' },
            { id: 'en', label: 'English' },
        ],
        lastAssistant,
        conversations,
        activeId,
        loadingHistory,
        storeKind: store.kind,
        send,
        stop,
        clear,
        regenerate,
        newConversation,
        selectConversation,
        renameConversation,
        deleteConversation,
        changeSettings,
        resetAffection,
        dismissNotice: () => setNotice(null),
    };
}
/** Kiểu dữ liệu trả về của hook — dùng để truyền xuống component con. */
export type KeiStore = ReturnType<typeof useKei>;
