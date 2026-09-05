-- Fixes a real gap found live in 0017_product_slots.sql: apply_subscription_
-- event only grants product_slots on a NEW webhook event, so any
-- subscription that was already 'active' before 0017 shipped (e.g. the real
-- waliur_0fb383 Pro account from the Phase 3D sandbox test, active since
-- 2026-08-28) kept its pro_access entitlement but never received a matching
-- product_slots one - current_product_slot_limit() correctly fell back to
-- the free-tier default (1) for an actively-paying Pro maker.
--
-- Backfill: for every pro_access grant that has no product_slots grant on
-- the same subscription_id + effective_at, insert one. Mirrors exactly what
-- apply_subscription_event itself would have inserted at grant time, so a
-- currently-active pro_access (expires_at in the future, or null) produces a
-- currently-active product_slots too - no separate "is this still active"
-- logic needed here beyond copying the same effective_at/expires_at.
--
-- Idempotent by construction (NOT EXISTS), safe to re-run - matches this
-- schema's existing idempotency convention rather than depending on running
-- this migration exactly once.
insert into public.entitlements (maker_id, type, value, subscription_id, effective_at, expires_at)
select pa.maker_id, 'product_slots', 3, pa.subscription_id, pa.effective_at, pa.expires_at
from public.entitlements pa
where pa.type = 'pro_access'
  and pa.subscription_id is not null
  and not exists (
    select 1 from public.entitlements ps
    where ps.type = 'product_slots'
      and ps.subscription_id = pa.subscription_id
      and ps.effective_at = pa.effective_at
  );
