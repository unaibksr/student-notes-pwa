-- ============================================================
-- Student Notes PWA — Supabase schema
-- Run this in the Supabase SQL editor (or via CLI migration).
-- ============================================================

-- 1. Table
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  student     text not null,
  title       text not null default 'Untitled note',
  content     text not null default '',
  language    text not null default 'en' check (language in ('en', 'ur')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Helpful indexes
create index if not exists notes_student_idx on public.notes (student);
create index if not exists notes_updated_at_idx on public.notes (updated_at desc);

-- 2. Keep updated_at fresh on every update
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- 3. Realtime (the app subscribes via postgres_changes on public.notes)
-- Idempotent: only add if not already a member (no IF NOT EXISTS for publications).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table public.notes;
  end if;
end $$;

-- 4. Row Level Security
-- This app has no auth layer, so we allow anonymous full access.
-- Tighten these policies before shipping to production.
alter table public.notes enable row level security;

drop policy if exists "notes_select" on public.notes;
create policy "notes_select" on public.notes
  for select using (true);

drop policy if exists "notes_insert" on public.notes;
create policy "notes_insert" on public.notes
  for insert with check (true);

drop policy if exists "notes_update" on public.notes;
create policy "notes_update" on public.notes
  for update using (true) with check (true);

drop policy if exists "notes_delete" on public.notes;
create policy "notes_delete" on public.notes
  for delete using (true);
