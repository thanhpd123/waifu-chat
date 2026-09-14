import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeiStore } from '../hooks/useKei';
import { EMOTION_META } from '../lib/emotion';
import type { ChatMessage } from '../lib/types';
import { speakAsKei, stopKeiVoice } from '../lib/voice';
import MessageBubble from './MessageBubble';
import SettingsPanel from './SettingsPanel';

interface ChatPanelProps {
    kei: KeiStore;
    firstSeenAt: number;
}

const SUGGESTIONS = [
    'Hôm nay cậu thế nào rồi?',
    'Kể cho tớ nghe về cậu đi~',
    'Tớ đang hơi mệt...',
    'Cậu thích ăn món gì nhất?',
];

function affectionTier(value: number): { label: string; emoji: string } {
    if (value >= 90) return { label: 'Tri kỷ', emoji: '💞' };
    if (value >= 70) return { label: 'Thân thiết', emoji: '💖' };
    if (value >= 45) return { label: 'Bạn thân', emoji: '💗' };
    if (value >= 20) return { label: 'Mới quen', emoji: '🌸' };
    return { label: 'Người lạ', emoji: '🤍' };
}

/** Khung chat chính: trạng thái, thanh thân thiết, danh sách tin nhắn và ô soạn thảo. */
export default function ChatPanel({ kei, firstSeenAt }: ChatPanelProps) {
    const {
        messages,
        settings,
        affection,
        engine,
        tts,
        busy,
        notice,
        personas,
        languages,
        send,
        stop,
        clear,
        regenerate,
        changeSettings,
        resetAffection,
        dismissNotice,
    } = kei;

    const [input, setInput] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [collapsed, setCollapsed] = useState(false);

    const listRef = useRef<HTMLDivElement>(null);
    const stickToBottom = useRef(true);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const tier = affectionTier(affection);
    const userMessageCount = useMemo(() => messages.filter(m => m.role === 'user').length, [messages]);
    const lastEmotion = useMemo(() => {
        const assistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content);
        return assistant?.emotion ?? 'happy';
    }, [messages]);

    /* Tự cuộn xuống cuối khi có tin mới (trừ khi người dùng đang xem lại phía trên). */
    useEffect(() => {
        const list = listRef.current;
        if (!list || !stickToBottom.current) return;
        list.scrollTop = list.scrollHeight;
    }, [messages]);

    useEffect(() => () => stopKeiVoice(), []);

    const handleScroll = () => {
        const list = listRef.current;
        if (!list) return;
        const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
        stickToBottom.current = distance < 80;
    };

    const submit = () => {
        const text = input.trim();
        if (!text || busy) return;
        send(text);
        setInput('');
        requestAnimationFrame(() => {
            if (textareaRef.current) textareaRef.current.style.height = 'auto';
        });
    };

    const repeat = (message: ChatMessage) => {
        void speakAsKei(message.content, settings.language, settings.ttsRate, message.emotion);
    };

    const meta = EMOTION_META[lastEmotion];

    return (
        <aside className={`chat${collapsed ? ' chat--collapsed' : ''}`}>
            <header className="chat__head">
                <div className="chat__identity">
                    <span className="chat__avatar" style={{ borderColor: meta.accent }}>
                        {meta.emoji}
                    </span>
                    <div>
                        <h1>
                            Kei <span className="chat__heart">♡</span>
                        </h1>
                        <p className="chat__status">
                            {busy ? (
                                <span className="chat__status-busy">đang gõ…</span>
                            ) : (
                                <>
                                    <span className={`badge${engine?.online ? ' badge--online' : ' badge--offline'}`}>
                                        {engine?.online ? 'online' : 'offline'}
                                    </span>
                                    {engine ? `${engine.label}` : 'đang kết nối…'}
                                </>
                            )}
                        </p>
                    </div>
                </div>

                <div className="chat__head-actions">
                    <button
                        type="button"
                        className={`icon-button${settings.voiceEnabled ? ' icon-button--active' : ''}`}
                        title={settings.voiceEnabled ? 'Tắt giọng nói' : 'Bật giọng nói'}
                        onClick={() => {
                            if (settings.voiceEnabled) stopKeiVoice();
                            changeSettings({ voiceEnabled: !settings.voiceEnabled });
                        }}
                    >
                        {settings.voiceEnabled ? '🔊' : '🔇'}
                    </button>
                    <button
                        type="button"
                        className="icon-button"
                        title="Cài đặt"
                        onClick={() => setShowSettings(true)}
                    >
                        ⚙️
                    </button>
                    <button
                        type="button"
                        className="icon-button icon-button--mobile"
                        title={collapsed ? 'Mở rộng' : 'Thu gọn'}
                        onClick={() => setCollapsed(value => !value)}
                    >
                        {collapsed ? '▲' : '▼'}
                    </button>
                </div>
            </header>

            <div className="chat__affection" title={`Độ thân thiết: ${affection}/100`}>
                <div className="chat__affection-bar">
                    <span style={{ width: `${affection}%` }} />
                </div>
                <span className="chat__affection-label">
                    {tier.emoji} {tier.label} · {affection}%
                </span>
            </div>

            {notice && (
                <div className="chat__notice">
                    <span>{notice}</span>
                    <button type="button" className="icon-button" onClick={dismissNotice} title="Đóng thông báo">
                        ✕
                    </button>
                </div>
            )}

            <div className="chat__list" ref={listRef} onScroll={handleScroll}>
                {messages.map(message => (
                    <MessageBubble key={message.id} message={message} onRepeat={repeat} />
                ))}

                {userMessageCount === 0 && (
                    <div className="chat__suggestions">
                        <p>Gợi ý để bắt chuyện với Kei:</p>
                        <div className="chip-row">
                            {SUGGESTIONS.map(text => (
                                <button key={text} type="button" className="chip" onClick={() => send(text)}>
                                    {text}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <footer className="chat__composer">
                <textarea
                    ref={textareaRef}
                    value={input}
                    rows={1}
                    placeholder="Nói gì đó với Kei đi ♡"
                    onChange={event => {
                        setInput(event.target.value);
                        const el = event.target;
                        el.style.height = 'auto';
                        el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
                    }}
                    onKeyDown={event => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            submit();
                        }
                    }}
                />

                {busy ? (
                    <button type="button" className="send-button send-button--stop" onClick={stop} title="Dừng lại">
                        ■
                    </button>
                ) : (
                    <button
                        type="button"
                        className="send-button"
                        onClick={submit}
                        disabled={!input.trim()}
                        title="Gửi (Enter)"
                    >
                        ➤
                    </button>
                )}
            </footer>

            <div className="chat__footer-actions">
                <button type="button" className="link-button" onClick={regenerate} disabled={busy || !userMessageCount}>
                    ↻ Trả lời lại
                </button>
                <span className="chat__hint">Enter để gửi · Shift + Enter để xuống dòng</span>
            </div>

            {showSettings && (
                <SettingsPanel
                    settings={settings}
                    personas={personas}
                    languages={languages}
                    engine={engine}
                    tts={tts}
                    affection={affection}
                    firstSeenAt={firstSeenAt}
                    onChange={changeSettings}
                    onClearChat={() => {
                        clear();
                        setShowSettings(false);
                    }}
                    onResetAffection={resetAffection}
                    onClose={() => setShowSettings(false)}
                />
            )}
        </aside>
    );
}
