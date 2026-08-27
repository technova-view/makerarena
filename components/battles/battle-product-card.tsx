import Image from "next/image";
import { Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export interface BattleCandidate {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  logo_url: string | null;
  rating: number;
  category_slug: string;
}

export function BattleProductCard({
  product,
  onChoose,
  disabled,
  chosen,
  ratingDelta,
}: {
  product: BattleCandidate;
  onChoose?: () => void;
  disabled?: boolean;
  chosen?: boolean;
  ratingDelta?: number;
}) {
  return (
    <Card
      className={cn(
        "flex flex-col items-center gap-3 p-6 text-center transition-colors",
        chosen && "border-primary",
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-muted">
        {product.logo_url ? (
          <Image
            src={product.logo_url}
            alt={product.name}
            width={64}
            height={64}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-2xl font-semibold text-muted-foreground">
            {product.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div>
        <p className="font-semibold">{product.name}</p>
        {product.tagline && <p className="text-sm text-muted-foreground">{product.tagline}</p>}
      </div>

      {ratingDelta === undefined ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Trophy className="h-3 w-3" />
          {product.rating}
        </span>
      ) : (
        <span
          className={cn(
            "text-sm font-medium",
            ratingDelta >= 0 ? "text-primary" : "text-muted-foreground",
          )}
        >
          {product.rating} → {product.rating + ratingDelta} ({ratingDelta >= 0 ? "+" : ""}
          {ratingDelta})
        </span>
      )}

      {onChoose && (
        <Button type="button" onClick={onChoose} disabled={disabled} className="w-full">
          Choose {product.name}
        </Button>
      )}
    </Card>
  );
}
