import { useState } from 'react';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function displayContent(m: ChatMessage): string {
    return typeof m.content === 'string' ? m.content : '';
}

export default function ChatBox() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);

    const sendMessage = async () => {
        if (!input.trim()) return;
        // Tạm thời bỏ OpenAI: chỉ hiển thị tin nhắn người dùng
        const userMsg: ChatMessage = { role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        // Nếu muốn thêm phản hồi giả lập, có thể bật đoạn sau:
        // const botMsg: ChatMessage = { role: 'assistant', content: 'Tính năng trả lời tạm thời tắt ♡' };
        // setMessages(prev => [...prev, botMsg]);
        setError(null);
    };

    return (
        <div style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '90%',
            maxWidth: '600px',
            zIndex: 10,
        }}>
            <div style={{ height: '60px', overflowY: 'auto', background: 'rgba(0,0,0,0.7)', borderRadius: 16, padding: 16, color: 'white' }}>
                {error && (
                    <div style={{ marginBottom: 8, color: '#ffb86c' }}>
                        {error}
                    </div>
                )}
                {messages.map((m, i) => (
                    <div key={i} style={{ margin: '8px 0', textAlign: m.role === 'user' ? 'right' : 'left' }}>
                        <span style={{
                            background: m.role === 'user' ? '#ff79c6' : '#8be9fd',
                            color: 'black',
                            padding: '8px 16px',
                            borderRadius: 20,
                            display: 'inline-block',
                            maxWidth: '80%',
                        }}>
                            {displayContent(m)}
                        </span>
                    </div>
                ))}
            </div>
            <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()}
                placeholder="Nói gì đó với cô ấy đi ♡"
                style={{
                    width: '100%',
                    padding: '16px',
                    borderRadius: 30,
                    border: 'none',
                    marginTop: 8,
                    fontSize: 16,
                }}
            />
        </div>
    );
}