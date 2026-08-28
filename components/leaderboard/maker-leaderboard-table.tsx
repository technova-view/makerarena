import Image from "next/image";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { DivisionBadge } from "@/components/products/division-badge";
import type { DivisionTier } from "@/lib/types/database.types";

export interface MakerLeaderboardRow {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  rankPosition: number;
  score: number;
  division: DivisionTier | null;
  seasonWins: number;
  battles: number;
  winRate: number;
  achievementsCount: number;
}

export function MakerLeaderboardTable({ rows }: { rows: MakerLeaderboardRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No makers ranked yet — publish a product and win 10 battles to appear here.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="w-12 px-4 py-3">#</th>
            <th className="px-4 py-3">Maker</th>
            <th className="px-4 py-3">Division</th>
            <th className="px-4 py-3 text-right">Score</th>
            <th className="px-4 py-3 text-right">Win rate</th>
            <th className="px-4 py-3 text-right">Season wins</th>
            <th className="px-4 py-3 text-right">Achievements</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.username} className="border-t border-border">
              <td className="px-4 py-3 font-medium text-muted-foreground">{row.rankPosition}</td>
              <td className="px-4 py-3">
                <Link href={`/makers/${row.username}`} className="flex min-w-0 items-center gap-2 font-medium hover:text-primary">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                    {row.avatarUrl ? (
                      <Image src={row.avatarUrl} alt={row.displayName} width={32} height={32} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs font-semibold text-muted-foreground">
                        {row.displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 max-w-40 truncate sm:max-w-xs">
                    {row.displayName}{" "}
                    <span className="font-normal text-muted-foreground">@{row.username}</span>
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3">
                <DivisionBadge division={row.division} />
              </td>
              <td className="px-4 py-3 text-right">
                <span className="inline-flex items-center gap-1 font-medium">
                  <Trophy className="h-3.5 w-3.5 text-primary" />
                  {row.score}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">{row.winRate}%</td>
              <td className="px-4 py-3 text-right text-muted-foreground">{row.seasonWins}</td>
              <td className="px-4 py-3 text-right text-muted-foreground">{row.achievementsCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
