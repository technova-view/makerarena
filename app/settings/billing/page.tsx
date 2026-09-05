import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProAccess } from "@/lib/entitlements";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { Badge } from "@/components/ui/badge";

export default async function BillingSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/settings/billing");

  // Reads the entitlements snapshot, never subscriptions.status directly -
  // see lib/entitlements.ts. If a checkout just completed, the Polar
  // webhook may not have landed yet, so this can correctly still say "Free"
  // for a few seconds after a successful payment - that's the stored state
  // at read time, not an assumption about what the checkout redirect implies.
  const pro = await getProAccess(supabase, user.id);

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">Billing</h1>
      <p className="mb-6 text-sm text-muted-foreground">Manage your MakerArena plan.</p>

      <div className="rounded-xl border border-border p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold">{pro.active ? "Pro" : "Free"}</p>
              {pro.active && <Badge variant="primary">Active</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {pro.active
                ? `Renews ${pro.expiresAt ? new Date(pro.expiresAt).toLocaleDateString() : "automatically"}`
                : "$12/month — up to 3 published products, advanced analytics, and profile customization"}
            </p>
          </div>
          {!pro.active && <UpgradeButton />}
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Pro never affects your rating, division, achievements, or MakerRank score — it only unlocks
        visibility and analytics features.
      </p>
    </div>
  );
}
