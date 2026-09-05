import Image from "next/image";
import Link from "next/link";
import { Eye, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DivisionBadge } from "@/components/products/division-badge";
import { ArchiveProductButton } from "@/components/products/archive-product-button";
import type { DivisionTier } from "@/lib/types/database.types";

export interface ProductCardData {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logo_url: string | null;
  rating: number;
  views: number;
  category_slug: string;
  division?: DivisionTier | null;
  status?: "draft" | "published" | "archived";
}

// showOwnerControls: only true on the maker's own profile, where drafts and
// archived products are visible too (see 0003_rls_policies.sql - owners can
// see/write all of their own products, not just published ones).
export function ProductCard({
  product,
  showOwnerControls = false,
}: {
  product: ProductCardData;
  showOwnerControls?: boolean;
}) {
  return (
    <Card className="flex h-full flex-col gap-3 p-4 transition-colors hover:border-primary">
      <Link href={`/products/${product.slug}`} className="flex flex-1 flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
            {product.logo_url ? (
              <Image
                src={product.logo_url}
                alt={product.name}
                width={48}
                height={48}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-lg font-semibold text-muted-foreground">
                {product.name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{product.name}</h3>
            {product.tagline && (
              <p className="truncate text-sm text-muted-foreground">{product.tagline}</p>
            )}
          </div>
        </div>

        {product.division && (
          <div>
            <DivisionBadge division={product.division} />
          </div>
        )}

        <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
          <Badge variant="outline">
            <Trophy className="h-3 w-3" />
            {product.rating}
          </Badge>
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {product.views.toLocaleString()}
          </span>
        </div>
      </Link>

      {showOwnerControls && product.status && product.status !== "published" && (
        <Badge variant="outline" className="self-start capitalize">
          {product.status}
        </Badge>
      )}
      {showOwnerControls && (
        <div className="flex items-center gap-3">
          <Link
            href={`/products/${product.slug}/analytics`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Analytics
          </Link>
          {product.status === "published" && (
            <ArchiveProductButton productId={product.id} productName={product.name} />
          )}
        </div>
      )}
    </Card>
  );
}
