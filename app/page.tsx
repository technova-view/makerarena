import Link from "next/link";
import { Swords } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES } from "@/lib/utils/constants";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { Card } from "@/components/ui/card";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  const sortColumn = sort === "views" ? "views" : "rating";

  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, slug, name, rating, views, makers(username)")
    .eq("status", "published")
    .order(sortColumn, { ascending: false })
    // Explicit tie-breaker: most products start at rating=1500, so without
    // this the order among ties is undefined and can flicker between loads.
    .order("created_at", { ascending: true })
    .limit(10);

  // Parallel query + merge by id, following the pattern already used in
  // components/battles/battle-history.tsx - product_divisions() has no FK
  // metadata for PostgREST to embed, so it's fetched and joined here
  // rather than nested in the products select. It always computes over the
  // whole eligible population (percentile math needs that regardless of
  // which ids the caller cares about), so there's nothing to filter it by.
  const { data: divisions } = await supabase.rpc("product_divisions");
  const divisionByProductId = new Map((divisions ?? []).map((d) => [d.product_id, d.division]));

  const rows = (products ?? []).map((product) => {
    const maker = Array.isArray(product.makers) ? product.makers[0] : product.makers;
    return {
      slug: product.slug,
      name: product.name,
      rating: product.rating,
      views: product.views,
      maker_username: maker?.username ?? null,
      division: divisionByProductId.get(product.id) ?? null,
    };
  });

  return (
    <div>
      <section className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">MAKERARENA</h1>
        <p className="mt-3 text-lg text-muted-foreground">Build. Publish. Compete.</p>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Discover what makers are building — and see how your product stacks up.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/categories"
            className="rounded-lg border border-border px-5 py-2.5 font-medium hover:bg-muted"
          >
            Explore products
          </Link>
          <Link
            href="/arena"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:opacity-90"
          >
            <Swords className="h-4 w-4" />
            Enter the arena
          </Link>
          <Link
            href="/products/new"
            className="rounded-lg border border-border px-5 py-2.5 font-medium hover:bg-muted"
          >
            Publish your product
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">🏆 Leaderboard</h2>
          <div className="flex gap-2 text-sm">
            <Link
              href="/"
              className={sortColumn === "rating" ? "font-medium text-primary" : "text-muted-foreground"}
            >
              Top rated
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link
              href="/?sort=views"
              className={sortColumn === "views" ? "font-medium text-primary" : "text-muted-foreground"}
            >
              Most viewed
            </Link>
          </div>
        </div>
        <LeaderboardTable rows={rows} />
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h2 className="mb-4 text-xl font-bold">Categories</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {CATEGORIES.map((category) => (
            <Link key={category.slug} href={`/categories/${category.slug}`}>
              <Card className="p-4 text-center font-medium transition-colors hover:border-primary">
                {category.name}
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
