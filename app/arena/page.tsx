import { Swords } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES } from "@/lib/utils/constants";
import { CategoryFilter } from "@/components/leaderboard/category-filter";
import { BattleArena } from "@/components/battles/battle-arena";

export default async function ArenaPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: pairing, error } = await supabase.rpc("get_random_pairing", {
    p_viewer_id: user?.id ?? null,
    p_category_slug: category ?? null,
  });

  const [productA, productB] = pairing ?? [];

  const { data: season } = await supabase
    .from("seasons")
    .select("label, ends_at")
    .eq("status", "active")
    .maybeSingle();

  const daysLeft = season
    ? Math.max(0, Math.ceil((new Date(season.ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 text-center">
        <h1 className="flex items-center justify-center gap-2 text-2xl font-bold">
          <Swords className="h-6 w-6 text-primary" />
          Arena
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Which product would you choose?</p>
        {season && (
          <p className="mt-1 text-xs text-muted-foreground">
            {season.label} · {daysLeft} day{daysLeft === 1 ? "" : "s"} left
          </p>
        )}
      </div>

      <div className="mb-6">
        <CategoryFilter
          categories={CATEGORIES}
          activeSlug={category}
          getHref={(slug) => (slug ? `/arena?category=${slug}` : "/arena")}
        />
      </div>

      {!error && productA && productB ? (
        <BattleArena
          // Defensive: if this pairing's props ever change under an
          // already-mounted instance (e.g. a future revalidation), keying
          // by the pairing forces React to remount with fresh local state
          // instead of showing a stale vote reveal against new cards.
          key={`${productA.id}-${productB.id}`}
          productA={productA}
          productB={productB}
          isAuthenticated={Boolean(user)}
          category={category}
        />
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Not enough published products {category ? "in this category " : ""}yet to battle -
          check back soon, or publish one yourself.
        </p>
      )}
    </div>
  );
}
