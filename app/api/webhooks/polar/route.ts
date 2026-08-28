import { NextResponse } from "next/server";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";

// Manual signature verification via the SDK's standalone validateEvent()
// (confirmed export - node_modules/@polar-sh/sdk/src/webhooks.ts - it wraps
// the Standard Webhooks spec verification and returns a fully-typed,
// already-parsed payload), not @polar-sh/nextjs's Webhooks adapter - this
// repo has no vendor route-wrapper precedent, and the adapter's exact
// per-event-vs-catch-all dispatch semantics aren't confirmed (matters here:
// double-processing risk if both a named callback and onPayload fired for
// the same delivery). Manual verification gives one unambiguous dispatch
// point: verify -> idempotency gate -> our own switch, once.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers);

  // Standard Webhooks spec: the delivery's own dedupe key is the
  // `webhook-id` HEADER, not a field inside the payload body - none of
  // Polar's webhook payload types (WebhookSubscriptionCreatedPayload,
  // WebhookOrderPaidPayload, etc.) carry an `id` field of their own, only
  // `{ type, timestamp, data }`. Confirmed by reading the SDK's generated
  // types directly.
  const providerEventId = headers["webhook-id"];
  if (!providerEventId) {
    return NextResponse.json({ error: "missing webhook-id header" }, { status: 400 });
  }

  let event: Awaited<ReturnType<typeof validateEvent>>;
  try {
    event = validateEvent(rawBody, headers, process.env.POLAR_WEBHOOK_SECRET!);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      console.error("polar webhook signature verification failed:", err.message);
      return NextResponse.json({ error: "invalid signature" }, { status: 400 });
    }
    throw err;
  }

  const admin = createAdminClient();

  // Idempotency gate - insert-first. A duplicate delivery (Polar retried
  // before seeing our prior 200, or a genuine re-send) hits the unique
  // constraint on provider_event_id and is a no-op from here on, not a
  // partial reprocessing - this is the load-bearing correctness property
  // for anything below that mints an entitlement or records a payment.
  const { data: eventRow, error: insertError } = await admin
    .from("webhook_events")
    .insert({
      provider_event_id: providerEventId,
      event_type: event.type,
      payload: event as unknown as Record<string, unknown>,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("webhook_events insert failed:", insertError.message);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  try {
    switch (event.type) {
      case "subscription.created":
      case "subscription.active":
      case "subscription.updated":
      case "subscription.uncanceled":
      case "subscription.canceled":
      case "subscription.revoked":
      case "subscription.past_due": {
        const sub = event.data;
        // maker_id resolution depends on checkout-session-creation code
        // (not part of this migration) having set the Polar customer's
        // external_id to our makers.id - a hard dependency on a piece
        // that doesn't exist yet. Field name confirmed real:
        // Subscription.customer.externalId (SubscriptionCustomer type).
        const makerId = sub.customer?.externalId ?? undefined;
        if (!makerId) {
          console.error("polar webhook: could not resolve maker_id for event", providerEventId);
          return NextResponse.json({ error: "unresolved maker" }, { status: 500 });
        }

        const { error } = await admin.rpc("apply_subscription_event", {
          p_maker_id: makerId,
          p_provider_subscription_id: sub.id,
          p_provider_customer_id: sub.customerId,
          p_plan: "pro", // only one paid tier exists - hardcoded, not derived from payload
          p_status: sub.status,
          p_current_period_start: sub.currentPeriodStart?.toISOString() ?? null,
          p_current_period_end: sub.currentPeriodEnd?.toISOString() ?? null,
          p_cancel_at_period_end: sub.cancelAtPeriodEnd,
        });
        if (error) throw error;
        break;
      }

      case "order.paid": {
        const order = event.data;
        let subscriptionRow: { id: string; maker_id: string } | null = null;
        if (order.subscriptionId) {
          const { data } = await admin
            .from("subscriptions")
            .select("id, maker_id")
            .eq("provider_subscription_id", order.subscriptionId)
            .maybeSingle();
          subscriptionRow = data;
          if (!subscriptionRow) {
            // Ordering race: order.paid arrived before subscription.created
            // for the same subscription's first payment (delivery order
            // across resource types isn't guaranteed). Fail loud so
            // Polar's own retry gives the other event time to land;
            // webhook_events.processed_at stays null either way, so this
            // is recoverable via replay even if retries are exhausted.
            console.error("polar webhook: no local subscription for order.paid", order.id);
            return NextResponse.json({ error: "subscription not found" }, { status: 500 });
          }
        }

        const makerId = subscriptionRow?.maker_id ?? order.customer?.externalId ?? undefined;
        if (!makerId) {
          console.error("polar webhook: could not resolve maker_id for order", order.id);
          return NextResponse.json({ error: "unresolved maker" }, { status: 500 });
        }

        // order.totalAmount (not order.amount - Order has no `amount`
        // field, only subtotal/discount/net/tax/total/applied/due/
        // refunded variants; totalAmount is the actual charge amount, in
        // the smallest currency unit already, per the SDK's z.int() schema).
        // Period fields taken from the nested OrderSubscription (order.
        // subscription.currentPeriodStart/End) when present - avoids a
        // second round-trip and sidesteps the ordering race for the
        // period values specifically, even when it can't be avoided for
        // resolving our own internal subscription row id above.
        const { error } = await admin.rpc("apply_order_paid", {
          p_maker_id: makerId,
          p_subscription_id: subscriptionRow?.id ?? null,
          p_provider_payment_id: order.id,
          p_amount_cents: order.totalAmount,
          p_currency: order.currency,
          p_webhook_event_id: eventRow.id,
          p_period_start: order.subscription?.currentPeriodStart?.toISOString() ?? null,
          p_period_end: order.subscription?.currentPeriodEnd?.toISOString() ?? null,
        });
        if (error) throw error;
        break;
      }

      case "order.created":
        // Deliberately no payments write - see migration comment. The
        // webhook_events row above is this event's entire audit trail.
        break;

      default:
        // customer.*, benefit.*, checkout.*, product.*, etc.: logged via
        // webhook_events only, no action taken this pass.
        break;
    }
  } catch (err) {
    console.error("polar webhook processing failed:", event.type, err);
    // webhook_events.processed_at stays null - recoverable via replay.
    // Returning 500 (not 200) so Polar's retry mechanism gets a chance to
    // self-heal transient failures; a retried delivery of the SAME
    // webhook-id still hits the 23505 duplicate branch above and
    // short-circuits without reprocessing.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  const { error: markProcessedError } = await admin
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", eventRow.id);
  if (markProcessedError) {
    // Doesn't affect correctness - apply_subscription_event/apply_order_paid
    // already succeeded and are independently idempotent via their own
    // unique-index guards, so a retried delivery can't double-apply
    // regardless. Only affects processed_at's accuracy as an audit marker.
    console.error("failed to mark webhook_events.processed_at:", providerEventId, markProcessedError.message);
  }

  return NextResponse.json({ ok: true });
}
