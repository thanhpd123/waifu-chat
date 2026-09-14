import { useEffect, useState } from 'react';
import './App.css';
import ChatPanel from './components/ChatPanel';
import Waifu from './components/Waifu';
import { useKei } from './hooks/useKei';
import { firstSeen, hasSeenHint, markHintSeen } from './lib/storage';
import { timeOfDay } from './lib/utils';

/**
 * 🌸 Kei — chatbox anime với nhân vật Live2D.
 *
 * Bố cục: nhân vật ở bên phải (nền Live2D trong suốt), khung chat dạng kính ở bên trái.
 * Trên mobile, khung chat trượt xuống dưới và Kei thu nhỏ ở phía trên.
 */
function App() {
    const kei = useKei();
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
                <div className="topbar__brand">
                    <span className="topbar__logo">🌸</span>
                    <div>
                        <strong>Kei · Live2D Chat</strong>
                        <small>{dayPart.text}</small>
                    </div>
                </div>
                <span className="topbar__credit">made by thanh1934-cr7</span>
            </header>

            <Waifu settings={kei.settings} affection={kei.affection} />

            <ChatPanel kei={kei} firstSeenAt={firstSeenAt} />

            {hint && (
                <div className="hint-toast" role="status">
                    💡 Di chuyển chuột để Kei nhìn theo · Chạm vào Kei để xoa đầu · Bật 🔊 để nghe cô ấy nói
                </div>
            )}
        </div>
    );
}

export default App;
