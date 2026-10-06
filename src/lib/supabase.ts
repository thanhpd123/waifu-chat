import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Kết nối Supabase (đăng nhập + lưu các cuộc trò chuyện).
 *
 * Cấu hình bằng biến môi trường lúc build (Vercel → Environment Variables):
 *   VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, hoặc tên kiểu Next.js
 *   NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
 *
 * Anon key được phép công khai: mọi bảng đều bật Row Level Security
 * (xem `supabase/schema.sql`). Thiếu biến → app chạy chế độ "local" như cũ,
 * lưu lịch sử trong trình duyệt và không yêu cầu đăng nhập.
 */

/** Biến đầu tiên có giá trị (chấp nhận cả tên VITE_* lẫn NEXT_PUBLIC_* của Supabase/Vercel). */
function firstEnv(...names: string[]): string | undefined {
    const env = import.meta.env as Record<string, string | undefined>;
    for (const name of names) {
        const value = env[name]?.trim();
        if (value) return value;
    }
    return undefined;
}

const url = firstEnv('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
const anonKey = firstEnv(
    'VITE_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
);

export const supabase: SupabaseClient | null =
    url && anonKey
        ? createClient(url, anonKey, {
              auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
          })
        : null;

export const authEnabled = supabase !== null;

/** Đăng nhập Google chỉ hiện khi đã bật provider Google trong Supabase. */
export const googleLoginEnabled = firstEnv('VITE_ENABLE_GOOGLE_LOGIN', 'NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN') === '1';

/** Header Authorization cho các request tới backend Kei (rỗng khi chưa đăng nhập). */
export async function authHeaders(): Promise<Record<string, string>> {
    if (!supabase) return {};
    try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
        return {};
    }
}
