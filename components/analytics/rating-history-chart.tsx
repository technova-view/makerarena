"use client";

import { useMemo, useState } from "react";
import type { RatingPoint } from "@/lib/analytics";

const WIDTH = 600;
const HEIGHT = 200;
const PAD_X = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;

// Single series - per the dataviz skill, one series needs no legend box (the
// section title already says what's plotted). The only mark is a 2px line in
// the app's existing "primary" token (currentColor, so it's theme-aware and
// matches how battle-history.tsx already colors a win), with an end-dot
// marking the current rating and a hover crosshair that snaps to the nearest
// point rather than making the reader aim at a 2px line.
export function RatingHistoryChart({ points }: { points: RatingPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { path, coords, minRating, maxRating } = useMemo(() => {
    if (points.length === 0) return { path: "", coords: [] as { x: number; y: number }[], minRating: 0, maxRating: 0 };
    const ratings = points.map((p) => p.rating);
    const min = Math.min(...ratings);
    const max = Math.max(...ratings);
    const range = max - min || 1;
    const innerWidth = WIDTH - PAD_X * 2;
    const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const coords = points.map((p, i) => ({
      x: PAD_X + (points.length === 1 ? innerWidth / 2 : (i / (points.length - 1)) * innerWidth),
      y: PAD_TOP + innerHeight - ((p.rating - min) / range) * innerHeight,
    }));
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
    return { path, coords, minRating: min, maxRating: max };
  }, [points]);

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No battles yet - the rating trend will appear here once this product has fought.</p>;
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const hoveredCoord = hoverIndex !== null ? coords[hoverIndex] : null;

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let nearestDist = Infinity;
    coords.forEach((c, i) => {
      const dist = Math.abs(c.x - relX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  }

  return (
    <div className="relative text-primary">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIndex(null)}
        role="img"
        aria-label={`Rating history from ${minRating} to ${maxRating}`}
      >
        {/* recessive baseline - one-step-off-surface gray, hairline */}
        <line
          x1={PAD_X}
          y1={HEIGHT - PAD_BOTTOM}
          x2={WIDTH - PAD_X}
          y2={HEIGHT - PAD_BOTTOM}
          className="stroke-border"
          strokeWidth={1}
        />
        {hoveredCoord && (
          <line
            x1={hoveredCoord.x}
            y1={PAD_TOP}
            x2={hoveredCoord.x}
            y2={HEIGHT - PAD_BOTTOM}
            className="stroke-border"
            strokeWidth={1}
          />
        )}
        <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* end-dot: the current rating, the one point worth a permanent marker */}
        {coords.length > 0 && (
          <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r={4} fill="currentColor" stroke="var(--card)" strokeWidth={2} />
        )}
        {hoveredCoord && (
          <circle cx={hoveredCoord.x} cy={hoveredCoord.y} r={4} fill="currentColor" stroke="var(--card)" strokeWidth={2} />
        )}
      </svg>

      {hovered && hoveredCoord && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-card px-2 py-1 text-xs shadow-sm"
          style={{ left: `${(hoveredCoord.x / WIDTH) * 100}%`, top: `${(hoveredCoord.y / HEIGHT) * 100}%` }}
        >
          <p className="font-semibold text-foreground">{hovered.rating}</p>
          <p className="text-muted-foreground">{new Date(hovered.at).toLocaleDateString()}</p>
        </div>
      )}
    </div>
  );
}
