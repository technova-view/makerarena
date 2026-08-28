"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createPolarClient } from "@/lib/polar/client";

export type BillingActionState = { error: string | null };

// Maker <-> Polar customer mapping happens here, not via a separate table:
// externalCustomerId ties the checkout (and everything downstream - the
// resulting customer, subscription, orders) to makers.id, which the webhook
// route (app/api/webhooks/polar/route.ts) reads back out as
// `sub.customer?.externalId` / `order.customer?.externalId` to resolve
// which maker a subscription.* / order.paid event belongs to. makers.id IS
// auth.users.id (see 0001_init_schema.sql), so user.id here is already the
// right value - no lookup needed.
export async function startProCheckout(
  _prevState: BillingActionState,
  _formData: FormData,
): Promise<BillingActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to upgrade." };
  }

  const productId = process.env.POLAR_PRO_PRODUCT_ID;
  if (!productId) {
    return { error: "Billing isn't configured yet." };
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  let checkoutUrl: string;
  try {
    const checkout = await createPolarClient().checkouts.create({
      products: [productId],
      externalCustomerId: user.id,
      customerEmail: user.email,
      successUrl: `${siteUrl}/settings/billing?checkout_id={CHECKOUT_ID}`,
    });
    checkoutUrl = checkout.url;
  } catch (err) {
    console.error("polar checkout creation failed:", err);
    return { error: "Could not start checkout. Please try again." };
  }

  redirect(checkoutUrl);
}
