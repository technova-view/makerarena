import Link from "next/link";
import { cn } from "@/lib/utils/cn";

export function CategoryFilter({
  categories,
  activeSlug,
  getHref = (slug) => (slug ? `/categories/${slug}` : "/categories"),
}: {
  categories: readonly { slug: string; name: string }[];
  activeSlug?: string;
  /** Defaults to /categories/[slug] browsing; pass a custom mapper (e.g. for
   * /arena?category=[slug]) to reuse this filter bar elsewhere. */
  getHref?: (slug: string | null) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href={getHref(null)}
        className={cn(
          "rounded-full border border-border px-3 py-1 text-sm",
          !activeSlug ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
        )}
      >
        All
      </Link>
      {categories.map((category) => (
        <Link
          key={category.slug}
          href={getHref(category.slug)}
          className={cn(
            "rounded-full border border-border px-3 py-1 text-sm",
            activeSlug === category.slug
              ? "bg-primary text-primary-foreground border-primary"
              : "hover:bg-muted",
          )}
        >
          {category.name}
        </Link>
      ))}
    </div>
  );
}
