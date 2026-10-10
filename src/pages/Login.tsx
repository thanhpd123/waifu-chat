import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { linkHandler, navigate } from '../lib/router';
import './landing.css';

type Mode = 'signin' | 'signup';

/** Dịch lỗi thường gặp của Supabase Auth sang tiếng Việt. */
function friendlyError(message: string): string {
    const low = message.toLowerCase();
    if (low.includes('invalid login credentials')) return 'Sai email hoặc mật khẩu.';
    if (low.includes('email not confirmed')) return 'Email chưa được xác nhận — cậu kiểm tra hộp thư (cả mục Spam) nhé.';
    if (low.includes('already registered') || low.includes('already been registered'))
        return 'Email này đã có tài khoản — chuyển sang Đăng nhập nha.';
    if (low.includes('password should be at least')) return 'Mật khẩu cần ít nhất 6 ký tự.';
    if (low.includes('rate limit') || low.includes('too many') || low.includes('security purposes'))
        return 'Thao tác hơi nhanh quá, cậu đợi một lát rồi thử lại nhé.';
    if (low.includes('provider is not enabled')) return 'Đăng nhập Google chưa được bật trong Supabase.';
    // Máy gửi email mặc định của Supabase chỉ gửi tới thành viên của project và rất ít lượt mỗi giờ.
    if (low.includes('not authorized') || low.includes('error sending'))
        return 'Kei chưa gửi được email tới địa chỉ này. Cậu đăng nhập bằng mật khẩu nhé (hoặc nhờ quản trị viên kiểm tra cấu hình email).';
    if (low.includes('invalid email') || low.includes('unable to validate email')) return 'Email không hợp lệ.';
    if (low.includes('fetch')) return 'Không kết nối được máy chủ đăng nhập. Kiểm tra mạng giúp Kei nhé.';
    return message;
}

function nextPath(): string {
    const next = new URLSearchParams(window.location.search).get('next');
    return next && next.startsWith('/') && !next.startsWith('//') ? next : '/chat';
}

