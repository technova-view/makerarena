import type { createClient } from "@/lib/supabase/server";

export type ProAccess = {
  active: boolean;
  expiresAt: string | null;
};

// The read path every Pro-gated feature should use - never a live join
// against subscriptions.status (see 0013_billing_foundation.sql's
// entitlements table comment). A maker's Pro access is whatever the most
// recent still-in-effect pro_access grant says, full stop.
export async function getProAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  makerId: string,
): Promise<ProAccess> {
  const nowIso = new Date().toISOString();

  const { data } = await supabase
    .from("entitlements")
    .select("expires_at")
    .eq("maker_id", makerId)
    .eq("type", "pro_access")
    .lte("effective_at", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("effective_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { active: Boolean(data), expiresAt: data?.expires_at ?? null };
}
