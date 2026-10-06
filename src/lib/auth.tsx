import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface AuthState {
    /** Đang đọc phiên đăng nhập đã lưu (chưa biết đăng nhập hay chưa). */
    loading: boolean;
    session: Session | null;
    user: User | null;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
    loading: false,
    session: null,
    user: null,
    signOut: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(supabase !== null);

    useEffect(() => {
        if (!supabase) return;
        let alive = true;
        void supabase.auth.getSession().then(({ data }) => {
            if (!alive) return;
            setSession(data.session);
            setLoading(false);
        });
        const { data } = supabase.auth.onAuthStateChange((_event, next) => {
            setSession(next);
            setLoading(false);
        });
        return () => {
            alive = false;
            data.subscription.unsubscribe();
        };
    }, []);

    const value = useMemo<AuthState>(
        () => ({
            loading,
            session,
            user: session?.user ?? null,
            signOut: async () => {
                await supabase?.auth.signOut();
            },
        }),
        [loading, session],
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
