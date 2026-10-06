import { useEffect, useState } from 'react';
import './App.css';
import ChatPanel from './components/ChatPanel';
import Waifu from './components/Waifu';
import { useKei } from './hooks/useKei';
import type { ChatStore } from './lib/chatStore';
import { linkHandler } from './lib/router';
import { firstSeen, hasSeenHint, markHintSeen } from './lib/storage';
import { timeOfDay } from './lib/utils';

/** Tài khoản đang đăng nhập (null = chế độ lưu trong trình duyệt). */
export interface Account {
    name: string;
    email: string;
    onSignOut: () => Promise<void>;
}

interface AppProps {
    store: ChatStore;
    account: Account | null;
}

/**
 * 🌸 Kei — chatbox anime với nhân vật Live2D.
 *
 * Bố cục: nhân vật ở bên phải (nền Live2D trong suốt), khung chat dạng kính ở bên trái.
 * Trên mobile, khung chat trượt xuống dưới và Kei thu nhỏ ở phía trên.
 */
function App({ store, account }: AppProps) {
    const kei = useKei({ store, defaultUserName: account?.name });
    const [firstSeenAt] = useState(() => firstSeen());
    const [hint, setHint] = useState(() => !hasSeenHint());

    useEffect(() => {
        if (!hint) return;
        markHintSeen();
        const timer = window.setTimeout(() => setHint(false), 10_000);
        return () => window.clearTimeout(timer);
    }, [hint]);

    const dayPart = timeOfDay();

    return (
        <div className="app">
            <div className="app__aurora" aria-hidden="true" />

            <header className="topbar">
                <a className="topbar__brand" href="/" onClick={linkHandler('/')} title="Về trang chủ">
                    <span className="topbar__logo">🌸</span>
                    <div>
                        <strong>Kei · Live2D Chat</strong>
                        <small>{dayPart.text}</small>
                    </div>
                </a>
                <span className="topbar__credit">made by thanh1934-cr7</span>
            </header>

            <Waifu settings={kei.settings} affection={kei.affection} />

            <ChatPanel kei={kei} firstSeenAt={firstSeenAt} account={account} />

            {hint && (
                <div className="hint-toast" role="status">
                    💡 Di chuyển chuột để Kei nhìn theo · Chạm vào Kei để xoa đầu · Bật 🔊 để nghe cô ấy nói
                </div>
            )}
        </div>
    );
}

export default App;
