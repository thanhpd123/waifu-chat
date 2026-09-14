import { useEffect, useState } from 'react';
import type { EngineInfo, LanguageInfo, PersonaInfo, TtsStatus, WaifuSettings } from '../lib/types';
import { listVoices, onVoicesReady, speakAsKei } from '../lib/voice';
import type { VoiceOption } from '../lib/voice';

interface SettingsPanelProps {
    settings: WaifuSettings;
    personas: PersonaInfo[];
    languages: LanguageInfo[];
    engine: EngineInfo | null;
    tts: TtsStatus | null;
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

/** Giọng OpenAI TTS phù hợp với Kei (đều là giọng nữ). */
const SERVER_VOICES = [
    { id: '', label: 'Mặc định' },
    { id: 'coral', label: 'Coral' },
    { id: 'nova', label: 'Nova' },
    { id: 'shimmer', label: 'Shimmer' },
    { id: 'sage', label: 'Sage' },
    { id: 'ballad', label: 'Ballad' },
];

/** Nhãn giới tính của giọng đọc trình duyệt (Web Speech API không cung cấp sẵn). */
function genderIcon(gender: VoiceOption['gender']): string {
    if (gender === 'female') return '👧';
    if (gender === 'male') return '👨';
    return '❔';
}

/** Bảng cài đặt: nhân cách, ngôn ngữ, giọng nói và các hiệu ứng. */
export default function SettingsPanel({
    settings,
    personas,
    languages,
    engine,
    tts,
    affection,
    firstSeenAt,
    onChange,
    onClearChat,
    onResetAffection,
    onClose,
}: SettingsPanelProps) {
    /** Danh sách giọng của trình duyệt (một số máy nạp danh sách này bất đồng bộ). */
    const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>(() => listVoices(settings.language));

    useEffect(() => {
        const refresh = () => setVoiceOptions(listVoices(settings.language));
        refresh();
        return onVoicesReady(refresh);
    }, [settings.language]);

    const hasFemaleVoice = voiceOptions.some(voice => voice.gender === 'female');

    /**
     * Nghe thử "giọng Kei" đúng như khi trả lời: TTS theo ngôn ngữ đang chọn,
     * nếu máy chưa có giọng nữ thì phát clip .wav có sẵn của model.
     */
    const testVoice = () => {
        void speakAsKei(SAMPLE_LINES[settings.language] ?? SAMPLE_LINES.ja, settings.language, settings.ttsRate, 'happy');
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
                        hint="Đọc câu trả lời bằng giọng nữ anime (ưu tiên OpenAI TTS; không bao giờ dùng giọng nam của máy)"
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

                </div>

                <div className="settings__group">
                    <h3>🎙️ Giọng đọc của Kei</h3>

                    <div className="chip-row">
                        <button
                            type="button"
                            className={`chip${settings.voiceFemaleOnly ? ' chip--active' : ''}`}
                            onClick={() => onChange({ voiceFemaleOnly: true })}
                        >
                            👧 Chỉ giọng nữ
                        </button>
                        <button
                            type="button"
                            className={`chip${settings.voiceFemaleOnly ? '' : ' chip--active'}`}
                            onClick={() => onChange({ voiceFemaleOnly: false })}
                        >
                            🔀 Mọi giọng
                        </button>
                    </div>

                    <div className="settings__slider">
                        <label htmlFor="kei-voice">Giọng của trình duyệt / Windows</label>
                        <select
                            id="kei-voice"
                            className="text-input"
                            value={settings.ttsVoiceURI}
                            onChange={event => onChange({ ttsVoiceURI: event.target.value })}
                        >
                            <option value="">Tự động — ưu tiên giọng nữ đúng ngôn ngữ</option>
                            {voiceOptions.map(voice => (
                                <option key={voice.voiceURI} value={voice.voiceURI}>
                                    {genderIcon(voice.gender)} {voice.name} ({voice.lang})
                                </option>
                            ))}
                        </select>
                        <small className="settings__note">
                            {hasFemaleVoice
                                ? 'Máy bạn có giọng nữ cho ngôn ngữ này — Kei dùng giọng đó khi backend TTS tắt.'
                                : 'Máy chưa cài giọng nữ cho ngôn ngữ này (Windows thường chỉ có "Microsoft An" — giọng nam, nên Kei sẽ không dùng). Thêm giọng: Settings → Time & Language → Speech → Add voices → Vietnamese / Japanese, hoặc mở app bằng Microsoft Edge (có sẵn giọng nữ online "HoaiMy").'}
                        </small>
                    </div>

                    <div className="settings__slider">
                        <label htmlFor="kei-rate">Tốc độ đọc ({settings.ttsRate.toFixed(2)}×)</label>
                        <input
                            id="kei-rate"
                            type="range"
                            min={0.7}
                            max={1.3}
                            step={0.05}
                            value={settings.ttsRate}
                            onChange={event => onChange({ ttsRate: Number(event.target.value) })}
                        />
                        <label htmlFor="kei-pitch">Cao độ ({settings.ttsPitch.toFixed(2)}) — càng cao càng "anime"</label>
                        <input
                            id="kei-pitch"
                            type="range"
                            min={0.8}
                            max={1.5}
                            step={0.05}
                            value={settings.ttsPitch}
                            onChange={event => onChange({ ttsPitch: Number(event.target.value) })}
                        />
                    </div>

                    <div className="settings__slider">
                        <label>Giọng AI của backend (OpenAI TTS — luôn là giọng nữ)</label>
                        <div className="chip-row">
                            {SERVER_VOICES.map(voice => (
                                <button
                                    key={voice.id || 'default'}
                                    type="button"
                                    className={`chip${settings.ttsServerVoice === voice.id ? ' chip--active' : ''}`}
                                    onClick={() => onChange({ ttsServerVoice: voice.id })}
                                >
                                    {voice.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {settings.voiceEnabled && (
                        <div className="settings__slider">
                            <button type="button" className="ghost-button" onClick={testVoice}>
                                🎤 Nghe thử giọng Kei
                            </button>
                            <small className="settings__note">
                                {tts?.available
                                    ? `Đang dùng giọng nữ ${tts.voice} (${tts.provider}). Kei đọc đúng nội dung và đổi sắc thái theo cảm xúc của câu.`
                                    : 'Backend chưa có giọng AI — Kei sẽ dùng giọng nữ của trình duyệt, hoặc clip thoại .wav gốc nếu máy không có giọng nữ.'}
                                {tts?.last_error ? ` ⚠️ OpenAI TTS lỗi: ${tts.last_error}` : ''}
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
