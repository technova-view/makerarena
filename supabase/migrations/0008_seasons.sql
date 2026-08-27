-- Phase 2B.1: Seasons. Hard-reset monthly competition on top of the
-- existing Elo system, with a permanent all_time_rating that never resets
-- and a permanent season_results archive. See supabase/migrations/0007's
-- comments for the battle/vote model this builds on.

-- ============================================================
-- 1. seasons
-- ============================================================

create table public.seasons (
  id            uuid primary key default gen_random_uuid(),
  season_number integer not null unique check (season_number >= 1),
  label         text not null,
  status        text not null default 'upcoming'
                  check (status in ('upcoming', 'active', 'ended')),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- At most one active season, ever: a unique index on a column whose
-- indexed value is constant ('active') for every matching row makes a
-- second 'active' row a literal duplicate-value violation.
create unique index seasons_single_active_idx
  on public.seasons (status) where status = 'active';

alter table public.seasons enable row level security;

create policy "seasons are publicly readable" on public.seasons
  for select using (true);

-- Bootstrap: there is no prior season, so the migration itself creates
-- Season 1, active, starting now.
insert into public.seasons (season_number, label, status, starts_at, ends_at)
values (1, 'Season 1', 'active', now(), now() + interval '1 month');

-- ============================================================
-- 2. products.all_time_rating
-- ============================================================

alter table public.products
  add column all_time_rating integer not null default 1500 check (all_time_rating >= 0);

-- No season has ever ended yet (Season 1 was just created above), so the
-- current `rating` already *is* each product's accurate all-time Elo to
-- date - nothing to reconstruct. From here on, cast_vote() keeps rating
-- and all_time_rating moving in lockstep.
update public.products set all_time_rating = rating;

create index products_category_all_time_rating_idx
  on public.products (category_slug, all_time_rating desc);

-- SECURITY: mirrors 0007's products.rating fix exactly. This is a new
-- ranking-relevant column and must NEVER appear in any GRANT UPDATE
-- statement for authenticated/anon. 0007 already revoked the table-level
-- UPDATE grant on products and re-granted only a fixed column list; this
-- new column is simply absent from that list. Postgres column-level
-- grants require an explicit positive grant - there is no implicit
-- "new columns inherit the old table-level grant" (that grant was
-- revoked, permanently). No new REVOKE is needed on products; the correct
-- state is the *absence* of any GRANT UPDATE (all_time_rating, ...)
-- statement, ever. Verified in this migration's manual test pass with a
-- direct PATCH attempt.

-- ============================================================
-- 3. season_results
-- ============================================================

create table public.season_results (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references public.seasons(id),
  -- No cascade, deliberately - products are never hard-deleted. If a
  -- maker-deletion cascade ever reaches a product with season_results
  -- rows, it will be blocked until those rows are explicitly cleared
  -- first, same as already happens for votes.
  product_id    uuid not null references public.products(id),
  -- Convenience denormalization (a product's maker never changes) - lets
  -- "this maker's season history" be queried without joining through
  -- products.
  maker_id      uuid not null references public.makers(id),
  -- Historical-accuracy denormalization: a product's category can be
  -- edited after a season ends, and a "who won Season 1 / Category X"
  -- page must reflect the category as it was at season end, not whatever
  -- it's been edited to since.
  category_slug text not null references public.categories(slug),
  final_rating  integer not null check (final_rating >= 0),
  battles_count integer not null check (battles_count >= 0),
  category_rank integer not null check (category_rank >= 1),
  overall_rank  integer not null check (overall_rank >= 1),
  created_at    timestamptz not null default now(),
  unique (season_id, product_id)
);

create index season_results_season_category_rank_idx
  on public.season_results (season_id, category_slug, category_rank);
create index season_results_season_overall_rank_idx
  on public.season_results (season_id, overall_rank);
create index season_results_maker_idx
  on public.season_results (maker_id, season_id);

alter table public.season_results enable row level security;

-- Public read, no write policy at all - the votes precedent. RLS enabled
-- with zero policies for a given command means every row implicitly fails
-- that command (default false), independent of table-level GRANTs. All
-- writes happen through run_season_transition() (SECURITY DEFINER,
-- bypasses RLS).
create policy "season_results are publicly readable" on public.season_results
  for select using (true);

-- ============================================================
-- 4. votes additions
-- ============================================================

alter table public.votes
  add column season_id uuid references public.seasons(id),
  -- Same before/after-snapshot philosophy as the existing rating columns:
  -- stored now (cheap) so a future all-time ranking-history chart never
  -- needs a backfill. Nullable: existing rows predate all_time_rating's
  -- existence and are deliberately left null rather than fabricated -
  -- consistent with never reconstructing history after the fact.
  add column winner_all_time_rating_before integer check (winner_all_time_rating_before >= 0),
  add column loser_all_time_rating_before  integer check (loser_all_time_rating_before  >= 0),
  add column winner_all_time_rating_after  integer check (winner_all_time_rating_after  >= 0),
  add column loser_all_time_rating_after   integer check (loser_all_time_rating_after   >= 0);

create index votes_season_idx on public.votes (season_id);

-- ============================================================
-- 5. cast_vote - replaced with all_time_rating + season_id support,
--    plus a retroactive EXECUTE-privilege fix (see below)
-- ============================================================

-- SECURITY FIX, found while designing this migration: Postgres grants
-- EXECUTE on newly created functions to PUBLIC by default (unlike tables,
-- which grant nothing by default). 0007 granted cast_vote to
-- `authenticated` but never explicitly revoked the default PUBLIC grant -
-- so despite that migration's comment ("not granted to anon at all"),
-- cast_vote has been callable by the anon role at the database-permission
-- level since it shipped. Only the in-function `auth.uid() is null` check
-- has actually been stopping anonymous calls - it worked as a safety net,
-- but the stated grant-level posture was wrong. Fixing it here.
--
-- Explicit DROP first: `create or replace function` cannot change a
-- function's return type when it's defined by RETURNS TABLE (...) / OUT
-- parameters - Postgres requires the old signature to be dropped before a
-- new one with different output columns can be created.
drop function if exists public.cast_vote(uuid, uuid);

create function public.cast_vote(
  p_winner_product_id uuid,
  p_loser_product_id uuid
)
returns table (
  winner_rating_before integer,
  loser_rating_before integer,
  winner_rating_after integer,
  loser_rating_after integer,
  winner_all_time_rating_before integer,
  loser_all_time_rating_before integer,
  winner_all_time_rating_after integer,
  loser_all_time_rating_after integer
)
language plpgsql
security definer set search_path = public
as $$
declare
  v_voter_id      uuid := auth.uid();
  v_first_id      uuid;
  v_second_id     uuid;
  v_first         record;
  v_second        record;
  v_winner        record;
  v_loser         record;
  v_expected_win  numeric;
  v_k_winner      integer;
  v_k_loser       integer;
  v_delta_winner  numeric;
  v_delta_loser   numeric;
  v_new_winner    integer;
  v_new_loser     integer;
  v_new_winner_all_time integer;
  v_new_loser_all_time  integer;
  v_recent_votes  integer;
  v_season_id     uuid;
begin
  if v_voter_id is null then
    raise exception 'You must be signed in to vote.' using errcode = '28000';
  end if;

  if p_winner_product_id = p_loser_product_id then
    raise exception 'A product cannot be matched against itself.' using errcode = '22023';
  end if;

  select count(*) into v_recent_votes
  from public.votes
  where voter_id = v_voter_id and created_at > now() - interval '1 hour';

  if v_recent_votes >= 60 then
    raise exception 'You are voting too quickly - try again in a bit.' using errcode = '55006';
  end if;

  if exists (
    select 1 from public.votes
    where voter_id = v_voter_id
      and created_at > now() - interval '24 hours'
      and ((winner_product_id = p_winner_product_id and loser_product_id = p_loser_product_id)
        or (winner_product_id = p_loser_product_id and loser_product_id = p_winner_product_id))
  ) then
    raise exception 'You already voted on this matchup recently.' using errcode = '22023';
  end if;

  -- Shared advisory lock: any number of concurrent cast_vote calls can
  -- hold this simultaneously. run_season_transition() takes the exclusive
  -- form of the same key before its bulk rating reset, which (a) waits
  -- for every currently in-flight vote to finish, and (b) blocks any new
  -- vote from proceeding past this point until the transition's
  -- transaction commits. This is what makes the transition's bulk reset
  -- safe without relying on row-lock acquisition order for a query that
  -- touches the whole products table.
  perform pg_advisory_xact_lock_shared(8675309121);

  -- Lock both product rows in a stable (id-ordered) sequence, regardless
  -- of which one "won". Prevents deadlock + lost updates under concurrent
  -- votes touching overlapping products - verified live with 10
  -- concurrent votes on the same pair (before/after values chained
  -- perfectly, zero lost updates).
  if p_winner_product_id < p_loser_product_id then
    v_first_id := p_winner_product_id; v_second_id := p_loser_product_id;
  else
    v_first_id := p_loser_product_id; v_second_id := p_winner_product_id;
  end if;

  select id, rating, all_time_rating, battles_count, maker_id, status into v_first
    from public.products where id = v_first_id for update;
  select id, rating, all_time_rating, battles_count, maker_id, status into v_second
    from public.products where id = v_second_id for update;

  if v_first.id is null or v_second.id is null then
    raise exception 'One of these products no longer exists.' using errcode = 'P0002';
  end if;

  if v_first.status <> 'published' or v_second.status <> 'published' then
    raise exception 'Both products must be published to be voted on.' using errcode = '22023';
  end if;

  if v_first.maker_id = v_voter_id or v_second.maker_id = v_voter_id then
    raise exception 'You cannot vote on a matchup that includes your own product.' using errcode = '42501';
  end if;

  -- Looked up only now (after both product-row locks resolve), not at the
  -- top of the function: the product-row locks are the actual
  -- synchronization point against run_season_transition()'s exclusive
  -- advisory lock, so a vote that blocked here during a transition is
  -- guaranteed - by that lock forcing full serialization - to see fully
  -- post-transition state by the time it reaches this line. That keeps
  -- the season_id stamped on the vote always consistent with whichever
  -- season's rating baseline this vote's own math used. No exception if
  -- null: voting is the core product function and must not become
  -- fragile against an operational/cron concern.
  select id into v_season_id from public.seasons where status = 'active' limit 1;

  if v_first.id = p_winner_product_id then
    v_winner := v_first; v_loser := v_second;
  else
    v_winner := v_second; v_loser := v_first;
  end if;

  -- Standard Elo. Provisional K (48 while a product has fewer than 10
  -- recorded battles, 24 after) captures "a new product's own rating
  -- swings more" independently of the upset itself. battles_count is a
  -- true lifetime counter (does not reset per season - see migration
  -- notes), which keeps this single K/delta computation valid for both
  -- the season and all-time tracks.
  v_expected_win := 1.0 / (1.0 + power(10.0, (v_loser.rating - v_winner.rating) / 400.0));
  v_k_winner := case when v_winner.battles_count < 10 then 48 else 24 end;
  v_k_loser  := case when v_loser.battles_count  < 10 then 48 else 24 end;

  -- Same delta applied to both rating and all_time_rating (decision:
  -- all_time_rating is not an independently-computed parallel Elo track -
  -- it moves by exactly what this vote's Elo math produced, so the two
  -- can never disagree about what a given vote meant).
  v_delta_winner := v_k_winner * (1 - v_expected_win);
  v_delta_loser  := -v_k_loser * (1 - v_expected_win);

  -- greatest(0, ...): defensive floor clamp, not an expected code path
  -- (see 0007 for why this is self-limiting under normal play). Each
  -- track's clamp is independent, since a product's season rating and
  -- all-time rating can legitimately sit at different distances from 0.
  v_new_winner := greatest(0, round(v_winner.rating + v_delta_winner)::integer);
  v_new_loser  := greatest(0, round(v_loser.rating  + v_delta_loser)::integer);
  v_new_winner_all_time := greatest(0, round(v_winner.all_time_rating + v_delta_winner)::integer);
  v_new_loser_all_time  := greatest(0, round(v_loser.all_time_rating  + v_delta_loser)::integer);

  update public.products
    set rating = v_new_winner, battles_count = v_winner.battles_count + 1,
        all_time_rating = v_new_winner_all_time
    where id = v_winner.id;

  update public.products
    set rating = v_new_loser, battles_count = v_loser.battles_count + 1,
        all_time_rating = v_new_loser_all_time
    where id = v_loser.id;

  insert into public.votes (
    voter_id, winner_product_id, loser_product_id,
    winner_rating_before, loser_rating_before, winner_rating_after, loser_rating_after,
    season_id,
    winner_all_time_rating_before, loser_all_time_rating_before,
    winner_all_time_rating_after, loser_all_time_rating_after
  ) values (
    v_voter_id, v_winner.id, v_loser.id,
    v_winner.rating, v_loser.rating, v_new_winner, v_new_loser,
    v_season_id,
    v_winner.all_time_rating, v_loser.all_time_rating,
    v_new_winner_all_time, v_new_loser_all_time
  );

  return query select
    v_winner.rating, v_loser.rating, v_new_winner, v_new_loser,
    v_winner.all_time_rating, v_loser.all_time_rating,
    v_new_winner_all_time, v_new_loser_all_time;
end;
$$;

revoke execute on function public.cast_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_vote(uuid, uuid) to authenticated;

-- ============================================================
-- 6. run_season_transition
-- ============================================================

create or replace function public.run_season_transition()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_season_id      uuid;
  v_ends_at        timestamptz;
  v_next_number    integer;
begin
  -- Lock the active season row. This is the single serialization point
  -- that makes the whole function idempotent under concurrent/retried
  -- calls: a second invocation blocks here until the first commits, then
  -- its own fresh select finds the season the first call just created
  -- (active, ends_at ~1 month out) - the ends_at > now() guard below then
  -- makes it a clean no-op. No double-transition is possible.
  select id, ends_at into v_season_id, v_ends_at
  from public.seasons
  where status = 'active'
  for update;

  if v_season_id is null then
    -- Defensive only: the bootstrap insert above guarantees there is
    -- always exactly one active season from this migration onward. Fail
    -- soft rather than raising, so a scheduling anomaly can't turn into a
    -- hard error that alarms/retries pg_cron indefinitely.
    raise warning 'run_season_transition: no active season found';
    return;
  end if;

  if v_ends_at > now() then
    return; -- not due yet
  end if;

  -- Exclusive advisory lock: waits for every in-flight cast_vote (holding
  -- the shared form of this key) to finish, then blocks any new cast_vote
  -- from proceeding past its own lock attempt until this transaction
  -- commits. This is what makes the bulk rating reset below safe without
  -- depending on row-lock acquisition order.
  perform pg_advisory_xact_lock(8675309121);

  -- Snapshot every published product's current standing into
  -- season_results for the ending season. Both category-scoped and
  -- overall rank are computed here, matching the app's two existing
  -- leaderboard shapes. Tie-break identically to the app's existing
  -- leaderboard queries (rating desc, created_at asc) so a snapshot's
  -- rank ordering matches what the live leaderboard would have shown at
  -- that instant.
  insert into public.season_results (
    season_id, product_id, maker_id, category_slug,
    final_rating, battles_count, category_rank, overall_rank
  )
  select
    v_season_id,
    p.id,
    p.maker_id,
    p.category_slug,
    p.rating,
    p.battles_count,
    rank() over (
      partition by p.category_slug
      order by p.rating desc, p.created_at asc
    ),
    rank() over (
      order by p.rating desc, p.created_at asc
    )
  from public.products p
  where p.status = 'published';

  update public.seasons set status = 'ended' where id = v_season_id;

  -- Hard reset of the season rating only - all_time_rating and
  -- battles_count are untouched. `where true` is required, not
  -- decorative: Supabase installs pg-safeupdate by default, which
  -- rejects any UPDATE/DELETE with no WHERE clause at all (even an
  -- intentional bulk one like this) - found live when this statement
  -- errored with "UPDATE requires a WHERE clause".
  update public.products set rating = 1500 where true;

  v_next_number := (
    select season_number from public.seasons where id = v_season_id
  ) + 1;

  -- Anchor the next boundary to the *scheduled* end of the season that
  -- just ended, not to now(). The cron guard runs hourly and is a cheap
  -- no-op most of the time, so this branch can execute up to ~1 hour
  -- after the true boundary; anchoring to v_ends_at keeps monthly
  -- boundaries fixed instead of drifting later every season.
  insert into public.seasons (season_number, label, status, starts_at, ends_at)
  values (
    v_next_number,
    'Season ' || v_next_number,
    'active',
    v_ends_at,
    v_ends_at + interval '1 month'
  );
end;
$$;

-- Ops-only function - stricter posture than cast_vote, which is at least
-- reachable by any signed-in user. This must never be callable by a
-- client-facing role: if `authenticated` (or `anon`) could execute this,
-- any user could force early season transitions on demand and reset
-- every product's rating at will. Grant only to the role that owns/
-- schedules it (postgres, per the pg_cron setup below) - not to anon or
-- authenticated at all.
revoke execute on function public.run_season_transition() from public, anon, authenticated;
grant execute on function public.run_season_transition() to postgres;

-- ============================================================
-- 7. pg_cron
-- ============================================================

-- Idiomatic on Supabase: pg_cron is installed into the `extensions`
-- schema (not public), matching the Dashboard's own "Enable pg_cron"
-- flow. Supabase's managed Postgres image already has pg_cron in
-- shared_preload_libraries, so this works directly inside a migration.
create extension if not exists pg_cron with schema extensions;

-- Hourly guard is deliberately coarse: run_season_transition() is a cheap
-- no-op (one indexed row lookup) for all but one hour a month, so
-- sub-minute precision isn't worth the extra job churn. Worst case a
-- transition fires up to ~1 hour after its scheduled boundary; the
-- anti-drift anchoring above (v_ends_at, not now()) means that lag never
-- compounds across seasons.
--
-- pg_cron jobs execute as the role that scheduled them. This statement
-- runs inside a migration, which Supabase executes as `postgres` - the
-- same role EXECUTE was granted to above. run_season_transition() being
-- SECURITY DEFINER means the function body runs with the function
-- owner's privileges regardless of caller, which is why pg_cron doesn't
-- need any elevated privilege of its own - it just needs EXECUTE.
--
-- cron.schedule() upserts by job name, so re-running this migration
-- replaces the existing job rather than erroring on a duplicate.
select cron.schedule(
  'run-season-transition',
  '0 * * * *',
  $$select public.run_season_transition();$$
);
