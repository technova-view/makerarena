-- Phase 3C: billing foundation. First migration touching real money - the
-- database side of Polar (merchant-of-record) subscriptions, payments, and
-- entitlements, plus the sole write path into all of it (the webhook route
-- handler, using createAdminClient()). See lib/supabase/admin.ts and
-- app/api/webhooks/polar/route.ts for the app-layer half of this design.
--
-- SECURITY INVARIANT (the entire point of this migration, same rigor as
-- TD-001 in TECH_DEBT.md): nothing in this migration references, and
-- nothing built on top of it may ever come to reference, products.rating,
-- products.all_time_rating, products.battles_count, divisions, achievements,
-- or maker_ranks. Money buys visibility/analytics/customization, never
-- competitive standing. Structurally enforced by omission: none of those
-- tables/columns appear anywhere below, and every entitlement is a
-- snapshot fixed at grant time - never a live join against subscription
-- status, and never a join against anything competitive.
--
-- Replacing, not extending, 0002's placeholders: DROP + recreate, since
-- nothing in the app or real data depends on their current shape (grep
-- confirms zero references). featured_campaigns is DROPPED HERE AND
-- DELIBERATELY NOT RECREATED - its redesign is Phase 3D's job (Featured
-- checkout doesn't exist yet either, pending Polar's written confirmation
-- that paid promotion is acceptable). This is not an oversight; the
-- absence of a featured_campaigns table from this migration is the
-- intended end state until 3D.
--
-- DROP ... CASCADE also removes, without any separate statement needed:
--   - 0003's three policies ("maker reads own subscriptions/payments/
--     featured campaigns") - policies are owned by the table they're on.
--   - 0004's subscriptions_set_updated_at trigger - same reason. Recreated
--     below on the new subscriptions table, reusing the still-existing
--     public.set_updated_at() function (that function itself is untouched).
drop table if exists public.subscriptions, public.payments, public.featured_campaigns cascade;

-- ============================================================
-- 1. webhook_events - idempotency + audit log for raw Polar deliveries
-- ============================================================
--
-- Pure backend table: no client, not even an authenticated one, should
-- ever see a row here (it's the source-of-truth audit trail for money
-- events, and its RLS/grant posture is intentionally the strictest in this
-- migration - see the revoke below).
--
-- processed_at is nullable with NO default (deliberately not "default
-- now()"): the insert-first idempotency pattern below has a real failure
-- window - if the process crashes after this row is inserted but before
-- the corresponding subscriptions/payments/entitlements writes finish, a
-- retried delivery would hit the provider_event_id unique violation and be
-- treated as an already-handled duplicate, silently dropping that
-- delivery's actual effect. Leaving processed_at null until the business
-- logic genuinely completes (route handler UPDATEs it afterward) means a
-- crash-in-the-middle delivery is distinguishable after the fact
-- (`where processed_at is null`) and recoverable via manual replay against
-- the full raw payload stored here.
create table public.webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  provider_event_id  text not null unique,
  event_type         text not null,
  payload            jsonb not null,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz
);

-- Supports an eventual ops/replay script scanning for stuck deliveries
-- (crashed mid-processing, or a bug that made business logic fail every
-- retry) - not used by anything in this pass, cheap to have now.
create index webhook_events_unprocessed_idx
  on public.webhook_events (received_at) where processed_at is null;

alter table public.webhook_events enable row level security;

