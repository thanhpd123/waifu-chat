import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Kết nối Supabase (đăng nhập + lưu các cuộc trò chuyện).
 *
 * Cấu hình bằng biến môi trường lúc build (Vercel → Environment Variables):
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 *
 * Anon key được phép công khai: mọi bảng đều bật Row Level Security
 * (xem `supabase/schema.sql`). Thiếu biến → app chạy chế độ "local" như cũ,
 * lưu lịch sử trong trình duyệt và không yêu cầu đăng nhập.
 */

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const supabase: SupabaseClient | null =
    url && anonKey
        ? createClient(url, anonKey, {
              auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
          })
        : null;

export const authEnabled = supabase !== null;

/** Đăng nhập Google chỉ hiện khi đã bật provider Google trong Supabase. */
export const googleLoginEnabled = import.meta.env.VITE_ENABLE_GOOGLE_LOGIN === '1';

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
