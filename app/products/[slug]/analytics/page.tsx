import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProAccess } from "@/lib/entitlements";
import { getProductAnalytics, getSeasonHistory } from "@/lib/analytics";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/analytics/stat-tile";
import { RatingHistoryChart } from "@/components/analytics/rating-history-chart";
import { BattleVolumeChart } from "@/components/analytics/battle-volume-chart";

export default async function ProductAnalyticsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=/products/${slug}/analytics`);

  const { data: product } = await supabase
    .from("products")
    .select("id, name, slug, rating, maker_id")
    .eq("slug", slug)
    .single();

  if (!product) notFound();
  // Analytics are private to the owner - unlike the product page itself,
  // this isn't public data made aggregate-visible, it's a maker's own
  // dashboard. Anyone else (including another signed-in maker) is bounced
  // to the public product page rather than seeing someone else's numbers.
  if (product.maker_id !== user.id) redirect(`/products/${slug}`);

  const pro = await getProAccess(supabase, user.id);
  if (!pro.active) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <h1 className="mb-1 text-2xl font-bold">{product.name} — Analytics</h1>
        <Card className="mt-6 p-6">
          <p className="font-medium">Analytics is a Pro feature.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Upgrade to Pro to see rating trends, battle activity, and competitive performance for
            this product.
          </p>
          <Link
            href="/pricing"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Upgrade to Pro
          </Link>
        </Card>
      </div>
    );
  }

  const [analytics, seasonHistory] = await Promise.all([
    getProductAnalytics(supabase, product.id),
    getSeasonHistory(supabase, product.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{product.name} — Analytics</h1>
          <Link href={`/products/${slug}`} className="text-sm text-muted-foreground hover:text-foreground">
            View product page
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Current rating" value={product.rating.toLocaleString()} />
        <StatTile label="Battles" value={analytics.totalBattles.toLocaleString()} />
        <StatTile
          label="Win rate"
          value={analytics.winRate === null ? "N/A" : `${Math.round(analytics.winRate)}%`}
        />
        <StatTile
          label="Rating change"
          value={analytics.ratingDelta.total >= 0 ? `+${analytics.ratingDelta.total}` : `${analytics.ratingDelta.total}`}
        />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Rating history</h2>
        <Card className="p-4">
          <RatingHistoryChart points={analytics.ratingHistory} />
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Battle activity</h2>
        <Card className="p-4">
          <BattleVolumeChart points={analytics.battleVolume} />
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Competitive performance</h2>
        <Card className="divide-y divide-border p-0">
          <Row
            label="Average opponent rating"
            value={
              analytics.competitive.averageOpponentRating === null
                ? "N/A"
                : Math.round(analytics.competitive.averageOpponentRating).toLocaleString()
            }
          />
          <Row
            label="Wins against higher-rated opponents"
            value={`${analytics.competitive.winsAgainstHigherRated} / ${analytics.competitive.battlesAgainstHigherRated}`}
          />
          <Row
            label="Higher-rated win rate"
            value={
              analytics.competitive.higherRatedWinRate === null
                ? "N/A"
                : `${Math.round(analytics.competitive.higherRatedWinRate)}%`
            }
          />
          <Row
            label="Current streak"
            value={
              analytics.competitive.currentStreak
                ? `${analytics.competitive.currentStreak.count} ${analytics.competitive.currentStreak.type === "win" ? "win" : "loss"}${analytics.competitive.currentStreak.count === 1 ? "" : "s"}`
                : "N/A"
            }
          />
          <Row label="Longest win streak" value={analytics.competitive.longestWinStreak.toLocaleString()} />
          <Row
            label="Average rating change per battle"
            value={
              analytics.ratingDelta.average === null
                ? "N/A"
                : `${analytics.ratingDelta.average >= 0 ? "+" : ""}${analytics.ratingDelta.average.toFixed(1)}`
            }
          />
          <Row
            label="Largest single-battle gain"
            value={analytics.ratingDelta.largestGain === null ? "N/A" : `+${analytics.ratingDelta.largestGain}`}
          />
          <Row
            label="Largest single-battle loss"
            value={analytics.ratingDelta.largestLoss === null ? "N/A" : `${analytics.ratingDelta.largestLoss}`}
          />
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Season history</h2>
        {seasonHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No completed seasons yet for this product.
          </p>
        ) : (
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Season</th>
                  <th className="px-4 py-2 font-medium">Overall rank</th>
                  <th className="px-4 py-2 font-medium">Category rank</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {seasonHistory.map((row) => (
                  <tr key={row.seasonNumber}>
                    <td className="px-4 py-2">{row.label}</td>
                    <td className="px-4 py-2">#{row.overallRank}</td>
                    <td className="px-4 py-2">#{row.categoryRank}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
