"use client";

import { useActionState } from "react";
import { startProCheckout, type BillingActionState } from "@/lib/actions/billing";
import { Button } from "@/components/ui/button";

const initialState: BillingActionState = { error: null };

export function UpgradeButton() {
  const [state, formAction, pending] = useActionState(startProCheckout, initialState);

  return (
    <form action={formAction}>
      <Button type="submit" disabled={pending}>
        {pending ? "Redirecting…" : "Upgrade to Pro — $12/mo"}
      </Button>
      {state.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
