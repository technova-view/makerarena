import { cn } from "@/lib/utils/cn";

export interface AchievementBadgeData {
  code: string;
  name: string;
  description: string;
  icon: string;
  unlockedAt: string;
}

export function AchievementBadge({
  achievement,
  className,
}: {
  achievement: AchievementBadgeData;
  className?: string;
}) {
  const unlockedDate = new Date(achievement.unlockedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <span
      title={`${achievement.description} — unlocked ${unlockedDate}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium",
        className,
      )}
    >
      <span aria-hidden="true">{achievement.icon}</span>
      {achievement.name}
    </span>
  );
}
