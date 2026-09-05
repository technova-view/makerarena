import { z } from "zod";

// Bio length is a Pro perk (see phase3a_monetization - "profile
// customization"), so it's a function of plan rather than one static
// number - the caller (updateMakerProfile) picks the limit from the
// maker's actual entitlement state, server-side, never from client input.
export const FREE_BIO_MAX = 300;
export const PRO_BIO_MAX = 1000;

export function makerProfileSchema(bioMaxLength: number) {
  return z.object({
    username: z
      .string()
      .min(3, "Username is too short")
      .max(30, "Username is too long")
      .regex(/^[a-z0-9_]+$/, "Lowercase letters, numbers, and underscores only"),
    display_name: z.string().min(1, "Display name is required").max(60),
    bio: z.string().max(bioMaxLength, "Bio is too long").optional().or(z.literal("")),
    website_url: z.string().url("Enter a valid URL").optional().or(z.literal("")),
    avatar_url: z.string().url().optional().or(z.literal("")),
    banner_url: z.string().url().optional().or(z.literal("")),
  });
}

export type MakerProfileInput = z.infer<ReturnType<typeof makerProfileSchema>>;
