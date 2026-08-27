-- Commercial/visibility tables. Deliberately no FK or trigger here writes
-- into products.rating or products.views - money buys visibility, never
-- competitive rank. Not populated by any app logic yet (no payment provider
-- is wired up this pass); exists so a future payment feature doesn't need a
-- breaking migration.
create table public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  maker_id                 uuid not null references public.makers(id) on delete cascade,
  plan                     text not null default 'free' check (plan in ('free', 'pro')),
  status                   text not null default 'inactive'
                             check (status in ('inactive', 'active', 'canceled', 'past_due')),
  provider                 text,
  provider_customer_id     text,
  provider_subscription_id text,
  current_period_end       timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  maker_id            uuid not null references public.makers(id) on delete cascade,
  subscription_id     uuid references public.subscriptions(id) on delete set null,
  amount_cents        integer not null,
  currency            text not null default 'usd',
  provider            text,
  provider_payment_id text,
  status              text not null default 'pending'
                         check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  created_at          timestamptz not null default now()
);

create table public.featured_campaigns (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  placement  text not null default 'category' check (placement in ('home', 'category', 'arena')),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  status     text not null default 'pending'
               check (status in ('pending', 'active', 'ended', 'canceled')),
  created_at timestamptz not null default now()
);
