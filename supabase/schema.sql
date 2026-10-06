-- ============================================================================
-- 🌸 Kei · Live2D Chat — schema Supabase (đăng nhập + nhiều cuộc trò chuyện)
-- ----------------------------------------------------------------------------
-- Chạy MỘT lần: Supabase Dashboard → SQL Editor → New query → dán toàn bộ → Run.
-- Chạy lại cũng an toàn (dùng IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Row Level Security: mỗi người dùng CHỈ đọc/ghi được dữ liệu của chính mình,
-- nên frontend dùng anon key công khai mà vẫn an toàn.
-- ============================================================================

-- Hồ sơ: độ thân thiết với Kei + cài đặt (đồng bộ giữa các thiết bị).
create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    affection int not null default 5 check (affection between 0 and 100),
    settings jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Mỗi cuộc trò chuyện (phiên chat) của người dùng.
create table if not exists public.conversations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    title text not null default 'Cuộc trò chuyện mới' check (char_length(title) <= 120),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists conversations_user_updated_idx
    on public.conversations (user_id, updated_at desc);

-- Tin nhắn trong từng cuộc trò chuyện.
create table if not exists public.messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null check (char_length(content) <= 8000),
    emotion text,
    created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx
    on public.messages (conversation_id, created_at);

-- Có tin nhắn mới → đẩy cuộc trò chuyện lên đầu danh sách.
create or replace function public.touch_conversation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    update public.conversations set updated_at = now() where id = new.conversation_id;
    return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
    after insert on public.messages
    for each row execute function public.touch_conversation();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles: own row" on public.profiles;
create policy "profiles: own row" on public.profiles
    for all to authenticated
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

drop policy if exists "conversations: own rows" on public.conversations;
create policy "conversations: own rows" on public.conversations
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists "messages: own rows" on public.messages;
create policy "messages: own rows" on public.messages
    for all to authenticated
    using (user_id = (select auth.uid()))
    with check (
        user_id = (select auth.uid())
        and exists (
            select 1 from public.conversations c
            where c.id = conversation_id and c.user_id = (select auth.uid())
        )
    );