-- No policies at all, for any command. RLS enabled + zero policies means
-- every row implicitly fails every command for every role (default-deny),
-- same as votes'/maker_achievements' write posture - except here it's
-- applied to SELECT too, not just writes, because this table must be
-- invisible to PostgREST from the client's perspective entirely, not just
-- unwritable.
--
-- Belt-and-suspenders beyond RLS: explicitly revoke every table-level
-- privilege from anon/authenticated too, exactly like the fix 0007 found
-- for products.rating - Supabase grants broad table-level privileges to
-- anon/authenticated by default at table-creation time (this is Supabase's
-- own platform default, not raw Postgres's), so RLS's default-deny is not
-- the only thing standing between this table and a client request; the
-- grant itself must be revoked too.
revoke all on public.webhook_events from anon, authenticated;

-- ============================================================
-- 2. subscriptions - current-state mirror of each Polar subscription
--    object (one row per Polar subscription id, not append-only history)
-- ============================================================
--
-- plan is kept as a two-value check (free/pro) to match SubscriptionPlan's
-- existing precedent elsewhere in the schema, but in practice every row
-- this migration's write path ever produces has plan = 'pro' - Polar has
-- no object representing the free tier (a maker with zero subscription
-- rows IS the free tier, implicitly). 'free' is not currently reachable
-- through any write path; kept for schema symmetry only.
--
-- status: text check, not a native enum, mirroring the achievements.category
-- precedent (cheap to ALTER later). Values confirmed directly from
-- @polar-sh/sdk's real SubscriptionStatus type (node_modules/@polar-sh/sdk/
-- src/models/components/subscriptionstatus.ts) - Polar's own status enum
-- has no "revoked" value (that's an EVENT name - subscription.revoked -
-- describing "benefit access was pulled", not a resting status the
-- subscription object itself ever holds). A revoked subscription's real
-- status is whatever terminal value Polar assigns (canceled/unpaid/etc.),
-- which already correctly stops future pro_access grants below since only
-- status = 'active' grants anything.
--
-- cancel_at_period_end models Polar's "canceled" (cancellation scheduled,
-- access continues) vs the subscription.revoked event (access actually
-- pulled) distinction, and the fact that subscription.uncanceled means a
-- scheduled cancellation can be reversed before it takes effect - this is
-- a real, reversible flag, not a one-way boolean.
create table public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  maker_id                 uuid not null references public.makers(id) on delete cascade,
  provider_subscription_id text not null unique,
  provider_customer_id     text not null,
  plan                     text not null default 'pro' check (plan in ('free', 'pro')),
  status                   text not null
                             check (status in (
                               'incomplete', 'incomplete_expired', 'trialing', 'active',
                               'past_due', 'canceled', 'unpaid', 'paused'
                             )),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- At most one ACTIVE subscription per maker, ever - exact seasons_single_
-- active_idx idiom from 0008: a unique index on a column whose indexed
-- value is constant ('active') for every matching row makes a second
-- concurrently-active row for the same maker a literal duplicate-value
-- violation. A maker can accumulate any number of non-active (canceled/
-- revoked/past_due) historical rows - only 'active' is constrained.
create unique index subscriptions_single_active_idx
  on public.subscriptions (maker_id) where status = 'active';

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

-- This is the app's first genuinely private per-user data - everything
-- else in this schema (products, votes, achievements, maker_ranks) is
-- fully public by design. The posture here is deliberately stricter than
-- votes'/maker_achievements' "no write policy, rely on RLS default-deny":
-- this data must also never be READABLE by anyone but its owner, so a
-- missing INSERT policy alone isn't enough defense-in-depth - the table-
-- level grant itself is revoked too, exactly mirroring the products.rating
-- fix's finding that a column/row-level control alone doesn't override a
-- broader table-level grant that's still in effect.
create policy "maker reads own subscriptions" on public.subscriptions
  for select using (maker_id = auth.uid());

-- Full revoke from anon (not just write commands) - anon has no identity,
-- so the RLS policy above already implicitly denies it every row, but
-- revoking the grant outright removes the surface entirely rather than
-- relying on RLS alone, consistent with webhook_events above.
revoke all on public.subscriptions from anon;
-- authenticated keeps SELECT (gated by the policy above, own rows only);
-- insert/update/delete are revoked outright - the ONLY write path for this
-- table is apply_subscription_event() below, called exclusively from the
-- webhook route handler via createAdminClient() (service-role, bypasses
-- RLS and grants both).
revoke insert, update, delete on public.subscriptions from authenticated;

-- ============================================================
-- 3. payments - immutable, append-only, one row per confirmed Polar
--    payment (order.paid), never updated after insert
-- ============================================================
--
-- Deliberate scope decision: only order.paid produces a row here, NOT
-- order.created - an order that's merely created isn't yet a confirmed
-- payment, and re-using the same provider_payment_id for both a "created"
-- and later "paid" row would either violate the unique constraint or
-- require mutating a row this table is designed to never mutate.
-- order.created is still fully audited via webhook_events, just never
-- promoted into this table.
--
-- webhook_event_id is NOT NULL, deliberately unlike subscription_id -
-- every payments row is written from inside the webhook handler, which by
-- construction always already has a webhook_events row for that delivery;
-- there is no legitimate path to a payments row without one.
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  maker_id            uuid not null references public.makers(id) on delete cascade,
  subscription_id     uuid references public.subscriptions(id) on delete set null,
  webhook_event_id    uuid not null references public.webhook_events(id),
  provider_payment_id text not null unique,
  amount_cents        integer not null check (amount_cents >= 0),
  currency            text not null default 'usd',
  status              text not null default 'succeeded'
                        check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  created_at          timestamptz not null default now()
);

