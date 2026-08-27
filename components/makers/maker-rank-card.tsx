import { Trophy } from "lucide-react";
import { DivisionBadge } from "@/components/products/division-badge";
import { Card } from "@/components/ui/card";
import type { DivisionTier } from "@/lib/types/database.types";

export interface MakerRankData {
  score: number;
  rankPosition: number | null;
  population: number | null;
  wins: number;
  battles: number;
  seasonWins: number;
  achievementsCount: number;
  productsCount: number;
  bestDivision: DivisionTier | null;
}

export function MakerRankCard({ rank }: { rank: MakerRankData | null }) {
  if (!rank) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Not yet ranked — publish a product and reach 10 battles to enter MakerRank.
      </Card>
    );
  }

  const winRate = rank.battles > 0 ? Math.round((rank.wins / rank.battles) * 100) : 0;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          <span className="font-semibold">
            {rank.rankPosition ? `MakerRank #${rank.rankPosition}` : "Unranked"}
            {rank.population ? ` of ${rank.population}` : ""}
          </span>
          <DivisionBadge division={rank.bestDivision} />
        </div>
        <span className="text-sm text-muted-foreground">Score {rank.score}</span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-center text-sm sm:grid-cols-5">
        <Stat label="Season wins" value={rank.seasonWins} />
        <Stat label="Battles" value={rank.battles} />
        <Stat label="Win rate" value={`${winRate}%`} />
        <Stat label="Products" value={rank.productsCount} />
        <Stat label="Achievements" value={rank.achievementsCount} />
      </dl>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
