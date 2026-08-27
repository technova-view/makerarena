# Technical Debt / Security Checklist

Known gaps that are accepted for now but should be resolved before wider exposure (real users, payments, Phase 3). Each entry gets a stable ID (`TD-NNN`) so it can be referenced from commits/PRs when fixed.

---

## TD-001 — Self-vote can inflate product `all_time_rating`

- **Origin:** `cast_vote()`, `supabase/migrations/0007_battles_voting.sql` (Phase 2A)
- **Impact:** `products.rating` / `products.all_time_rating` directly; downstream, MakerRank's `product_component` (`supabase/migrations/0011_maker_rank.sql`, Phase 2B.4) — a 60%-weighted branch of the maker's public reputation score
- **Status:** **fixed** in `supabase/migrations/0012_fix_self_battle.sql` (pre-Phase-3 hardening pass)

### The gap

`cast_vote()` only checks that the **voter** doesn't own either product in the matchup:

```sql
if v_first.maker_id = v_voter_id or v_second.maker_id = v_voter_id then
  raise exception 'You cannot vote on a matchup that includes your own product.' ...
```

It never checks whether `v_first.maker_id = v_second.maker_id` — i.e. whether **both products belong to the same maker**, regardless of who the voter is. `get_random_pairing()` has the same gap: it only excludes the *viewer's* own products from a pairing, not two products owned by some other single maker.

### The exploit

A maker who controls a second ("sockpuppet") account with no products of its own can call `cast_vote()` directly as that second account, repeatedly declaring one of their own products the winner over another. This:

- Legitimately moves Elo (`rating` and `all_time_rating`) on both products — `cast_vote`'s math has no way to know the battle wasn't a real contest.
- Requires rotating opponents/pairs to dodge the 24h pair-cooldown, but is otherwise unthrottled by anything specific to self-battling.

### Why it wasn't fixed in Phase 2B

Both Phase 2B.3 (Achievements) and Phase 2B.4 (MakerRank) found this independently and worked around it **in their own aggregates only**: `check_battle_achievements()` and `recompute_maker_rank()`'s competition branch both exclude any vote where *both* sides belong to the same maker's product set, using `winner_product_id = any(ids) and loser_product_id <> all(ids)` (and the mirror). That containment is real and verified (live-tested in both phases), but it's a downstream patch, not a fix at the source — `all_time_rating` itself, and therefore MakerRank's `product_component`, remains exploitable through this path.

### The fix

Closed at the source, in `cast_vote()` itself — the same place the voter-ownership check lives:

```sql
if v_first.maker_id = v_second.maker_id then
  raise exception 'A maker cannot battle their own products against each other.' using errcode = '42501';
end if;
```

This closes the exploit regardless of how the pairing was discovered (arena UI, or a direct RPC call bypassing the UI entirely) — defense lives at the write boundary, matching every other integrity check in `cast_vote`. `get_random_pairing()` was also updated (two sequential draws, the second excluding the first pick's `maker_id`) so a legitimate voter never organically hits the new exception, though that change is UX-only — the `cast_vote` check is what actually matters for security.

`check_battle_achievements`'/`recompute_maker_rank`'s pre-existing self-battle-exclusion logic was left in place — it's dead code for *new* votes going forward, but remains correct for any historical self-battle votes that predate the fix, and costs nothing to keep.

### Verification (live, 2026-08-28)

Ran the exact exploit scenario against the real Supabase project — `cast_vote(A1, A2)` and the reversed `cast_vote(A2, A1)`, both as a third-party voter — with a full before/after state diff (`rating`, `all_time_rating`, `battles_count` on both products, `votes` row count, MakerRank, achievements). All unchanged in both directions; both calls rejected with `42501`. Regression-checked: normal cross-maker voting still works, and `get_random_pairing()` never returned a same-maker pair across 150 calls (varying category filter, including unfiltered) while still correctly excluding the viewer's own products. 35/35 checks passed. Test data cleaned up afterward via `dev-cleanup-test-users.js`.

**Resolved:** 2026-08-28, pre-Phase-3 hardening pass.

---

## Pre-launch checklist

Items that are correct to leave as-is *during development*, but must be done as the literal last step before a real public launch — doing them earlier just means repeating them once more Phase 3 testing dirties the state again.

### PL-001 — Reset season state to a clean Season 1

Live-verifying `run_season_transition()` (TD-001's fix) required actually running real transitions, which permanently ended the real Season 1 and Season 2 — the platform is currently on Season 3 for real, with `season_results` for seasons 1–2 empty (their rows were test data, already cleaned up) but the season records themselves persisting (by design — seasons are a permanent archive, never deleted).

**Reset, as the last step before going live:**
```sql
delete from public.season_results;
delete from public.votes where season_id is not null;
delete from public.seasons;
insert into public.seasons (season_number, label, status, starts_at, ends_at)
values (1, 'Season 1', 'active', now(), now() + interval '1 month');
```
This is exactly `0008_seasons.sql`'s original bootstrap statement — safe to re-run once, right before launch, once no further pre-launch testing will touch seasons/votes.

**Status:** open, deliberately deferred (not a bug — see reasoning above).
