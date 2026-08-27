import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES } from "@/lib/utils/constants";
import { CategoryFilter } from "@/components/leaderboard/category-filter";
import { ProductGrid } from "@/components/products/product-grid";

const PAGE_SIZE = 20;

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string; page?: string }>;
}) {
  const { slug } = await params;
  const { sort, page } = await searchParams;

  const category = CATEGORIES.find((c) => c.slug === slug);
  if (!category) notFound();

  const sortColumn = sort === "views" ? "views" : "rating";
  const currentPage = Math.max(1, Number(page ?? 1) || 1);
  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, slug, name, tagline, logo_url, rating, views, category_slug")
    .eq("category_slug", slug)
    .eq("status", "published")
    .order(sortColumn, { ascending: false })
    // Explicit tie-breaker - without it, ties (common at rating=1500) have
    // undefined order, which would make .range() pagination unstable
    // (skipped or duplicated rows across pages).
    .order("created_at", { ascending: true })
    .range(from, to);

  // Parallel query + merge by id (product_divisions() has no FK metadata
  // for PostgREST to embed, and always computes over the whole eligible
  // population regardless of category, so it's fetched once and joined
  // here rather than nested in the products select).
  const { data: divisions } = await supabase.rpc("product_divisions");
  const divisionByProductId = new Map((divisions ?? []).map((d) => [d.product_id, d.division]));
  const productsWithDivision = (products ?? []).map((p) => ({
    ...p,
    division: divisionByProductId.get(p.id) ?? null,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-4 text-2xl font-bold">{category.name}</h1>
      <div className="mb-6">
        <CategoryFilter categories={CATEGORIES} activeSlug={slug} />
      </div>
      <ProductGrid products={productsWithDivision} />
    </div>
  );
}