export default function Login() {
    const { user, loading, client: supabase, authEnabled, googleLogin: googleLoginEnabled } = useAuth();
    const [mode, setMode] = useState<Mode>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    // Đã đăng nhập (vd. vừa quay về từ Google / link email) → vào chat luôn.
    useEffect(() => {
        if (!loading && user) navigate(nextPath(), { replace: true });
    }, [loading, user]);

    const redirectTo = `${window.location.origin}${nextPath()}`;

    const run = async (action: () => Promise<{ error: { message: string } | null }>, success?: string) => {
        setPending(true);
        setError(null);
        setInfo(null);
        try {
            const { error: failure } = await action();
            if (failure) setError(friendlyError(failure.message));
            else if (success) setInfo(success);
        } catch (failure) {
            setError(friendlyError(failure instanceof Error ? failure.message : String(failure)));
        } finally {
            setPending(false);
        }
    };

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!supabase) return;
        const cleanEmail = email.trim();
        if (mode === 'signin') {
            void run(() => supabase!.auth.signInWithPassword({ email: cleanEmail, password }));
            return;
        }
        void run(async () => {
            const result = await supabase!.auth.signUp({
                email: cleanEmail,
                password,
                options: { emailRedirectTo: redirectTo },
            });
            if (!result.error && !result.data.session) {
                setInfo('📩 Kei đã gửi email xác nhận — cậu mở hộp thư và bấm vào link để kích hoạt tài khoản nhé!');
            }
            return result;
        });
    };

    const sendMagicLink = () => {
        if (!supabase) return;
        const cleanEmail = email.trim();
        if (!cleanEmail) {
            setError('Nhập email trước để Kei gửi link đăng nhập nha.');
            return;
        }
        void run(
            () => supabase!.auth.signInWithOtp({ email: cleanEmail, options: { emailRedirectTo: redirectTo } }),
            `📩 Đã gửi link đăng nhập tới ${cleanEmail}. Mở email và bấm vào link là xong (không cần mật khẩu).`,
        );
    };

    const signInWithGoogle = () => {
        if (!supabase) return;
        void run(() => supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } }));
    };

    return (
        <div className="kp kp-auth">
            <div className="kp__glow" aria-hidden="true" />
            <a className="kp-auth__back" href="/" onClick={linkHandler('/')}>
                ← Trang chủ
            </a>

            <main className="kp-auth__card">
                <div className="kp-auth__brand">
                    <span className="kp-logo">🌸</span>
                    <h1>{mode === 'signin' ? 'Chào mừng trở lại~' : 'Làm quen với Kei'}</h1>
                    <p>
                        {mode === 'signin'
                            ? 'Đăng nhập để tiếp tục các cuộc trò chuyện của cậu.'
                            : 'Tạo tài khoản để Kei nhớ cậu trên mọi thiết bị.'}
                    </p>
                </div>

                {loading ? (
                    <p className="kp-auth__loading">Đang kết nối…</p>
                ) : !authEnabled ? (
                    <div className="kp-auth__notice">
                        <p>
                            Đăng nhập chưa được cấu hình (thiếu <code>VITE_SUPABASE_URL</code> /{' '}
                            <code>VITE_SUPABASE_ANON_KEY</code>). Cậu vẫn có thể trò chuyện, lịch sử sẽ được lưu trong
                            trình duyệt này.
                        </p>
                        <a className="kp-btn kp-btn--primary kp-btn--block" href="/chat" onClick={linkHandler('/chat')}>
                            Vào trò chuyện với Kei →
                        </a>
                    </div>
                ) : (
                    <>
                        <div className="kp-auth__tabs" role="tablist">
                            {(['signin', 'signup'] as const).map(value => (
                                <button
                                    key={value}
                                    type="button"
                                    role="tab"
                                    aria-selected={mode === value}
                                    className={mode === value ? 'is-active' : ''}
                                    onClick={() => {
                                        setMode(value);
                                        setError(null);
                                        setInfo(null);
                                    }}
                                >
                                    {value === 'signin' ? 'Đăng nhập' : 'Đăng ký'}
                                </button>
                            ))}
                        </div>

                        {googleLoginEnabled && (
                            <>
                                <button
                                    type="button"
                                    className="kp-btn kp-btn--light kp-btn--block"
                                    onClick={signInWithGoogle}
                                    disabled={pending}
                                >
                                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                                        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                                        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                                        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                                        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                                    </svg>
                                    Tiếp tục với Google
                                </button>
                                <div className="kp-auth__divider">
                                    <span>hoặc dùng email</span>
                                </div>
                            </>
                        )}

                        <form className="kp-auth__form" onSubmit={submit}>
                            <label>
                                <span>Email</span>
                                <input
                                    type="email"
                                    autoComplete="email"
                                    required
                                    value={email}
                                    onChange={event => setEmail(event.target.value)}
                                    placeholder="cau@example.com"
                                />
                            </label>
                            <label>
                                <span>Mật khẩu</span>
                                <input
                                    type="password"
                                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                                    required
                                    minLength={6}
                                    value={password}
                                    onChange={event => setPassword(event.target.value)}
                                    placeholder={mode === 'signin' ? '••••••••' : 'Ít nhất 6 ký tự'}
                                />
                            </label>

                            {error && <p className="kp-auth__error" role="alert">{error}</p>}
                            {info && <p className="kp-auth__info" role="status">{info}</p>}

                            <button type="submit" className="kp-btn kp-btn--primary kp-btn--block" disabled={pending}>
                                {pending ? 'Đợi Kei chút…' : mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'}
                            </button>
                        </form>

                        <button type="button" className="kp-auth__magic" onClick={sendMagicLink} disabled={pending}>
                            ✉️ Quên mật khẩu? Gửi link đăng nhập qua email
                        </button>
                    </>
                )}
            </main>
        </div>
    );
}
