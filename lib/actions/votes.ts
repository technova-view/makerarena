"use server";

import { createClient } from "@/lib/supabase/server";
import { voteSchema } from "@/lib/validations/vote";

export type VoteResult = {
  winnerRatingBefore: number;
  loserRatingBefore: number;
  winnerRatingAfter: number;
  loserRatingAfter: number;
  // All-time (never-resetting) counterparts, plumbed through from
  // cast_vote for a future all-time UI - not surfaced anywhere yet.
  winnerAllTimeRatingBefore: number;
  loserAllTimeRatingBefore: number;
  winnerAllTimeRatingAfter: number;
  loserAllTimeRatingAfter: number;
  /** 1-based rank within its category, by rating, after this vote. Null if
   * the rank query fails for any reason - display-only, never blocks the
   * vote itself from succeeding. */
  winnerRank: number | null;
};

export type VoteActionState = { error: string | null; result: VoteResult | null };

export async function castVote(
  _prevState: VoteActionState,
  formData: FormData,
): Promise<VoteActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to vote.", result: null };
  }

  const parsed = voteSchema.safeParse({
    winner_product_id: formData.get("winner_product_id"),
    loser_product_id: formData.get("loser_product_id"),
    winner_category_slug: formData.get("winner_category_slug"),
  });

  if (!parsed.success) {
    return { error: "Invalid matchup.", result: null };
  }

  const { data, error } = await supabase.rpc("cast_vote", {
    p_winner_product_id: parsed.data.winner_product_id,
    p_loser_product_id: parsed.data.loser_product_id,
  });

  if (error) {
    return { error: error.message, result: null };
  }

  // Deliberately no revalidatePath("/arena") here: unlike most Server
  // Actions, this page's data (get_random_pairing) is intentionally
  // non-deterministic, not "the same data, now updated." Revalidating the
  // currently-open /arena page would trigger Next.js to auto-refresh it in
  // the background with a brand-new random pairing while this reveal is
  // still showing, swapping the product cards out from under the just-cast
  // vote (confirmed live: the vote itself computes and records correctly,
  // but the displayed "before" values/products would silently belong to a
  // different, freshly-randomized pairing). "Next matchup" already forces a
  // fresh pairing via a real navigation - no revalidation needed for that.
  const row = data?.[0];
  if (!row) {
    return { error: null, result: null };
  }

  // Rank = 1 + how many published products in the same category now have a
  // strictly higher rating. Best-effort: a failure here shouldn't undo or
  // block a vote that already succeeded, so errors just leave rank null.
  const { count } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("category_slug", parsed.data.winner_category_slug)
    .eq("status", "published")
    .gt("rating", row.winner_rating_after);

  return {
    error: null,
    result: {
      winnerRatingBefore: row.winner_rating_before,
      loserRatingBefore: row.loser_rating_before,
      winnerRatingAfter: row.winner_rating_after,
      loserRatingAfter: row.loser_rating_after,
      winnerAllTimeRatingBefore: row.winner_all_time_rating_before,
      loserAllTimeRatingBefore: row.loser_all_time_rating_before,
      winnerAllTimeRatingAfter: row.winner_all_time_rating_after,
      loserAllTimeRatingAfter: row.loser_all_time_rating_after,
      winnerRank: count === null ? null : count + 1,
    },
  };
}
