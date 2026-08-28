"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { productSchema } from "@/lib/validations/product";
import { slugify, withRandomSuffix } from "@/lib/utils/slug";

export type ProductActionState = { error: string | null };

export async function createProduct(
  _prevState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to publish a product." };
  }

  const screenshotsRaw = formData.get("screenshots");
  const parsed = productSchema.safeParse({
    name: formData.get("name"),
    tagline: formData.get("tagline") ?? "",
    website_url: formData.get("website_url"),
    description: formData.get("description"),
    category_slug: formData.get("category_slug"),
    logo_url: formData.get("logo_url") ?? "",
    screenshots: screenshotsRaw ? JSON.parse(String(screenshotsRaw)) : [],
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;
  const baseSlug = slugify(data.name);

  let slug = baseSlug;
  let attempt = 0;
  let insertedId: string | null = null;

  // maker_id is taken from the server-side session, never from client input.
  while (attempt < 5 && !insertedId) {
    const { data: inserted, error } = await supabase
      .from("products")
      .insert({
        maker_id: user.id,
        category_slug: data.category_slug,
        name: data.name,
        slug,
        tagline: data.tagline || null,
        description: data.description,
        website_url: data.website_url,
        logo_url: data.logo_url || null,
        screenshots: data.screenshots ?? [],
        status: "published",
      })
      .select("id, slug")
      .single();

    if (!error && inserted) {
      insertedId = inserted.id;
      slug = inserted.slug;
      break;
    }

    if (error?.code === "23505") {
      // unique_violation on slug - retry with a random suffix
      slug = withRandomSuffix(baseSlug);
      attempt += 1;
      continue;
    }

    return { error: error?.message ?? "Could not publish product." };
  }

  if (!insertedId) {
    return { error: "Could not publish product. Please try a different name." };
  }

  // Non-blocking: a crash here delays (never loses) an eventual unlock,
  // since the achievement check re-derives from a fresh count next time
  // rather than consuming a one-shot event.
  const { error: achError } = await supabase.rpc("check_product_count_achievements", {
    p_maker_id: user.id,
  });
  if (achError) console.error("check_product_count_achievements failed:", achError.message);

  const { error: rankError } = await supabase.rpc("recompute_maker_rank", {
    p_maker_id: user.id,
  });
  if (rankError) console.error("recompute_maker_rank failed:", rankError.message);

  const { data: maker } = await supabase
    .from("makers")
    .select("username")
    .eq("id", user.id)
    .single();

  revalidatePath("/");
  revalidatePath(`/categories/${data.category_slug}`);
  if (maker) revalidatePath(`/makers/${maker.username}`);
  redirect(`/products/${slug}`);
}

export type ArchiveActionState = { error: string | null };

// No delete policy on products (see 0003_rls_policies.sql) - votes,
// season_results, and maker_achievements all reference product_id with no
// ON DELETE cascade, so a real DELETE would either be rejected outright
// (FK violation) once a product has battle history, or silently corrupt
// opponents' win/loss records if it weren't. Archiving is the only
// supported way for a maker to retire a product.
export async function archiveProduct(
  _prevState: ArchiveActionState,
  formData: FormData,
): Promise<ArchiveActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to archive a product." };
  }

  const productId = formData.get("product_id");
  if (typeof productId !== "string" || !productId) {
    return { error: "Invalid product." };
  }

  // maker_id filter is redundant with the "maker can update own product" RLS
  // policy, but kept explicit so a mismatched id fails as a clean "not
  // found" .single() error rather than relying solely on RLS to no-op it.
  const { data: updated, error } = await supabase
    .from("products")
    .update({ status: "archived" })
    .eq("id", productId)
    .eq("maker_id", user.id)
    .select("slug, category_slug")
    .single();

  if (error || !updated) {
    return { error: error?.message ?? "Could not archive product." };
  }

  const { data: maker } = await supabase
    .from("makers")
    .select("username")
    .eq("id", user.id)
    .single();

  revalidatePath(`/products/${updated.slug}`);
  revalidatePath(`/categories/${updated.category_slug}`);
  revalidatePath("/");
  if (maker) revalidatePath(`/makers/${maker.username}`);

  redirect(maker ? `/makers/${maker.username}` : "/");
}
