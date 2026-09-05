import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProAccess } from "@/lib/entitlements";
import { ProfileForm } from "@/components/profile-form";

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/settings/profile");

  const [{ data: maker }, pro] = await Promise.all([
    supabase
      .from("makers")
      .select("username, display_name, avatar_url, banner_url, bio, website_url")
      .eq("id", user.id)
      .single(),
    getProAccess(supabase, user.id),
  ]);

  if (!maker) redirect("/");

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">Profile settings</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        This is your public maker profile.
      </p>
      <ProfileForm maker={maker} isPro={pro.active} />
    </div>
  );
}
