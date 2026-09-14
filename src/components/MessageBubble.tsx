import { useState } from 'react';
import { EMOTION_META } from '../lib/emotion';
import { renderRich } from '../lib/markdown';
import type { ChatMessage } from '../lib/types';

interface MessageBubbleProps {
    message: ChatMessage;
    onRepeat?: (message: ChatMessage) => void;
}

export default function MessageBubble({ message, onRepeat }: MessageBubbleProps) {
    const [copied, setCopied] = useState(false);
    const isKei = message.role === 'assistant';
    const meta = EMOTION_META[message.emotion ?? 'neutral'];

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(message.content);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
        } catch {
            /* clipboard bị chặn → bỏ qua */
        }
    };

    const time = new Date(message.at).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
    });

    return (
        <div className={`msg msg--${isKei ? 'kei' : 'user'}`}>
            {isKei && (
                <div className="msg__avatar" style={{ borderColor: meta.accent }} title={meta.label}>
                    {meta.emoji}
                </div>
            )}

            <div className="msg__body">
                <div className="msg__bubble" style={{ ['--msg-accent' as string]: meta.accent }}>
                    {message.content ? (
                        <div className="msg__text" dangerouslySetInnerHTML={{ __html: renderRich(message.content) }} />
                    ) : (
                        <div className="msg__typing">
                            <span className="dot" />
                            <span className="dot" />
                            <span className="dot" />
                        </div>
                    )}
                    {message.streaming && message.content && <span className="msg__caret" />}
                </div>

                <div className="msg__meta">
                    <span>{time}</span>
                    {isKei && message.emotion && <span className="msg__emotion">{meta.label}</span>}
                    <button type="button" className="msg__action" onClick={copy}>
                        {copied ? '✓ Đã chép' : '⧉ Chép'}
                    </button>
                    {isKei && onRepeat && message.content && (
                        <button type="button" className="msg__action" onClick={() => onRepeat(message)}>
                            🔊 Đọc lại
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
