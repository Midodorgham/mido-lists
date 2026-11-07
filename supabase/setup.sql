-- MIDO: جدول العملاء. الصقه في Supabase ← SQL Editor ← Run (مرة واحدة).
create table if not exists public.mido_customers (
  id        text primary key,
  username  text not null unique,
  password  text not null,
  name      text not null default '',
  phone     text not null default '',
  note      text not null default '',
  exp       bigint,
  enabled   boolean not null default true,
  trial     boolean not null default false,
  max       int not null default 1,
  created   bigint not null default 0,
  seen      bigint not null default 0,
  ip        text not null default '',
  watching  text not null default ''
);
-- مقفول على أي حد من برا: السيرفر بس (بمفتاح الخدمة) يقدر يقرا ويكتب.
alter table public.mido_customers enable row level security;
revoke all on public.mido_customers from anon, authenticated;
