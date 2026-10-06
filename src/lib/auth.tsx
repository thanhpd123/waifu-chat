import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { loadAuthConfig } from './supabase';

interface AuthState {
    /** Đang tải cấu hình / đọc phiên đăng nhập đã lưu (chưa biết đăng nhập hay chưa). */
    loading: boolean;
    /** null = chưa cấu hình Supabase → chế độ lưu trong trình duyệt. */
    client: SupabaseClient | null;
    authEnabled: boolean;
    googleLogin: boolean;
    session: Session | null;
    user: User | null;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
    loading: true,
    client: null,
    authEnabled: false,
    googleLogin: false,
    session: null,
    user: null,
    signOut: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [client, setClient] = useState<SupabaseClient | null>(null);
    const [googleLogin, setGoogleLogin] = useState(false);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        let unsubscribe: (() => void) | undefined;

        void loadAuthConfig().then(async config => {
            if (!alive) return;
            setClient(config.client);
            setGoogleLogin(config.googleLogin);
            if (!config.client) {
                setLoading(false);
                return;
            }
            const { data } = config.client.auth.onAuthStateChange((_event, next) => {
                setSession(next);
                setLoading(false);
            });
            unsubscribe = () => data.subscription.unsubscribe();
            const current = await config.client.auth.getSession();
            if (!alive) return;
            setSession(current.data.session);
            setLoading(false);
        });

        return () => {
            alive = false;
            unsubscribe?.();
        };
    }, []);

    const value = useMemo<AuthState>(
        () => ({
            loading,
            client,
            authEnabled: client !== null,
            googleLogin,
            session,
            user: session?.user ?? null,
            signOut: async () => {
                await client?.auth.signOut();
            },
        }),
        [loading, client, googleLogin, session],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
    return useContext(AuthContext);
}

/** Tên hiển thị: tên từ Google, nếu không có thì phần trước @ của email. */
// eslint-disable-next-line react-refresh/only-export-components
export function displayName(user: User | null): string {
    if (!user) return '';
    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const name = (meta?.full_name ?? meta?.name) as string | undefined;
    return name?.trim() || user.email?.split('@')[0] || 'cậu';
}
