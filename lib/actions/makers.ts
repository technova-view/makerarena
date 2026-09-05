"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { makerProfileSchema, FREE_BIO_MAX, PRO_BIO_MAX } from "@/lib/validations/maker";
import { getProAccess } from "@/lib/entitlements";

export type MakerActionState = { error: string | null; success?: boolean };

export async function updateMakerProfile(
  _prevState: MakerActionState,
  formData: FormData,
): Promise<MakerActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in." };
  }

  // Both the bio limit and whether a banner is allowed at all are Pro perks
  // - re-checked here from the entitlements snapshot, never inferred from
  // whatever the form happened to submit, same posture as the product-slot
  // trigger and every other Pro-gated write in this app.
  const pro = await getProAccess(supabase, user.id);

  const parsed = makerProfileSchema(pro.active ? PRO_BIO_MAX : FREE_BIO_MAX).safeParse({
    username: formData.get("username"),
    display_name: formData.get("display_name"),
    bio: formData.get("bio") ?? "",
    website_url: formData.get("website_url") ?? "",
    avatar_url: formData.get("avatar_url") ?? "",
    banner_url: formData.get("banner_url") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;

  // Non-Pro: banner_url is deliberately left out of the update entirely,
  // not set to null - a maker who set a banner while Pro and later lapses
  // keeps it (same "no retroactive punishment on downgrade" rule the
  // product-slot limit already follows), they just can't set a new one
  // until they're Pro again. The settings form itself doesn't render a
  // banner control at all for non-Pro makers, so this only matters for a
  // request that bypasses the UI.
  const { error } = await supabase
    .from("makers")
    .update({
      username: data.username,
      display_name: data.display_name,
      bio: data.bio || null,
      website_url: data.website_url || null,
      avatar_url: data.avatar_url || null,
      ...(pro.active ? { banner_url: data.banner_url || null } : {}),
    })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "That username is already taken." };
    }
    return { error: error.message };
  }

  revalidatePath(`/makers/${data.username}`);
  revalidatePath("/settings/profile");
  return { error: null, success: true };
}
