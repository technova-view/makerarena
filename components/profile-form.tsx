"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MakerAvatarUploader } from "@/components/makers/maker-avatar-uploader";
import { updateMakerProfile, type MakerActionState } from "@/lib/actions/makers";

interface Maker {
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  website_url: string | null;
}

const initialState: MakerActionState = { error: null };

export function ProfileForm({ maker }: { maker: Maker }) {
  const [state, formAction, pending] = useActionState(updateMakerProfile, initialState);
  const [avatar, setAvatar] = useState<string[]>(maker.avatar_url ? [maker.avatar_url] : []);

  return (
    <form action={formAction} className="space-y-4">
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
        <Label htmlFor="bio">Bio</Label>
        <Textarea id="bio" name="bio" defaultValue={maker.bio ?? ""} rows={3} />
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
