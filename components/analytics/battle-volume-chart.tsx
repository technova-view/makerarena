"use client";

import { useMemo, useState } from "react";
import type { BattleVolumePoint } from "@/lib/analytics";

const HEIGHT = 160;
const BAR_MAX_WIDTH = 24; // mark spec: bars <= 24px thick
const GAP = 2; // surface gap between stacked segments and between bars

// Two series (wins/losses) - per the dataviz skill this always gets a
// legend, matching the exact win=primary / loss=muted-foreground colors
// battle-history.tsx already established for this same distinction
// elsewhere in the app (a Trophy in text-primary for a win, an X in
// text-muted-foreground for a loss) - reused here rather than inventing a
// second color pair for the same concept.
export function BattleVolumeChart({ points }: { points: BattleVolumePoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const maxBattles = useMemo(() => Math.max(1, ...points.map((p) => p.battles)), [points]);

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No battles yet - weekly activity will appear here once this product has fought.</p>;
  }

  const innerHeight = HEIGHT - 24; // leave room for the baseline/axis label
  const barWidth = Math.min(BAR_MAX_WIDTH, 100 / points.length - GAP);

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" /> Wins
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" /> Losses
        </span>
      </div>

      <div className="relative flex items-end gap-[2px]" style={{ height: HEIGHT }}>
        {points.map((p, i) => {
          const winHeight = (p.wins / maxBattles) * innerHeight;
          const lossHeight = (p.losses / maxBattles) * innerHeight;
          const hovered = hoverIndex === i;
          return (
            <div
              key={p.weekStart}
              className="relative flex flex-1 flex-col items-stretch justify-end"
              style={{ maxWidth: `${barWidth}%` }}
              onPointerEnter={() => setHoverIndex(i)}
              onPointerLeave={() => setHoverIndex(null)}
              onFocus={() => setHoverIndex(i)}
              onBlur={() => setHoverIndex(null)}
              tabIndex={0}
              role="img"
              aria-label={`Week of ${p.weekStart}: ${p.wins} wins, ${p.losses} losses`}
            >
              {hovered && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-card px-2 py-1 text-xs shadow-sm">
                  <p className="font-semibold text-foreground">{p.battles} battle{p.battles === 1 ? "" : "s"}</p>
                  <p className="text-muted-foreground">{p.wins}W / {p.losses}L</p>
                  <p className="text-muted-foreground">{new Date(p.weekStart).toLocaleDateString()}</p>
                </div>
              )}
              {/* losses on top, wins on bottom - anchors the "good" segment to the baseline */}
              <div
                className={`w-full rounded-t-[4px] bg-muted-foreground/40 transition-opacity ${hovered ? "" : "opacity-90"}`}
                style={{ height: lossHeight, marginBottom: lossHeight > 0 && winHeight > 0 ? GAP : 0 }}
              />
              <div
                className={`w-full bg-primary transition-opacity ${winHeight > 0 && lossHeight === 0 ? "rounded-t-[4px]" : ""} ${hovered ? "" : "opacity-90"}`}
                style={{ height: winHeight }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
