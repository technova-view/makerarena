"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { makerProfileSchema } from "@/lib/validations/maker";

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

  const parsed = makerProfileSchema.safeParse({
    username: formData.get("username"),
    display_name: formData.get("display_name"),
    bio: formData.get("bio") ?? "",
    website_url: formData.get("website_url") ?? "",
    avatar_url: formData.get("avatar_url") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;

  const { error } = await supabase
    .from("makers")
    .update({
      username: data.username,
      display_name: data.display_name,
      bio: data.bio || null,
      website_url: data.website_url || null,
      avatar_url: data.avatar_url || null,
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
