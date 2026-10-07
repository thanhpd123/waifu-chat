import { Component, Suspense, lazy, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import StartupError from './components/StartupError';
import { AuthProvider, displayName, useAuth } from './lib/auth';
import { createLocalStore, createSupabaseStore } from './lib/chatStore';
import { loadCubismCore } from './lib/live2dCore';
import { navigate, usePath } from './lib/router';
import Landing from './pages/Landing';
import Login from './pages/Login';

/**
 * Khung chat chỉ được tải khi vào `/chat`, và PHẢI nạp Cubism Core trước:
 * `pixi-live2d-display` kiểm tra `window.Live2DCubismCore` ngay khi import.
 */
const ChatApp = lazy(async () => {
    await loadCubismCore();
    return import('./App');
});

class ChatErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: unknown) {
        console.error('[Kei] Không khởi động được khung chat:', error);
    }

    render() {
        if (this.state.failed) {
            return (
                <StartupError message="Không nạp được Live2D Cubism Core (đã thử bản local và các CDN). Hãy kiểm tra kết nối mạng rồi tải lại trang." />
            );
        }
        return this.props.children;
    }
}

function Splash() {
    return (
        <div className="splash" role="status">
            <span className="splash__logo">🌸</span>
            <p>Kei đang chuẩn bị…</p>
        </div>
    );
}

function ChatRoute() {
    const { loading, user, client, authEnabled, signOut } = useAuth();
    const mustLogin = authEnabled && !loading && !user;

    useEffect(() => {
        if (mustLogin) navigate('/login?next=/chat', { replace: true });
    }, [mustLogin]);

    // Mỗi tài khoản một "kho" riêng; chưa cấu hình Supabase → lưu trong trình duyệt.
    // Phụ thuộc vào user.id (không phải object user): Supabase tạo object mới mỗi lần
    // làm mới token, nếu không thì danh sách chat sẽ bị tải lại giữa chừng.
    const userId = user?.id;
    const store = useMemo(
        () =>
            loading
                ? null
                : client && userId
                  ? createSupabaseStore(client, userId)
                  : authEnabled
                    ? null
                    : createLocalStore(),
        [loading, client, userId, authEnabled],
    );

    if (loading || !store) return <Splash />;

    const account = user
        ? {
              name: displayName(user),
              email: user.email ?? '',
              onSignOut: async () => {
                  await signOut();
                  navigate('/', { replace: true });
              },
          }
        : null;

    return (
        <ChatErrorBoundary>
            <Suspense fallback={<Splash />}>
                <ChatApp key={user?.id ?? 'local'} store={store} account={account} />
            </Suspense>
        </ChatErrorBoundary>
    );
}

function Routes() {
    const path = usePath();
    if (path === '/chat' || path.startsWith('/chat/')) return <ChatRoute />;
    if (path === '/login') return <Login />;
    return <Landing />;
}

export default function Root() {
    return (
        <AuthProvider>
            <Routes />
        </AuthProvider>
    );
}
