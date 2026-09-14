import type { EngineInfo, LanguageInfo, PersonaInfo, WaifuSettings } from '../lib/types';
import { speakAsKei } from '../lib/voice';

interface SettingsPanelProps {
    settings: WaifuSettings;
    personas: PersonaInfo[];
    languages: LanguageInfo[];
    engine: EngineInfo | null;
    affection: number;
    firstSeenAt: number;
    onChange: (patch: Partial<WaifuSettings>) => void;
    onClearChat: () => void;
    onResetAffection: () => void;
    onClose: () => void;
}

interface ToggleProps {
    checked: boolean;
    label: string;
    hint: string;
    onChange: (next: boolean) => void;
}

function Toggle({ checked, label, hint, onChange }: ToggleProps) {
    return (
        <label className="toggle">
            <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
            <span className="toggle__track" aria-hidden="true">
                <span className="toggle__thumb" />
            </span>
            <span className="toggle__text">
                <strong>{label}</strong>
                <small>{hint}</small>
            </span>
        </label>
    );
}

const SAMPLE_LINES: Record<string, string> = {
    vi: 'Kei nghe thấy cậu gọi rồi nè. Hôm nay của cậu thế nào rồi?',
    ja: 'こんにちは、ケイだよ。今日も一緒にお話しできてうれしいな。',
    en: "Hi, it's Kei. I'm happy we can talk together again today.",
};

/** Bảng cài đặt: nhân cách, ngôn ngữ, giọng nói và các hiệu ứng. */
export default function SettingsPanel({
    settings,
    personas,
    languages,
    engine,
    affection,
    firstSeenAt,
    onChange,
    onClearChat,
    onResetAffection,
    onClose,
}: SettingsPanelProps) {
    /**
     * Nghe thử "giọng Kei" đúng như khi trả lời: TTS theo ngôn ngữ đang chọn,
     * nếu máy chưa có giọng đó thì phát clip .wav có sẵn của model.
     */
    const testVoice = () => {
        void speakAsKei(SAMPLE_LINES[settings.language] ?? SAMPLE_LINES.ja, settings.language, settings.ttsRate);
    };

    return (
        <section className="settings" aria-label="Cài đặt">
            <header className="settings__header">
                <h2>⚙️ Cài đặt</h2>
                <button type="button" className="icon-button" onClick={onClose} title="Đóng cài đặt">
                    ✕
                </button>
            </header>

            <div className="settings__body">
                <div className="settings__group">
                    <h3>Tính cách của Kei</h3>
                    <div className="chip-row">
                        {personas.map(persona => (
                            <button
                                key={persona.id}
                                type="button"
                                className={`chip${settings.persona === persona.id ? ' chip--active' : ''}`}
                                onClick={() => onChange({ persona: persona.id })}
                            >
                                <span>{persona.emoji}</span>
                                {persona.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="settings__group">
                    <h3>Kei trả lời bằng</h3>
                    <div className="chip-row">
                        {languages.map(language => (
                            <button
                                key={language.id}
                                type="button"
                                className={`chip${settings.language === language.id ? ' chip--active' : ''}`}
                                onClick={() => onChange({ language: language.id })}
                            >
                                {language.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="settings__group">
                    <h3>Cách Kei gọi bạn</h3>
                    <input
                        className="text-input"
                        value={settings.userName}
                        maxLength={24}
                        placeholder="Ví dụ: Senpai, Minh, cậu..."
                        onChange={event => onChange({ userName: event.target.value })}
                    />
                </div>

                <div className="settings__group">
                    <h3>Trải nghiệm</h3>
                    <Toggle
                        checked={settings.voiceEnabled}
                        label="Kei nói thành tiếng"
                        hint="Đọc câu trả lời bằng giọng nữ anime dễ thương (OpenAI TTS) — cần backend đang chạy"
                        onChange={next => onChange({ voiceEnabled: next })}
                    />
                    <Toggle
                        checked={settings.autoMotion}
                        label="Kei tự cử động khi rảnh"
                        hint="Tự chơi motion và liếc nhìn quanh mỗi khi bạn không tương tác"
                        onChange={next => onChange({ autoMotion: next })}
                    />
                    <Toggle
                        checked={settings.sfxEnabled}
                        label="Hiệu ứng âm thanh"
                        hint="Tiếng 'ara ara' khi bạn xoa đầu Kei"
                        onChange={next => onChange({ sfxEnabled: next })}
                    />
                    <Toggle
                        checked={settings.petals}
                        label="Cánh hoa anh đào"
                        hint="Lớp hoa rơi nhẹ phía sau Kei"
                        onChange={next => onChange({ petals: next })}
                    />

                    {settings.voiceEnabled && (
                        <div className="settings__slider">
                            <button type="button" className="ghost-button" onClick={testVoice}>
                                🎤 Nghe thử giọng Kei
                            </button>
                            <small className="settings__note">
                                Giọng nữ anime do OpenAI TTS tạo (đọc đúng nội dung câu trả lời). Nếu backend
                                chưa chạy hoặc mất mạng, Kei tự phát clip thoại .wav có sẵn của model.
                            </small>
                        </div>
                    )}
                </div>

                <div className="settings__group">
                    <h3>Thông tin</h3>
                    <ul className="info-list">
                        <li>
                            <span>Bộ não</span>
                            <strong>
                                {engine ? (
                                    <>
                                        <span className={`badge${engine.online ? ' badge--online' : ' badge--offline'}`}>
                                            {engine.online ? 'online' : 'offline'}
                                        </span>
                                        {engine.label} · {engine.model}
                                    </>
                                ) : (
                                    'Đang kiểm tra…'
                                )}
                            </strong>
                        </li>
                        <li>
                            <span>Độ thân thiết</span>
                            <strong>{affection}/100</strong>
                        </li>
                        <li>
                            <span>Hai đứa quen nhau từ</span>
                            <strong>{new Date(firstSeenAt).toLocaleDateString('vi-VN')}</strong>
                        </li>
                    </ul>
                </div>

                <div className="settings__group settings__group--danger">
                    <h3>Vùng nguy hiểm</h3>
                    <div className="button-row">
                        <button type="button" className="ghost-button" onClick={onClearChat}>
                            🧹 Xoá lịch sử trò chuyện
                        </button>
                        <button type="button" className="ghost-button ghost-button--danger" onClick={onResetAffection}>
                            💔 Đặt lại độ thân thiết
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
