"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MakerAvatarUploader } from "@/components/makers/maker-avatar-uploader";
import { MakerBannerUploader } from "@/components/makers/maker-banner-uploader";
import { updateMakerProfile, type MakerActionState } from "@/lib/actions/makers";
import { FREE_BIO_MAX, PRO_BIO_MAX } from "@/lib/validations/maker";

interface Maker {
  username: string;
  display_name: string;
  avatar_url: string | null;
  banner_url: string | null;
  bio: string | null;
  website_url: string | null;
}

const initialState: MakerActionState = { error: null };

export function ProfileForm({ maker, isPro }: { maker: Maker; isPro: boolean }) {
  const [state, formAction, pending] = useActionState(updateMakerProfile, initialState);
  const [avatar, setAvatar] = useState<string[]>(maker.avatar_url ? [maker.avatar_url] : []);
  const [banner, setBanner] = useState<string[]>(maker.banner_url ? [maker.banner_url] : []);
  const [bio, setBio] = useState(maker.bio ?? "");
  const bioMax = isPro ? PRO_BIO_MAX : FREE_BIO_MAX;

  return (
    <form action={formAction} className="space-y-4">
      {isPro ? (
        <MakerBannerUploader value={banner} onChange={setBanner} />
      ) : (
        <div>
          <p className="mb-1.5 text-sm font-medium text-foreground">Profile banner</p>
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Profile banners are a Pro feature.{" "}
            <Link href="/pricing" className="text-primary hover:underline">
              Upgrade to Pro
            </Link>{" "}
            to add one.
          </div>
        </div>
      )}
      <input type="hidden" name="banner_url" value={isPro ? (banner[0] ?? "") : (maker.banner_url ?? "")} />

      <MakerAvatarUploader value={avatar} onChange={setAvatar} />
      <input type="hidden" name="avatar_url" value={avatar[0] ?? ""} />

      <div>
        <Label htmlFor="username">Username</Label>
        <Input id="username" name="username" defaultValue={maker.username} required />
      </div>
      <div>
        <Label htmlFor="display_name">Display name</Label>
        <Input id="display_name" name="display_name" defaultValue={maker.display_name} required />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="bio">Bio</Label>
          <span className="text-xs text-muted-foreground">
            {bio.length}/{bioMax}
          </span>
        </div>
        <Textarea
          id="bio"
          name="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, bioMax))}
          rows={3}
        />
        {!isPro && (
          <p className="mt-1 text-xs text-muted-foreground">
            Pro makers get a longer bio ({PRO_BIO_MAX} characters).
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="website_url">Website (optional)</Label>
        <Input id="website_url" name="website_url" defaultValue={maker.website_url ?? ""} placeholder="https://" />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && <p className="text-sm text-primary">Profile updated.</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