-- "This maker's payment history" - the one real query shape for this
-- table, mirroring votes_voter_created_idx's precedent.
create index payments_maker_created_idx on public.payments (maker_id, created_at desc);

alter table public.payments enable row level security;

create policy "maker reads own payments" on public.payments
  for select using (maker_id = auth.uid());

revoke all on public.payments from anon;
revoke insert, update, delete on public.payments from authenticated;
-- Immutability here is enforced the same way as everywhere else in this
-- migration: there is no write path at all for authenticated/anon, and the
-- one privileged write path - apply_order_paid() below - only ever INSERTs,
-- never UPDATEs, this table.

-- ============================================================
-- 4. entitlements - snapshot-of-what-was-granted, fixed at purchase/
--    renewal time. THE table any future Pro-gated or Featured-credit
--    feature reads - never a live join against subscriptions.status.
-- ============================================================
--
-- effective_at is deliberately set to the SUBSCRIPTION'S current_period_
-- start (a Polar-reported value), not now()/the webhook's own delivery
-- timestamp - this makes grants naturally idempotent-safe: any number of
-- retried/duplicate deliveries for the same renewal all compute the exact
-- same effective_at, so entitlements_subscription_type_period_idx below
-- can catch a duplicate grant attempt even if webhook_events' own
-- delivery-level idempotency were ever somehow bypassed (defense in depth,
-- matching this migration's posture everywhere else).
--
-- consumed_at (null = unused) rather than a quantity/ledger system - v1-
-- simple by design, per the explicit "don't design a credit economy yet"
-- instruction. Nothing in this pass performs that UPDATE; it exists so a
-- LATER feature (3D's promotion checkout, consuming a featured_credit) can
-- set it through a still-privileged path without this migration needing
-- revisiting.
create table public.entitlements (
  id              uuid primary key default gen_random_uuid(),
  maker_id        uuid not null references public.makers(id) on delete cascade,
  type            text not null check (type in ('pro_access', 'featured_credit')),
  subscription_id uuid references public.subscriptions(id) on delete set null,
  granted_at      timestamptz not null default now(),
  effective_at    timestamptz not null,
  expires_at      timestamptz,
  consumed_at     timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  check (expires_at is null or expires_at > effective_at)
);

-- The idempotency backstop referenced above - "one grant of this type per
-- subscription per billing period", where "period" is identified by the
-- period's own start timestamp rather than a locally-generated one.
-- subscription_id is not null for every entitlement type this migration's
-- write path produces (both pro_access and featured_credit are always
-- subscription-linked in 3C - no one-time promotion purchase exists yet);
-- a hypothetical future non-subscription-linked entitlement (3D) simply
-- isn't covered by this uniqueness rule, which is fine - that's a
-- different problem for a different migration to solve.
create unique index entitlements_subscription_type_period_idx
  on public.entitlements (subscription_id, type, effective_at)
  where subscription_id is not null;

-- "What does maker X currently have" - the read path every future Pro-
-- gated feature and the 3D promotion-checkout flow will use.
create index entitlements_maker_type_idx
  on public.entitlements (maker_id, type, effective_at desc);

alter table public.entitlements enable row level security;

create policy "maker reads own entitlements" on public.entitlements
  for select using (maker_id = auth.uid());

revoke all on public.entitlements from anon;
revoke insert, update, delete on public.entitlements from authenticated;

-- ============================================================
-- 5. apply_subscription_event - the one function every subscription.*
--    webhook event routes through (created/active/updated/canceled/
--    uncanceled/revoked all share this)
-- ============================================================
--
-- security invoker (the default), deliberately NOT definer - unlike
-- cast_vote/run_season_transition, which need SECURITY DEFINER to let an
-- authenticated user's session write to RLS-protected rows it has no
-- direct grant on, this function is only ever called by the admin client
-- authenticating as service_role, which already bypasses RLS and already
-- has full table privileges directly - SECURITY DEFINER would be an
-- unnecessary elevation with nothing to elevate, matching product_
-- divisions()'s own reasoning for why invoker was the deliberate choice
-- there.
--
-- Always upserts the mirror row (regardless of status); ONLY conditionally
-- grants pro_access when the resulting status is 'active'. This is what
-- makes cancellation/revocation correctly NOT touch previously-granted
-- entitlements - an entitlement, once granted, is fixed; canceling stops
-- future renewal, it does not retroactively shrink what was already paid
-- for. Safe to call for subscription.uncanceled too (status flips back to
-- 'active', the grant attempt below almost always no-ops via the unique
-- index since a grant for that period already exists from when it first
-- went active).
create or replace function public.apply_subscription_event(
  p_maker_id                  uuid,
  p_provider_subscription_id  text,
  p_provider_customer_id      text,
  p_plan                      text,
  p_status                    text,
  p_current_period_start      timestamptz,
  p_current_period_end        timestamptz,
  p_cancel_at_period_end      boolean
)
returns uuid
language plpgsql
security invoker set search_path = public
as $$
declare
  v_subscription_id uuid;
begin
  insert into public.subscriptions (
    maker_id, provider_subscription_id, provider_customer_id,
    plan, status, current_period_start, current_period_end, cancel_at_period_end
  ) values (
    p_maker_id, p_provider_subscription_id, p_provider_customer_id,
    p_plan, p_status, p_current_period_start, p_current_period_end, p_cancel_at_period_end
  )
  on conflict (provider_subscription_id) do update
    set maker_id              = excluded.maker_id,
        provider_customer_id  = excluded.provider_customer_id,
        plan                  = excluded.plan,
        status                = excluded.status,
        current_period_start  = excluded.current_period_start,
        current_period_end    = excluded.current_period_end,
        cancel_at_period_end  = excluded.cancel_at_period_end
  returning id into v_subscription_id;

  if p_status = 'active' and p_current_period_start is not null then
    insert into public.entitlements (maker_id, type, subscription_id, effective_at, expires_at)
    values (p_maker_id, 'pro_access', v_subscription_id, p_current_period_start, p_current_period_end)
    on conflict (subscription_id, type, effective_at) where subscription_id is not null do nothing;
  end if;

  return v_subscription_id;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default (the exact
-- gap 0008 found and fixed for cast_vote, and 0010 found again for the
-- achievement functions) - explicit revoke-then-grant every time, never
-- assumed. Leaving PUBLIC ungranted-from would let anon/authenticated call
-- this directly, bypassing the webhook's own identity resolution entirely.
revoke execute on function public.apply_subscription_event(
  uuid, text, text, text, text, timestamptz, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.apply_subscription_event(
  uuid, text, text, text, text, timestamptz, timestamptz, boolean
) to service_role;

-- ============================================================
-- 6. apply_order_paid - order.paid routes through this
-- ============================================================
--
-- Takes our own internal subscription uuid (p_subscription_id), not the
-- external provider_subscription_id - identity/lookup resolution is kept
-- in the TS layer (see the route handler) where the "subscription row
-- doesn't exist yet" ordering-race case can be logged and handled
-- explicitly, rather than silently swallowed inside SQL.
--
-- Credit-minting guard: v_payment_id is null both when this exact payment
-- was already recorded by a prior delivery (ON CONFLICT DO NOTHING on
-- provider_payment_id) and, structurally, whenever p_subscription_id is
-- null - either way, skipping the credit mint is correct: a genuinely new
-- payment for a genuinely new period is the only case that should mint,
-- and entitlements_subscription_type_period_idx is the actual idempotency
-- guarantee even if this payments-level guard were somehow bypassed.
create or replace function public.apply_order_paid(
  p_maker_id            uuid,
  p_subscription_id     uuid,
  p_provider_payment_id text,
  p_amount_cents        integer,
  p_currency            text,
  p_webhook_event_id    uuid,
  p_period_start        timestamptz,
  p_period_end          timestamptz
)
returns uuid
language plpgsql
security invoker set search_path = public
as $$
declare
  v_payment_id uuid;
begin
  insert into public.payments (
    maker_id, subscription_id, webhook_event_id,
    provider_payment_id, amount_cents, currency, status
  ) values (
    p_maker_id, p_subscription_id, p_webhook_event_id,
    p_provider_payment_id, p_amount_cents, p_currency, 'succeeded'
  )
  on conflict (provider_payment_id) do nothing
  returning id into v_payment_id;

  if v_payment_id is not null and p_subscription_id is not null and p_period_start is not null then
    insert into public.entitlements (maker_id, type, subscription_id, effective_at, expires_at)
    values (p_maker_id, 'featured_credit', p_subscription_id, p_period_start, p_period_end)
    on conflict (subscription_id, type, effective_at) where subscription_id is not null do nothing;
  end if;

  return v_payment_id;
end;
$$;

revoke execute on function public.apply_order_paid(
  uuid, uuid, text, integer, text, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_order_paid(
  uuid, uuid, text, integer, text, uuid, timestamptz, timestamptz
) to service_role;
