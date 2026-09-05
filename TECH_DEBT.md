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

### PL-002 — Clear sandbox-origin billing data before going live

Live-verifying Phase 3D's checkout flow (`startProCheckout` → Polar sandbox checkout → webhook → `subscriptions`/`payments`/`entitlements`) required actually completing a real sandbox purchase, using a real maker account (`waliur_0fb383`, `maker_id 0fb383c3-...`) rather than a throwaway test user, since Stripe Elements + hCaptcha inside Polar's real checkout page can't be driven by an automated browser. No real money moved (separate sandbox Polar org), but it produced real rows in the one real Supabase database: 1 `subscriptions` row, 1 `payments` row, 2 `entitlements` rows (`pro_access` + `featured_credit`), plus 4 `webhook_events` audit rows.

Same reasoning as PL-001: don't clean up now — more Phase 3D/3E testing (refunds, cancellation, renewal) will just produce more sandbox-origin rows before launch. Since no real Polar production customer exists yet, every row in these tables at this stage is test-origin by construction, so a full wipe (not a filtered one) is the correct and simplest reset.

**Update (2026-09-05):** the `featured_credit` entitlement row mentioned above no longer exists — Polar rejected paid Featured placement in every form it was asked about (standalone, bidding, and this bundled-subscription-perk form), so `0017_product_slots.sql` deleted every `featured_credit` row and dropped the type from the schema entirely. Pro's replacement perk is `product_slots` (value 3). The `subscriptions`/`payments`/`webhook_events` rows from that same sandbox test are unaffected and still covered by the reset below.

#### Verification (live, 2026-09-05): `0017_product_slots.sql`

Applied to the real Supabase project and live-verified end-to-end via `scripts/dev-verify-product-slots.js` (one disposable test maker per run, `+slot_test_` email pattern, fully cleaned up — including from the underlying `subscriptions`/`entitlements`/`products` tables — via `auth.users` cascade after each run). 22/22 checks passed:

- Free maker: limit is 1; first product succeeds; a second (draft) is rejected at the limit; archiving the first frees a slot for a new one.
- Pro active: limit becomes 3; up to 3 active (draft+published) products succeed; a 4th is rejected.
- Replaying the identical `apply_subscription_event` call (same `provider_subscription_id` + `current_period_start`) is a no-op — no duplicate `pro_access`/`product_slots` rows.
- `cancel_at_period_end`: limit stays at 3 immediately after a scheduled cancellation, and only falls back to 1 once the period *genuinely* elapses (tested with real time passing, not a manually-edited row) — the specific ordering concern raised was that an expired `value=3` grant must never keep granting 3, and that an older expired grant can't resurrect itself after a newer one also expires; both confirmed directly, including inspecting the raw (still-present, both-expired) entitlement rows afterward.
- The 3 products published while Pro remain untouched after the downgrade — no retroactive archiving.
- Concurrency: 5 simultaneous inserts against exactly 1 free slot (Pro, limit 3, 2 already active) — exactly 1 succeeded, confirming the `pg_advisory_xact_lock`-based trigger actually serializes concurrent submissions rather than just looking correct on paper.

One real finding from this pass, since fixed in the verification script itself (not the migration): `subscriptions_single_active_idx` (pre-existing, from 0013) correctly rejects a second `status='active'` subscription row for the same maker if a prior one was never transitioned out of `active` first — the first version of the test script tried to activate a third fake subscription without ending the second one, got a silently-unchecked 409, and that surfaced as a confusing "wrong limit" result until the grant call's own status was asserted directly. Real Polar traffic doesn't hit this (a renewal reuses the same `provider_subscription_id`; a genuinely new subscription implies the old one was already canceled/revoked), but it's a good example of why this needed a live pass rather than being assumed correct from the SQL alone.

**Status:** resolved — `0017_product_slots.sql` is live, verified, and `scripts/dev-verify-product-slots.js` is committed for future re-verification.

#### Found after shipping (2026-09-05): missing backfill for pre-existing active subscriptions

The 22-check live pass above only ever tested *freshly granted* subscriptions (created via `apply_subscription_event` after 0017 already existed), so it never exercised the one case that actually broke: `waliur_0fb383`'s real Pro subscription (active since 2026-08-28, well before 0017 shipped) had a `pro_access` entitlement but no `product_slots` row — `apply_subscription_event` only grants on a *new* webhook event, and none had fired for that subscription since. `current_product_slot_limit()` correctly fell back to the free-tier default (1) per its own logic; the gap was that 0017 changed what a *new* event grants without backfilling subscriptions already active under the old logic. Surfaced by the user screenshotting their own real billing page showing "1 of 1" while Pro and Active.

Fixed in `0018_backfill_product_slots.sql`: inserts a matching `product_slots` (value 3) row for every `pro_access` row that doesn't already have one on the same `subscription_id` + `effective_at`, idempotent via `NOT EXISTS`. Applied live and confirmed: `waliur_0fb383` now correctly resolves to limit 3.

**Lesson for next time:** a migration that changes what a *future* event grants needs an explicit backfill pass for state that predates it — live-verifying only the "grant a brand new thing" path isn't sufficient when the schema change also affects already-existing rows.

**Reset, as the last step before going live** (after production webhook credentials are confirmed live and no further sandbox testing will happen):
```sql
delete from public.entitlements;
delete from public.payments;
delete from public.subscriptions;
delete from public.webhook_events;
```
No re-seed needed afterward (unlike PL-001's seasons bootstrap) — these tables start empty and populate themselves from real webhook deliveries once real customers pay.

**Status:** open, deliberately deferred (not a bug — see reasoning above).
