import Link from "next/link";
import { CATEGORIES } from "@/lib/utils/constants";
import { ProductForm } from "@/components/products/product-form";
import { createClient } from "@/lib/supabase/server";
import { getProductSlotLimit } from "@/lib/entitlements";

export default async function NewProductPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Anonymous visitors still see the form (createProduct itself rejects them
  // on submit with a clear "sign in" message) - slot usage only applies once
  // there's a maker_id to count against, so it's skipped here rather than
  // showing a meaningless 0/1.
  let slotStatus: { used: number; limit: number } | null = null;
  if (user) {
    const [{ count }, limit] = await Promise.all([
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("maker_id", user.id)
        .in("status", ["draft", "published"]),
      getProductSlotLimit(supabase, user.id),
    ]);
    slotStatus = { used: count ?? 0, limit };
  }

  let makerUsername: string | null = null;
  if (user && slotStatus && slotStatus.used >= slotStatus.limit) {
    const { data: maker } = await supabase.from("makers").select("username").eq("id", user.id).single();
    makerUsername = maker?.username ?? null;
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">Publish your product</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Enter the arena and see how it performs.
      </p>

      {slotStatus && slotStatus.used >= slotStatus.limit ? (
        <div className="rounded-xl border border-border p-6">
          <p className="font-medium">
            You&apos;ve used all {slotStatus.limit} of your product slots ({slotStatus.used}/{slotStatus.limit}).
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Archive an existing product to free up a slot, or upgrade to Pro for more.
          </p>
          <div className="mt-4 flex gap-3">
            {makerUsername && (
              <Link
                href={`/makers/${makerUsername}`}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-muted px-4 text-sm font-medium hover:bg-border"
              >
                Manage your products
              </Link>
            )}
            <Link
              href="/pricing"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Upgrade to Pro
            </Link>
          </div>
        </div>
      ) : (
        <>
          {slotStatus && (
            <p className="mb-4 text-sm text-muted-foreground">
              {slotStatus.used} of {slotStatus.limit} product slots used.
            </p>
          )}
          <ProductForm categories={CATEGORIES.map((c) => ({ slug: c.slug, name: c.name }))} />
        </>
      )}
    </div>
  );
}
