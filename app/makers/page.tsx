import { createClient } from "@/lib/supabase/server";
import { MakerLeaderboardTable, type MakerLeaderboardRow } from "@/components/leaderboard/maker-leaderboard-table";

const LEADERBOARD_SIZE = 50;

export default async function MakersLeaderboardPage() {
  const supabase = await createClient();

  const { data: positions } = await supabase
    .rpc("maker_rank_positions")
    .order("rank_position", { ascending: true })
    .limit(LEADERBOARD_SIZE);

  const makerIds = (positions ?? []).map((p) => p.maker_id);

  let rows: MakerLeaderboardRow[] = [];

  if (makerIds.length > 0) {
    // Parallel query + merge by maker_id - maker_rank_positions() has no FK
    // metadata for PostgREST to embed (same reasoning product_divisions()
    // and every other RPC-backed page in this app already documents), so
    // display fields are fetched separately and joined here.
    const [{ data: makers }, { data: rankRows }, { data: products }, { data: divisions }] =
      await Promise.all([
        supabase.from("makers").select("id, username, display_name, avatar_url").in("id", makerIds),
        supabase
          .from("maker_ranks")
          .select("maker_id, wins, battles, season_wins, achievements_count")
          .in("maker_id", makerIds),
        supabase
          .from("products")
          .select("id, maker_id, rating")
          .eq("status", "published")
          .in("maker_id", makerIds)
          .order("rating", { ascending: false }),
        supabase.rpc("product_divisions"),
      ]);

    const divisionByProductId = new Map((divisions ?? []).map((d) => [d.product_id, d.division]));
    // products is already sorted by rating desc; the first hit per maker
    // with a division wins - same "best currently-ranked product" logic as
    // the profile page.
    const bestDivisionByMaker = new Map<string, string | null>();
    for (const p of products ?? []) {
      if (bestDivisionByMaker.has(p.maker_id)) continue;
      const division = divisionByProductId.get(p.id);
      if (division) bestDivisionByMaker.set(p.maker_id, division);
    }

    const makerById = new Map((makers ?? []).map((m) => [m.id, m]));
    const rankById = new Map((rankRows ?? []).map((r) => [r.maker_id, r]));

    rows = (positions ?? []).flatMap((pos) => {
      const maker = makerById.get(pos.maker_id);
      const rank = rankById.get(pos.maker_id);
      if (!maker || !rank) return [];
      return [
        {
          username: maker.username,
          displayName: maker.display_name,
          avatarUrl: maker.avatar_url,
          rankPosition: pos.rank_position,
          score: pos.score,
          division: (bestDivisionByMaker.get(pos.maker_id) ?? null) as MakerLeaderboardRow["division"],
          seasonWins: rank.season_wins,
          battles: rank.battles,
          winRate: rank.battles > 0 ? Math.round((rank.wins / rank.battles) * 100) : 0,
          achievementsCount: rank.achievements_count,
        },
      ];
    });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">🏆 Top Makers</h1>
      <MakerLeaderboardTable rows={rows} />
    </div>
  );
}
