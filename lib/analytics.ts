import type { createClient } from "@/lib/supabase/server";

// Phase 3E v1 - Pro product analytics. Strictly read-only and strictly
// downstream: everything here is derived from votes/season_results, which
// are already fully public tables (see 0007/0008's "publicly readable"
// policies) - being Pro doesn't unlock hidden data, it unlocks the
// aggregated trend view nothing free exposes today. Nothing in this file
// writes to rating/all_time_rating/divisions/achievements/maker_ranks, and
// nothing here should ever be extended to do so.
//
// Deliberately NOT covered (see TECH_DEBT.md's Phase 3E note): division
// history and MakerRank history can't be reconstructed from current state -
// divisions are a live percentile cut against the whole population, and
// maker_ranks has no snapshot table - so neither is exposed here, even
// approximately. Product/profile view *trends* likewise don't exist
// (products.views is a single lifetime counter, no timestamps).

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface VoteRow {
  created_at: string;
  winner_product_id: string;
  loser_product_id: string;
  winner_rating_before: number;
  winner_rating_after: number;
  loser_rating_before: number;
  loser_rating_after: number;
}

export interface RatingPoint {
  at: string;
  rating: number;
}

export interface BattleVolumePoint {
  weekStart: string;
  battles: number;
  wins: number;
  losses: number;
}

export interface ProductAnalytics {
  totalBattles: number;
  wins: number;
  losses: number;
  winRate: number | null; // null = "N/A", not 0 - see battle-history's own precedent
  ratingHistory: RatingPoint[];
  battleVolume: BattleVolumePoint[];
  ratingDelta: {
    total: number;
    average: number | null;
    largestGain: number | null;
    largestLoss: number | null; // negative (or null if no losses ever happened)
  };
  competitive: {
    averageOpponentRating: number | null;
    winsAgainstHigherRated: number;
    battlesAgainstHigherRated: number;
    higherRatedWinRate: number | null;
    currentStreak: { type: "win" | "loss"; count: number } | null;
    longestWinStreak: number;
  };
}

// Monday-aligned week bucket key (UTC) - simple, deterministic, no timezone
// dependency on the reader's locale. Good enough for a "battles per week"
// bar - v1 doesn't offer a granularity switch (day/month), matching the
// "don't cram every metric in" scoping call.
function weekStartKey(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday));
  return monday.toISOString().slice(0, 10);
}

export async function getProductAnalytics(
  supabase: Supabase,
  productId: string,
): Promise<ProductAnalytics> {
  const { data } = await supabase
    .from("votes")
    .select(
      "created_at, winner_product_id, loser_product_id, winner_rating_before, winner_rating_after, loser_rating_before, loser_rating_after",
    )
    .or(`winner_product_id.eq.${productId},loser_product_id.eq.${productId}`)
    .order("created_at", { ascending: true });

  const votes = (data ?? []) as VoteRow[];

  const ratingHistory: RatingPoint[] = [];
  const battleVolumeByWeek = new Map<string, { battles: number; wins: number; losses: number }>();
  const deltas: number[] = [];
  const opponentRatingsBefore: number[] = [];
  let wins = 0;
  let losses = 0;
  let winsAgainstHigherRated = 0;
  let battlesAgainstHigherRated = 0;
  let currentStreakType: "win" | "loss" | null = null;
  let currentStreakCount = 0;
  let longestWinStreak = 0;

  for (const v of votes) {
    const won = v.winner_product_id === productId;
    const ratingAfter = won ? v.winner_rating_after : v.loser_rating_after;
    const ownRatingBefore = won ? v.winner_rating_before : v.loser_rating_before;
    const ownRatingAfter = ratingAfter;
    const opponentRatingBefore = won ? v.loser_rating_before : v.winner_rating_before;

    ratingHistory.push({ at: v.created_at, rating: ratingAfter });
    deltas.push(ownRatingAfter - ownRatingBefore);
    opponentRatingsBefore.push(opponentRatingBefore);

    const week = weekStartKey(v.created_at);
    const bucket = battleVolumeByWeek.get(week) ?? { battles: 0, wins: 0, losses: 0 };
    bucket.battles += 1;
    if (won) {
      bucket.wins += 1;
      wins += 1;
    } else {
      bucket.losses += 1;
      losses += 1;
    }
    battleVolumeByWeek.set(week, bucket);

    if (opponentRatingBefore > ownRatingBefore) {
      battlesAgainstHigherRated += 1;
      if (won) winsAgainstHigherRated += 1;
    }

    if (currentStreakType === (won ? "win" : "loss")) {
      currentStreakCount += 1;
    } else {
      currentStreakType = won ? "win" : "loss";
      currentStreakCount = 1;
    }
    if (currentStreakType === "win") longestWinStreak = Math.max(longestWinStreak, currentStreakCount);
  }

  const totalBattles = votes.length;
  const totalDelta = deltas.reduce((sum, d) => sum + d, 0);
  const gains = deltas.filter((d) => d > 0);
  const lossDeltas = deltas.filter((d) => d < 0);

  return {
    totalBattles,
    wins,
    losses,
    winRate: totalBattles > 0 ? (wins / totalBattles) * 100 : null,
    ratingHistory,
    battleVolume: Array.from(battleVolumeByWeek.entries())
      .map(([weekStart, v]) => ({ weekStart, ...v }))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    ratingDelta: {
      total: totalDelta,
      average: totalBattles > 0 ? totalDelta / totalBattles : null,
      largestGain: gains.length > 0 ? Math.max(...gains) : null,
      largestLoss: lossDeltas.length > 0 ? Math.min(...lossDeltas) : null,
    },
    competitive: {
      averageOpponentRating:
        opponentRatingsBefore.length > 0
          ? opponentRatingsBefore.reduce((s, r) => s + r, 0) / opponentRatingsBefore.length
          : null,
      winsAgainstHigherRated,
      battlesAgainstHigherRated,
      higherRatedWinRate:
        battlesAgainstHigherRated > 0 ? (winsAgainstHigherRated / battlesAgainstHigherRated) * 100 : null,
      currentStreak: currentStreakType ? { type: currentStreakType, count: currentStreakCount } : null,
      longestWinStreak,
    },
  };
}

export interface SeasonHistoryRow {
  seasonNumber: number;
  label: string;
  overallRank: number;
  categoryRank: number;
}

// Deliberately does NOT show a division for any past season - see this
// file's header comment. Only what season_results actually stored at the
// time (rank, not division) is ever displayed as historical fact.
export async function getSeasonHistory(
  supabase: Supabase,
  productId: string,
): Promise<SeasonHistoryRow[]> {
  const { data } = await supabase
    .from("season_results")
    .select("overall_rank, category_rank, seasons(season_number, label)")
    .eq("product_id", productId)
    .order("seasons(season_number)", { ascending: false });

  return (data ?? []).flatMap((row) => {
    const season = Array.isArray(row.seasons) ? row.seasons[0] : row.seasons;
    if (!season) return [];
    return [
      {
        seasonNumber: season.season_number,
        label: season.label,
        overallRank: row.overall_rank,
        categoryRank: row.category_rank,
      },
    ];
  });
}
