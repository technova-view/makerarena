import { Card } from "@/components/ui/card";

// Stat tile contract (dataviz skill): label (sentence case, no trailing
// colon) + value (semibold, proportional figures - not tabular-nums, this
// isn't a column of aligned numbers) + optional signed delta, colored by
// direction. No trend sparkline slot here - the full charts below each tile
// already cover that; a 12px sparkline here would just repeat them smaller.
export function StatTile({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down" } | null;
}) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-2xl font-semibold">{value}</p>
        {delta && (
          <span className={delta.direction === "up" ? "text-sm text-primary" : "text-sm text-muted-foreground"}>
            {delta.direction === "up" ? "+" : ""}
            {delta.value}
          </span>
        )}
      </div>
    </Card>
  );
}
