import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Kết nối Supabase (đăng nhập + lưu các cuộc trò chuyện).
 *
 * Cấu hình được đọc LÚC CHẠY từ backend (`/api/public-config`), backend lấy từ
 * biến môi trường Vercel: VITE_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL và
 * VITE_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
 * → Thêm/đổi biến trên Vercel là có hiệu lực, không phải chờ build lại frontend,
 *   và frontend luôn khớp với việc backend có đòi đăng nhập hay không.
 *
 * Biến cùng tên lúc build (nếu có) được dùng ngay, khỏi phải gọi backend.
 * Không có cấu hình → app chạy chế độ "local": lưu lịch sử trong trình duyệt.
 * URL + publishable key được phép công khai: mọi bảng đều bật Row Level Security.
 */

export interface AuthConfig {
    client: SupabaseClient | null;
    googleLogin: boolean;
}

/** Biến đầu tiên có giá trị lúc build (chấp nhận cả VITE_* lẫn NEXT_PUBLIC_*). */
function firstEnv(...names: string[]): string | undefined {
    const env = import.meta.env as Record<string, string | undefined>;
    for (const name of names) {
        const value = env[name]?.trim();
        if (value) return value;
    }
    return undefined;
}

function makeClient(url: string, key: string): SupabaseClient {
    return createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
}

interface PublicConfig {
    supabase_url?: string | null;
    supabase_key?: string | null;
    google_login?: boolean;
}

async function fetchPublicConfig(timeoutMs = 15000): Promise<PublicConfig | null> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch('/api/public-config', { signal: controller.signal });
        if (!response.ok) return null;
        return (await response.json()) as PublicConfig;
    } catch {
        return null;
    } finally {
        window.clearTimeout(timer);
    }
}

async function resolveConfig(): Promise<AuthConfig> {
    const buildGoogle = firstEnv('VITE_ENABLE_GOOGLE_LOGIN', 'NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN') === '1';
    const buildUrl = firstEnv('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
    const buildKey = firstEnv(
        'VITE_SUPABASE_ANON_KEY',
        'VITE_SUPABASE_PUBLISHABLE_KEY',
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
    if (buildUrl && buildKey) return { client: makeClient(buildUrl, buildKey), googleLogin: buildGoogle };

    const remote = await fetchPublicConfig();
    const url = remote?.supabase_url?.trim();
    const key = remote?.supabase_key?.trim();
    return {
        client: url && key ? makeClient(url, key) : null,
        googleLogin: buildGoogle || remote?.google_login === true,
    };
}

let pending: Promise<AuthConfig> | null = null;

/** Cấu hình đăng nhập (chỉ tải một lần, dùng chung cho cả app). */
export function loadAuthConfig(): Promise<AuthConfig> {
    if (!pending) pending = resolveConfig();
    return pending;
}

/** Header Authorization cho các request tới backend Kei (rỗng khi chưa đăng nhập). */
export async function authHeaders(): Promise<Record<string, string>> {
    try {
        const { client } = await loadAuthConfig();
        if (!client) return {};
        const { data } = await client.auth.getSession();
        const token = data.session?.access_token;
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
        return {};
    }
}
