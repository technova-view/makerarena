import { z } from "zod";

export const voteSchema = z.object({
  winner_product_id: z.string().uuid(),
  loser_product_id: z.string().uuid(),
  // Only used to compute a display-only "now #N in category" rank for the
  // share card - never written to the database, so it doesn't need to be
  // re-verified server-side the way maker_id/product ownership does.
  winner_category_slug: z.string().min(1),
});

export type VoteInput = z.infer<typeof voteSchema>;
