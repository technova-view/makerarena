import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Eye, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { ViewTracker } from "@/components/products/view-tracker";
import { BattleHistory } from "@/components/battles/battle-history";
import { ShareResultActions } from "@/components/ui/share-button";
import { DivisionBadge } from "@/components/products/division-badge";
import { AchievementBadge } from "@/components/makers/achievement-badge";
import { CATEGORIES } from "@/lib/utils/constants";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  // No status filter here - "published products are public" RLS already
  // restricts non-owners to published rows, while letting the owner load
  // their own draft/archived product (e.g. after archiving it from their
  // profile - see app/makers/[username]/page.tsx, which is where the
  // archive control itself lives).
  const { data: product } = await supabase
    .from("products")
    .select(
      "id, name, tagline, description, website_url, logo_url, screenshots, rating, views, battles_count, category_slug, makers(username, display_name, avatar_url)",
    )
    .eq("slug", slug)
    .single();

  if (!product) notFound();

  // product_divisions() has no FK metadata for PostgREST to embed and
  // always computes over the whole eligible population, so it's fetched
  // separately and looked up by id here rather than nested in the select
  // above.
  const { data: divisionRow } = await supabase
    .rpc("product_divisions")
    .eq("product_id", product.id)
    .maybeSingle();

  // Product-scoped unlocks only (rating milestones) - maker-scoped
  // achievements (wins/streaks/products) belong on the maker's profile, not
  // repeated on every one of their products.
  const { data: achievementRows } = await supabase
    .from("maker_achievements")
    .select("id, achievement_code, unlocked_at, achievements(name, description, icon)")
    .eq("product_id", product.id)
    .order("unlocked_at", { ascending: false });

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

  const maker = Array.isArray(product.makers) ? product.makers[0] : product.makers;
  const categoryName = CATEGORIES.find((c) => c.slug === product.category_slug)?.name ?? product.category_slug;

  const { count: higherRated } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("category_slug", product.category_slug)
    .eq("status", "published")
    .gt("rating", product.rating);
  const rank = higherRated === null ? null : higherRated + 1;

  const shareText = `🏆 ${product.name} is currently ${rank ? `#${rank} in ${categoryName}` : `on MakerArena`} with a ${product.rating} rating`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <ViewTracker productId={product.id} />

      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
          {product.logo_url ? (
            <Image
              src={product.logo_url}
              alt={product.name}
              width={64}
              height={64}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-2xl font-semibold text-muted-foreground">
              {product.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{product.name}</h1>
          {product.tagline && <p className="text-muted-foreground">{product.tagline}</p>}
          {maker && (
            <Link
              href={`/makers/${maker.username}`}
              className="mt-1 inline-block text-sm text-muted-foreground hover:text-foreground"
            >
              by @{maker.username}
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {divisionRow?.division ? (
          <DivisionBadge
            division={divisionRow.division}
            rankPosition={divisionRow.rank_position}
            population={divisionRow.population}
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            Unranked —{" "}
            {product.battles_count < 10
              ? `${10 - product.battles_count} more battle${10 - product.battles_count === 1 ? "" : "s"} to qualify`
              : "not enough ranked products yet"}
          </span>
        )}
        <Badge variant="outline">
          <Trophy className="h-3.5 w-3.5" />
          {product.rating} rating
        </Badge>
        {rank && (
          <Badge variant="outline">#{rank} in {categoryName}</Badge>
        )}
        <Badge variant="outline">
          <Eye className="h-3.5 w-3.5" />
          {product.views.toLocaleString()} views
        </Badge>
        <a
          href={product.website_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Visit website
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <ShareResultActions text={shareText} path={`/products/${slug}`} className="justify-start" />
      </div>

      {achievements.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {achievements.map((achievement) => (
            <AchievementBadge key={achievement.id} achievement={achievement} />
          ))}
        </div>
      )}

      <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed">{product.description}</p>

      {product.screenshots.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {product.screenshots.map((url) => (
            <div key={url} className="relative aspect-video overflow-hidden rounded-lg border border-border">
              <Image
                src={url}
                alt={`${product.name} screenshot`}
                fill
                className="object-cover"
                sizes="(min-width: 640px) 50vw, 100vw"
              />
            </div>
          ))}
        </div>
      )}

      <BattleHistory productId={product.id} />
    </div>
  );
}
