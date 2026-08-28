-- Phase 3D: order.refunded webhook handling. Until this migration,
-- order.refunded fell through the webhook route's default case
-- (webhook_events audit row only, no action) - a real gap once the Polar
-- webhook endpoint is actually subscribed to this event (see
-- app/api/webhooks/polar/route.ts).
--
-- 0013's payments table is documented as append-only/never-updated ("the
-- one privileged write path - apply_order_paid() - only ever INSERTs,
-- never UPDATEs, this table"). This function is a deliberate, narrow
-- exception to that, not a reversal of it: Polar reports a refund as a
-- state change on the SAME order (Order.refundedAmount), not a new object
-- with its own id, so there is no insertable "refund row" to append -
-- flipping payments.status is the only faithful representation of what
-- happened. The CHECK constraint already allowed 'refunded' as a legal
-- status back in 0013; this is the first migration to ever reach it.
--
-- No status-guard on the UPDATE (unlike a typical idempotency check
-- elsewhere in this schema): re-running for an already-refunded row just
-- re-sets the same value, which is itself the idempotency guarantee for a
-- retried delivery - simpler than a conditional, and RETURNING still
-- reports the row either way so the caller can distinguish "found and
-- marked" from "no local payment record at all" (NULL), the latter being
-- the real failure case (see the route handler's ordering-race handling,
-- mirroring order.paid's own).
--
-- Deliberately does NOT touch entitlements - whether a refund should also
-- cut short an already-granted pro_access/featured_credit entitlement is a
-- real product-policy decision (duplicate charge vs. fraud vs. accidental
-- purchase vs. partial refund all plausibly warrant different outcomes),
-- not something safe to infer from the webhook alone. See TD-002 in
-- TECH_DEBT.md.
create or replace function public.apply_order_refunded(
  p_provider_payment_id text
)
returns uuid
language plpgsql
security invoker set search_path = public
as $$
declare
  v_payment_id uuid;
begin
  update public.payments
    set status = 'refunded'
    where provider_payment_id = p_provider_payment_id
    returning id into v_payment_id;

  return v_payment_id;
end;
$$;

revoke execute on function public.apply_order_refunded(text) from public, anon, authenticated;
grant execute on function public.apply_order_refunded(text) to service_role;
