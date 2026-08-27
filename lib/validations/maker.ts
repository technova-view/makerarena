import { z } from "zod";

export const makerProfileSchema = z.object({
  username: z
    .string()
    .min(3, "Username is too short")
    .max(30, "Username is too long")
    .regex(/^[a-z0-9_]+$/, "Lowercase letters, numbers, and underscores only"),
  display_name: z.string().min(1, "Display name is required").max(60),
  bio: z.string().max(300, "Bio is too long").optional().or(z.literal("")),
  website_url: z.string().url("Enter a valid URL").optional().or(z.literal("")),
  avatar_url: z.string().url().optional().or(z.literal("")),
});

export type MakerProfileInput = z.infer<typeof makerProfileSchema>;
