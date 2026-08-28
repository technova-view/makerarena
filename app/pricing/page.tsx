import Link from "next/link";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProAccess } from "@/lib/entitlements";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const FREE_FEATURES = [
  "Publish unlimited products",
  "Compete in the Arena",
  "Public maker profile & MakerRank",
  "Seasons, divisions & achievements",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Advanced product analytics",
  "Profile customization",
  "1 Featured credit every month",
];

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pro = user ? await getProAccess(supabase, user.id) : { active: false, expiresAt: null };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-10 text-center">
        <h1 className="text-2xl font-bold">Pricing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pro never affects your rating, division, achievements, or MakerRank score — it only
          unlocks visibility and analytics features.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-lg font-semibold">Free</h2>
            <p className="mt-1 text-3xl font-bold">
              $0<span className="text-base font-normal text-muted-foreground">/mo</span>
            </p>
          </div>
          <ul className="flex flex-1 flex-col gap-2 text-sm">
            {FREE_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                {feature}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-4 border-primary p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Pro</h2>
            {pro.active && <Badge variant="primary">Current plan</Badge>}
          </div>
          <p className="text-3xl font-bold">
            $12<span className="text-base font-normal text-muted-foreground">/mo</span>
          </p>
          <ul className="flex flex-1 flex-col gap-2 text-sm">
            {PRO_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {feature}
              </li>
            ))}
          </ul>

          {pro.active ? (
            <Link
              href="/settings/billing"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-muted px-4 text-sm font-medium hover:bg-border"
            >
              Manage billing
            </Link>
          ) : user ? (
            <UpgradeButton />
          ) : (
            <Link
              href="/login?next=/settings/billing"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Sign in to upgrade
            </Link>
          )}
        </Card>
      </div>
    </div>
  );
}
