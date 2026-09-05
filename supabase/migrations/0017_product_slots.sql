-- Phase 3A revision (2026-09-05): Polar rejected paid Featured placement in
-- every form it was asked about - standalone purchase, bidding/auction, and
-- a Featured credit bundled as a Pro subscription perk (see project memory,
-- not tracked in this repo). featured_credit is dropped as an entitlement
-- type entirely; Pro's replacement perk is extra product slots, decided
-- directly with the user - simple to enforce (a count check), and
-- structurally cannot touch rating/division/MakerRank/achievements, same
-- boundary as everything else this billing system grants.
--
-- Real featured_credit rows exist in this project's actual database from
-- Phase 3D's live sandbox checkout verification (see TECH_DEBT.md PL-002) -
-- deleted below rather than left orphaned by the tightened type constraint.
delete from public.entitlements where type = 'featured_credit';

-- value is nullable: pro_access doesn't use it (presence/effective_at/
-- expires_at alone is the grant), only numeric entitlement types like
-- product_slots do.
alter table public.entitlements add column value integer;

alter table public.entitlements drop constraint entitlements_type_check;
alter table public.entitlements add constraint entitlements_type_check
  check (type in ('pro_access', 'product_slots'));

-- ============================================================
-- apply_subscription_event: now grants product_slots alongside pro_access,
-- same period, same idempotency guard (entitlements_subscription_type_
-- period_idx already covers any type, not just pro_access).
-- ============================================================
--
-- 3 is hardcoded, not read from anywhere configurable - matching pro_access's
-- own precedent of a fixed, non-tiered grant. Free tier's implicit limit (1)
-- lives in current_product_slot_limit() below, not here - there's no
-- Polar-side object for the free tier to attach a row to (same reasoning
-- 0013 documents for why plan='free' is schema-only, never reachable).
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

    insert into public.entitlements (maker_id, type, value, subscription_id, effective_at, expires_at)
    values (p_maker_id, 'product_slots', 3, v_subscription_id, p_current_period_start, p_current_period_end)
    on conflict (subscription_id, type, effective_at) where subscription_id is not null do nothing;
  end if;

  return v_subscription_id;
end;
$$;

revoke execute on function public.apply_subscription_event(
  uuid, text, text, text, text, timestamptz, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.apply_subscription_event(
  uuid, text, text, text, text, timestamptz, timestamptz, boolean
) to service_role;

-- ============================================================
-- apply_order_paid: featured_credit minting removed. p_period_start/
-- p_period_end dropped from the signature - they existed solely to date
-- that grant; product_slots is subscription-lifecycle-driven (granted in
-- apply_subscription_event above, on subscription.active), not per-payment,
-- so nothing in this function needs a period any more. payments recording
-- itself is unchanged - this table is unrelated to what Featured used to be.
create or replace function public.apply_order_paid(
  p_maker_id            uuid,
  p_subscription_id     uuid,
  p_provider_payment_id text,
  p_amount_cents        integer,
  p_currency            text,
  p_webhook_event_id    uuid
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

  return v_payment_id;
end;
$$;

-- DROP required first: the old 8-arg overload (including the two removed
-- timestamptz params) doesn't get replaced by CREATE OR REPLACE with a
-- different signature - it would be left behind as a second, now-dead
-- overload instead of actually being removed.
drop function if exists public.apply_order_paid(
  uuid, uuid, text, integer, text, uuid, timestamptz, timestamptz
);

revoke execute on function public.apply_order_paid(
  uuid, uuid, text, integer, text, uuid
) from public, anon, authenticated;
grant execute on function public.apply_order_paid(
  uuid, uuid, text, integer, text, uuid
) to service_role;

-- ============================================================
-- current_product_slot_limit - the one place "how many slots does this
-- maker have right now" is computed. Used by the enforcement trigger below
-- and safe to expose to authenticated callers directly (it only reads what
-- the caller could already read via entitlements' own RLS policy).
-- ============================================================
--
-- 1 is the free-tier default - not a row anywhere, since free makers hold
-- no entitlement rows at all (same "absence = free tier" convention
-- pro_access already established). invoker, not definer: the caller's own
-- RLS-visible entitlements are all this ever reads.
create or replace function public.current_product_slot_limit(p_maker_id uuid)
returns integer
language sql
stable
security invoker set search_path = public
as $$
  select coalesce(
    (select value from public.entitlements
     where maker_id = p_maker_id
       and type = 'product_slots'
       and effective_at <= now()
       and (expires_at is null or expires_at > now())
     order by effective_at desc
     limit 1),
    1
  );
$$;

revoke execute on function public.current_product_slot_limit(uuid) from public;
grant execute on function public.current_product_slot_limit(uuid) to anon, authenticated, service_role;

-- ============================================================
-- enforce_product_slot_limit - BEFORE INSERT trigger on products, the
-- server-side gate the user asked for ("derived from entitlement/plan
-- state, not the frontend"). UPDATE is deliberately not covered: archiving
-- (status -> 'archived') only ever frees a slot, never consumes one, and
-- there is no supported draft -> published transition path today (products
-- are only ever inserted as 'published' - see lib/actions/products.ts) that
-- would need a second check after the row already exists.
-- ============================================================
--
-- pg_advisory_xact_lock, keyed per maker_id, is what makes this race-safe
-- against two concurrent submissions from the same maker: without it, two
-- simultaneous inserts could both read the same pre-insert count and both
-- pass the check before either commits. The lock is per-transaction (released
-- automatically at commit/rollback, no explicit unlock needed) and only
-- serializes a single maker's own concurrent inserts against each other -
-- it has no effect across different makers.
create or replace function public.enforce_product_slot_limit()
returns trigger
language plpgsql
security invoker set search_path = public
as $$
declare
  v_limit integer;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.maker_id::text, 0));

  select public.current_product_slot_limit(new.maker_id) into v_limit;

  select count(*) into v_count
  from public.products
  where maker_id = new.maker_id
    and status in ('draft', 'published');

  if v_count >= v_limit then
    raise exception
      'You''ve reached your plan''s product limit (%/%). Archive an existing product or upgrade to Pro for more slots.',
      v_count, v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger products_enforce_slot_limit
  before insert on public.products
  for each row execute function public.enforce_product_slot_limit();
