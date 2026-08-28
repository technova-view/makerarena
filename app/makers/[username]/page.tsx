import Image from "next/image";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductGrid } from "@/components/products/product-grid";
import { AchievementBadge } from "@/components/makers/achievement-badge";
import { MakerRankCard } from "@/components/makers/maker-rank-card";

export default async function MakerProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createClient();

  const { data: maker } = await supabase
    .from("makers")
    .select("id, username, display_name, avatar_url, bio, website_url")
    .eq("username", username)
    .single();

  if (!maker) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwnProfile = user?.id === maker.id;

  let productsQuery = supabase
    .from("products")
    .select("id, slug, name, tagline, logo_url, rating, views, category_slug")
    .eq("maker_id", maker.id)
    .order("rating", { ascending: false });

  if (!isOwnProfile) {
    productsQuery = productsQuery.eq("status", "published");
  }

  const { data: products } = await productsQuery;

  // maker_achievements has real FK metadata to achievements, unlike
  // product_divisions()'s RPC-only situation, so a nested select embeds it
  // directly instead of a parallel-query merge. Includes both maker-scoped
  // (wins/streaks/products) and product-scoped (rating milestone) unlocks -
  // this maker earned all of them regardless of which product triggered it.
  const { data: achievementRows } = await supabase
    .from("maker_achievements")
    .select("id, achievement_code, unlocked_at, achievements(name, description, icon)")
    .eq("maker_id", maker.id)
    .order("unlocked_at", { ascending: false });

  // Two different products of the same maker can independently earn the
  // same product-scoped code (e.g. rating_1600 twice) - id is this row's
  // real primary key, so it's the only safe React key here, not code alone.
  const achievements = (achievementRows ?? []).flatMap((row) => {
    const meta = Array.isArray(row.achievements) ? row.achievements[0] : row.achievements;
    if (!meta) return [];
    return [
      {
        id: row.id,
        code: row.achievement_code,
        name: meta.name,
        description: meta.description,
        icon: meta.icon,
        unlockedAt: row.unlocked_at,
      },
    ];
  });

  // Parallel query + merge by id, same pattern as the homepage/category
  // pages. A draft product (visible here only to its own maker) correctly
  // gets no division for free, via product_divisions()'s own
  // status='published' predicate - no special-casing needed.
  const { data: divisions } = await supabase.rpc("product_divisions");
  const divisionByProductId = new Map((divisions ?? []).map((d) => [d.product_id, d.division]));
  const productsWithDivision = (products ?? []).map((p) => ({
    ...p,
    division: divisionByProductId.get(p.id) ?? null,
  }));

  // MakerRank: no row at all means this maker is UNRANKED (below the
  // battles>=10 eligibility bar on every one of their products) - not a
  // placeholder score. maker_rank_positions() has no FK metadata for
  // PostgREST to embed and always computes over the whole ranked
  // population, so it's fetched separately and filtered with .eq(),
  // mirroring product_divisions()'s pattern on the product page.
  const { data: rankRow } = await supabase
    .from("maker_ranks")
    .select("score, wins, battles, season_wins, achievements_count")
    .eq("maker_id", maker.id)
    .maybeSingle();

  const { data: positionRow } = await supabase
    .rpc("maker_rank_positions")
    .eq("maker_id", maker.id)
    .maybeSingle();

  // "Diamond badge = maker's best product's current division" - reuses
  // product_divisions() as-is, no new maker-level tier system. products is
  // already ordered rating desc above, so the first entry with a division
  // is the best currently-ranked one; drafts (no division) are skipped for
  // free since divisionByProductId has no entry for them.
  const bestDivision = productsWithDivision.find((p) => p.division)?.division ?? null;

  const rank = rankRow
    ? {
        score: rankRow.score,
        rankPosition: positionRow?.rank_position ?? null,
        population: positionRow?.population ?? null,
        wins: rankRow.wins,
        battles: rankRow.battles,
        seasonWins: rankRow.season_wins,
        achievementsCount: rankRow.achievements_count,
        productsCount: products?.length ?? 0,
        bestDivision,
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
          {maker.avatar_url ? (
            <Image
              src={maker.avatar_url}
              alt={maker.display_name}
              width={64}
              height={64}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-2xl font-semibold text-muted-foreground">
              {maker.display_name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{maker.display_name}</h1>
          <p className="truncate text-muted-foreground">@{maker.username}</p>
        </div>
      </div>

      {maker.bio && <p className="mt-4 text-sm leading-relaxed">{maker.bio}</p>}
      {maker.website_url && (
        <a
          href={maker.website_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm text-primary hover:underline"
        >
          {maker.website_url}
        </a>
      )}

      <div className="mt-4">
        <MakerRankCard rank={rank} />
      </div>

      {achievements.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {achievements.map((achievement) => (
            <AchievementBadge key={achievement.id} achievement={achievement} />
          ))}
        </div>
      )}

      <h2 className="mb-4 mt-8 text-lg font-semibold">Products</h2>
      <ProductGrid products={productsWithDivision} />
    </div>
  );
}
