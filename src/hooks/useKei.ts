import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchHealth, streamChat } from '../lib/api';
import { detectEmotion, sanitizeAssistantText } from '../lib/emotion';
import {
    clearMessages,
    firstSeen,
    loadAffection,
    loadMessages,
    loadSettings,
    saveAffection,
    saveMessages,
    saveSettings,
} from '../lib/storage';
import { DEFAULT_SETTINGS } from '../lib/types';
import type { ChatMessage, EngineInfo, HealthPayload, PersonaInfo, WaifuSettings } from '../lib/types';
import { clamp, timeOfDay, uid } from '../lib/utils';
import { speakAsKei, stopKeiVoice } from '../lib/voice';
import { waifuBus } from '../lib/waifuBus';

/** Điểm thân thiết cộng thêm mỗi lần trò chuyện. */
const AFFECTION_PER_MESSAGE = 2;
const AFFECTION_BONUS_LONG_MESSAGE = 1;
const AFFECTION_START_BONUS = 5;

function greetingMessage(): ChatMessage {
    const { greeting } = timeOfDay();
    return {
        id: uid(),
        role: 'assistant',
        content: `Kei đây~ ${greeting} (*chớp mắt*)`,
        at: Date.now(),
    };
}

/**
 * "Bộ não" phía React: quản lý hội thoại, cấu hình, độ thân thiết và kết nối backend.
 */
export function useKei() {
    const [messages, setMessages] = useState<ChatMessage[]>(() => {
        const stored = loadMessages();
        return stored.length ? stored : [];
    });
    const [settings, setSettings] = useState<WaifuSettings>(() => loadSettings());
    const [affection, setAffection] = useState<number>(() => loadAffection());
    const [engine, setEngine] = useState<EngineInfo | null>(null);
    const [health, setHealth] = useState<HealthPayload | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const affectionRef = useRef(affection);
    affectionRef.current = affection;

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

    /**
     * Lời chào khi hộp thư trống — áp dụng cho cả lần đầu mở app LẪN sau khi
     * người dùng bấm "Xoá lịch sử trò chuyện" (trước đây hộp thư bị trống trơn).
     */
    const messagesEmpty = messages.length === 0;
    useEffect(() => {
        if (!messagesEmpty) return;
        setMessages([greetingMessage()]);
    }, [messagesEmpty]);

    /** Cộng điểm chào mừng cho lần ghé thăm đầu tiên. */
    const welcomedRef = useRef(false);
    useEffect(() => {
        if (welcomedRef.current) return;
        welcomedRef.current = true;
        if (loadAffection() === 0) {
            setAffection(AFFECTION_START_BONUS);
        }
        firstSeen();
    }, []);

    /* ------------------------------- Lưu trữ ------------------------------- */

    useEffect(() => {
        if (messages.length) saveMessages(messages);
    }, [messages]);

    useEffect(() => {
        saveSettings(settings);
    }, [settings]);

    useEffect(() => {
        saveAffection(affection);
    }, [affection]);

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

    const finishStream = useCallback(
        (assistantId: string, payload: { text: string; emotion: ChatMessage['emotion']; offline: boolean }) => {
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
            waifuBus.emit('thinking', { active: false });
            waifuBus.emit('emote', { emotion: payload.emotion ?? 'neutral', durationMs: 7000 });

            // Kei "nói": giọng nữ anime từ server (đúng nội dung), có fallback.
            if (payload.text && settingsRef.current.voiceEnabled) {
                void speakAsKei(payload.text, settingsRef.current.language, settingsRef.current.ttsRate);
            }
        },
        [],
    );

    const runStream = useCallback(
        async (history: ChatMessage[]) => {
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
                            finishStream(assistantId, {
                                text,
                                emotion: payload.emotion ?? detectEmotion(text),
                                offline: payload.offline,
                            });
                        },
                        onError: message => {
                            setNotice(message);
                            setMessages(current =>
                                current.map(m =>
                                    m.id === assistantId ? { ...m, streaming: false, content: m.content || message } : m,
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
            void runStream(history);
        },
        [messages, addAffection, runStream],
    );

    /** Gửi lại câu hỏi cuối cùng (bỏ câu trả lời gần nhất của Kei). */
    const regenerate = useCallback(() => {
        if (busy) return;
        const lastUserIndex = [...messages].reverse().findIndex(m => m.role === 'user');
        if (lastUserIndex === -1) return;
        const cutIndex = messages.length - lastUserIndex;
        const history = messages.slice(0, cutIndex);
        stopKeiVoice();
        setMessages(history);
        void runStream(history);
    }, [busy, messages, runStream]);

    const stop = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        stopKeiVoice();
        setBusy(false);
        waifuBus.emit('thinking', { active: false });
        setMessages(current => current.map(m => (m.streaming ? { ...m, streaming: false } : m)));
    }, []);

    const clear = useCallback(() => {
        stop();
        clearMessages();
        setMessages([]);
    }, [stop]);

    const changeSettings = useCallback((patch: Partial<WaifuSettings>) => {
        setSettings(current => ({ ...current, ...patch }));
    }, []);

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
        busy,
        notice,
        personas,
        languages: health?.languages ?? [
            { id: 'vi', label: 'Tiếng Việt' },
            { id: 'ja', label: '日本語' },
            { id: 'en', label: 'English' },
        ],
        lastAssistant,
        send,
        stop,
        clear,
        regenerate,
        changeSettings,
        resetAffection,
        dismissNotice: () => setNotice(null),
    };
}
/** Kiểu dữ liệu trả về của hook — dùng để truyền xuống component con. */
export type KeiStore = ReturnType<typeof useKei>;