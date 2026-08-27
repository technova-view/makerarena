import Link from "next/link";
import { Trophy } from "lucide-react";
import { DivisionBadge } from "@/components/products/division-badge";
import type { DivisionTier } from "@/lib/types/database.types";

export interface LeaderboardRow {
  slug: string;
  name: string;
  rating: number;
  views: number;
  maker_username: string | null;
  division?: DivisionTier | null;
}

export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No products ranked here yet — be the first to publish one.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="w-12 px-4 py-3">#</th>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Maker</th>
            <th className="px-4 py-3">Division</th>
            <th className="px-4 py-3 text-right">Rating</th>
            <th className="px-4 py-3 text-right">Views</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.slug} className="border-t border-border">
              <td className="px-4 py-3 font-medium text-muted-foreground">{index + 1}</td>
              <td className="px-4 py-3">
                <Link href={`/products/${row.slug}`} className="font-medium hover:text-primary">
                  {row.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.maker_username ? (
                  <Link href={`/makers/${row.maker_username}`} className="hover:text-foreground">
                    @{row.maker_username}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3">
                <DivisionBadge division={row.division} />
              </td>
              <td className="px-4 py-3 text-right">
                <span className="inline-flex items-center gap-1 font-medium">
                  <Trophy className="h-3.5 w-3.5 text-primary" />
                  {row.rating}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">
                {row.views.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
