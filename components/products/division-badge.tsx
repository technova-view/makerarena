import type { DivisionTier } from "@/lib/types/database.types";
import { cn } from "@/lib/utils/cn";

const DIVISION_META: Record<DivisionTier, { label: string; emoji: string; className: string }> = {
  elite: { label: "Elite", emoji: "👑", className: "text-amber-500 dark:text-amber-400" },
  diamond: { label: "Diamond", emoji: "💎", className: "text-sky-500 dark:text-sky-400" },
  gold: { label: "Gold", emoji: "🥇", className: "text-yellow-600 dark:text-yellow-500" },
  silver: { label: "Silver", emoji: "🥈", className: "text-slate-500 dark:text-slate-400" },
  bronze: { label: "Bronze", emoji: "🥉", className: "text-orange-700 dark:text-orange-500" },
};

export function DivisionBadge({
  division,
  rankPosition,
  population,
  className,
}: {
  division: DivisionTier | null | undefined;
  rankPosition?: number;
  population?: number;
  className?: string;
}) {
  if (!division) return null;

  const meta = DIVISION_META[division];
  const title =
    rankPosition && population ? `#${rankPosition} of ${population} ranked products` : undefined;

  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 text-xs font-medium", meta.className, className)}
    >
      <span aria-hidden="true">{meta.emoji}</span>
      {meta.label}
    </span>
  );
}
