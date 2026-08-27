"use client";

import { startTransition, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Swords, Trophy } from "lucide-react";
import { castVote, type VoteActionState } from "@/lib/actions/votes";
import { BattleProductCard, type BattleCandidate } from "@/components/battles/battle-product-card";
import { ShareResultActions } from "@/components/ui/share-button";
import { CATEGORIES } from "@/lib/utils/constants";

const initialState: VoteActionState = { error: null, result: null };

export function BattleArena({
  productA,
  productB,
  isAuthenticated,
  category,
}: {
  productA: BattleCandidate;
  productB: BattleCandidate;
  isAuthenticated: boolean;
  category?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(castVote, initialState);
  const [chosenId, setChosenId] = useState<string | null>(null);

  const nextHref = category ? `/arena?category=${category}` : "/arena";

  function choose(winner: BattleCandidate, loser: BattleCandidate) {
    if (!isAuthenticated) {
      router.push(`/login?next=${encodeURIComponent(nextHref)}`);
      return;
    }
    setChosenId(winner.id);
    const fd = new FormData();
    fd.set("winner_product_id", winner.id);
    fd.set("loser_product_id", loser.id);
    fd.set("winner_category_slug", winner.category_slug);
    startTransition(() => {
      formAction(fd);
    });
  }

  const resolved = Boolean(state.result);
  const winnerDelta = state.result ? state.result.winnerRatingAfter - state.result.winnerRatingBefore : undefined;
  const loserDelta = state.result ? state.result.loserRatingAfter - state.result.loserRatingBefore : undefined;

  const winnerIsA = chosenId === productA.id;
  const winnerProduct = winnerIsA ? productA : productB;
  const loserProduct = winnerIsA ? productB : productA;
  const categoryName = CATEGORIES.find((c) => c.slug === winnerProduct.category_slug)?.name ?? winnerProduct.category_slug;

  // "Currently #N", not "→ #N" - this text gets copied/shared as a static
  // string and may be read long after the battle happened, by which point
  // the rank could have moved. We only store the rating snapshot from the
  // vote itself (winnerRatingAfter), never a rank-at-vote-time, so phrasing
  // it as part of the historical result would misrepresent a live, moving
  // number as a frozen fact.
  const shareText =
    state.result && winnerDelta !== undefined
      ? `🏆 ${winnerProduct.name} defeated ${loserProduct.name} on MakerArena\n` +
        `+${winnerDelta} rating` +
        (state.result.winnerRank ? `\nCurrently #${state.result.winnerRank} in ${categoryName}` : "")
      : "";
  const sharePath = `/products/${winnerProduct.slug}`;

  return (
    <div>
      <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <BattleProductCard
          product={productA}
          onChoose={resolved ? undefined : () => choose(productA, productB)}
          disabled={pending}
          chosen={resolved && winnerIsA}
          ratingDelta={resolved ? (winnerIsA ? winnerDelta : loserDelta) : undefined}
        />
        <span className="justify-self-center text-lg font-bold text-muted-foreground">VS</span>
        <BattleProductCard
          product={productB}
          onChoose={resolved ? undefined : () => choose(productB, productA)}
          disabled={pending}
          chosen={resolved && !winnerIsA}
          ratingDelta={resolved ? (winnerIsA ? loserDelta : winnerDelta) : undefined}
        />
      </div>

      {state.error && <p className="mt-4 text-center text-sm text-destructive">{state.error}</p>}

      {resolved && winnerDelta !== undefined && (
        <div className="mt-6 rounded-xl border border-border bg-muted/50 p-6 text-center">
          <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-primary">
            <Trophy className="h-4 w-4" />
            VICTORY
          </p>
          <p className="mt-2 font-medium">
            {winnerProduct.name} defeated {loserProduct.name}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            +{winnerDelta} rating
            {state.result?.winnerRank ? ` · Currently #${state.result.winnerRank} in ${categoryName}` : ""}
          </p>

          <ShareResultActions text={shareText} path={sharePath} className="mt-4" />

          <div className="mt-6">
            <Link
              href={nextHref}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:opacity-90"
            >
              <Swords className="h-4 w-4" />
              Next matchup
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
