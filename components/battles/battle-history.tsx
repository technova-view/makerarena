import Link from "next/link";
import { Swords, Trophy, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";

interface BattleRow {
  opponentName: string;
  opponentSlug: string;
  won: boolean;
  ratingDelta: number;
  createdAt: string;
}

export async function BattleHistory({ productId }: { productId: string }) {
  const supabase = await createClient();

  const [{ count: wins }, { count: losses }, { data: won }, { data: lost }] = await Promise.all([
    supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("winner_product_id", productId),
    supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("loser_product_id", productId),
    supabase
      .from("votes")
      .select("created_at, winner_rating_after, winner_rating_before, loser:products!votes_loser_product_id_fkey(name, slug)")
      .eq("winner_product_id", productId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("votes")
      .select("created_at, loser_rating_after, loser_rating_before, winner:products!votes_winner_product_id_fkey(name, slug)")
      .eq("loser_product_id", productId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const rows: BattleRow[] = [
    ...(won ?? []).map((v) => {
      const opponent = Array.isArray(v.loser) ? v.loser[0] : v.loser;
      return {
        opponentName: opponent?.name ?? "Unknown",
        opponentSlug: opponent?.slug ?? "",
        won: true,
        ratingDelta: v.winner_rating_after - v.winner_rating_before,
        createdAt: v.created_at,
      };
    }),
    ...(lost ?? []).map((v) => {
      const opponent = Array.isArray(v.winner) ? v.winner[0] : v.winner;
      return {
        opponentName: opponent?.name ?? "Unknown",
        opponentSlug: opponent?.slug ?? "",
        won: false,
        ratingDelta: v.loser_rating_after - v.loser_rating_before,
        createdAt: v.created_at,
      };
    }),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  const totalBattles = (wins ?? 0) + (losses ?? 0);
  const winRate = totalBattles > 0 ? Math.round(((wins ?? 0) / totalBattles) * 100) : null;

  return (
    <div className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <Swords className="h-4 w-4 text-primary" />
        Battles
      </h2>

      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <Badge variant="outline">{totalBattles} battle{totalBattles === 1 ? "" : "s"}</Badge>
        {winRate !== null && <Badge variant="outline">{winRate}% win rate</Badge>}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No battles yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                {row.won ? (
                  <Trophy className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span>
                  {row.won ? "Beat" : "Lost to"}{" "}
                  {row.opponentSlug ? (
                    <Link href={`/products/${row.opponentSlug}`} className="font-medium hover:text-primary">
                      {row.opponentName}
                    </Link>
                  ) : (
                    <span className="font-medium">{row.opponentName}</span>
                  )}
                </span>
              </div>
              <span className={row.ratingDelta >= 0 ? "text-primary" : "text-muted-foreground"}>
                {row.ratingDelta >= 0 ? "+" : ""}
                {row.ratingDelta}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
