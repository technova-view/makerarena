import { z } from "zod";
import { CATEGORIES } from "@/lib/utils/constants";

const categorySlugs = CATEGORIES.map((c) => c.slug) as [string, ...string[]];

export const productSchema = z.object({
  name: z.string().min(2, "Name is too short").max(60, "Name is too long"),
  tagline: z.string().max(100, "Tagline is too long").optional().or(z.literal("")),
  website_url: z.string().url("Enter a valid URL"),
  description: z
    .string()
    .min(20, "Tell us a bit more (at least 20 characters)")
    .max(2000, "Description is too long"),
  category_slug: z.enum(categorySlugs, {
    message: "Choose a category",
  }),
  logo_url: z.string().url().optional().or(z.literal("")),
  screenshots: z.array(z.string().url()).max(5).optional(),
});

export type ProductInput = z.infer<typeof productSchema>;

export const productBasicsSchema = productSchema.pick({
  name: true,
  tagline: true,
  website_url: true,
  description: true,
});

export const productCategorySchema = productSchema.pick({
  category_slug: true,
});
