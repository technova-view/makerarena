-- Core schema: makers (public profile extending auth.users), categories,
-- and products. `rating`/`views` are the only ranking-relevant columns and
-- are deliberately isolated here - see 0002 for why.
create extension if not exists pgcrypto;

create table public.makers (
  id           uuid primary key references auth.users(id) on delete cascade,
  -- Lowercase-only by constraint, so unique(username) is effectively
  -- case-insensitive without needing citext - "Waliur" can never be stored,
  -- only "waliur", so it can never collide-by-case with an existing row.
  username     text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null,
  avatar_url   text,
  bio          text,
  website_url  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.categories (
  slug        text primary key,
  name        text not null,
  description text,
  icon        text,
  sort_order  integer not null default 0
);

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  maker_id      uuid not null references public.makers(id) on delete cascade,
  category_slug text not null references public.categories(slug),
  name          text not null,
  slug          text not null unique,
  tagline       text,
  description   text not null,
  website_url   text not null,
  logo_url      text,
  screenshots   text[] not null default '{}',
  status        text not null default 'published'
                  check (status in ('draft', 'published', 'archived')),

  -- Ranking data. Nothing outside this table (and the future battle system)
  -- should ever write these - see 0002_placeholder_commercial.sql.
  rating        integer not null default 1500 check (rating >= 0),
  views         integer not null default 0 check (views >= 0),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index products_category_rating_idx on public.products (category_slug, rating desc);
create index products_maker_idx on public.products (maker_id);
