-- Phase 2B.4: MakerRank. The final Phase 2B gamification feature - a single
-- lifetime 0-100 score per maker, blending three already-existing signals
-- (product quality, competitive record, achievement/season history) into
-- one number. Nothing here is a new source of truth: every input
-- (products.all_time_rating, votes, maker_achievements, season_results) was
-- already computed and stored by 0007-0010. This migration only reads and
-- combines it.
--
-- LIFETIME ONLY, never resets with seasons - parallel to all_time_rating,
-- not to the season-resetting rating/division. run_season_transition()
-- never touches anything in this migration directly (though its output,
-- season_results, feeds the History branch below).

-- ============================================================
-- 1. maker_ranks
-- ============================================================

-- Stored as its own table, deliberately NOT new columns on makers.
--
-- Found while designing this migration: makers' existing UPDATE policy
-- ("user can update own maker row" on public.makers for update using
-- (auth.uid() = id), from 0003_rls_policies.sql) has no column-level
-- restriction and no revoked/re-granted column list - unlike products,
-- which 0007 explicitly locked down (revoke the broad UPDATE grant, then
-- re-grant only specific editable columns) specifically because `rating`
-- needed protecting from a direct client PATCH. Adding a
-- maker_rank_score-style column straight onto makers would silently
-- inherit that permissive owner-update policy and the default full-table
-- column grants, recreating the exact products.rating gap 0007 found and
-- fixed - except proactively introducing it here instead of discovering it
-- after the fact. A separate table sidesteps the whole class of bug: RLS
-- enabled, public SELECT, zero write policies - there is no existing
-- permissive policy on a brand-new table for a new column to accidentally
-- inherit.
--
-- Denormalizes both the score/component breakdown AND the display stats
-- the profile card needs (wins, battles, season_wins, achievements_count),
-- so rendering the card is one row read, not a second heavy aggregate
-- query on every profile view. No row for a maker at all means UNRANKED -
-- never a placeholder 0 or 50, mirroring product_divisions() excluding
-- low-battle products from its ranked population entirely rather than
-- assigning a fake division.
create table public.maker_ranks (
  -- CASCADE: this is the maker's own derived record, not another party's
  -- competitive-integrity history the way a vote row must survive an
  -- opponent's account deletion - same reasoning maker_achievements'
  -- cascade already uses.
  maker_id               uuid primary key references public.makers(id) on delete cascade,
  score                   numeric not null check (score >= 0 and score <= 100),
  product_component       numeric not null check (product_component >= 0 and product_component <= 100),
  competition_component   numeric not null check (competition_component >= 0 and competition_component <= 100),
  history_component       numeric not null check (history_component >= 0 and history_component <= 100),
  -- Self-battle-excluded lifetime totals - display stats ("64% win rate" /
  -- "143 battles"), and also the exact inputs competition_component above
  -- was computed from, kept alongside it for "why is my rank X"
  -- transparency.
  wins                    integer not null check (wins >= 0),
  battles                 integer not null check (battles >= 0),
  check (wins <= battles),
  -- category_rank=1 season_results rows lifetime (an overall_rank=1 row is
  -- always also category_rank=1 by construction of run_season_transition's
  -- ranking query, so this single count already includes overall wins -
  -- see recompute_maker_rank's comment). Feeds the "🏆 2 Season wins"
  -- display stat.
  season_wins             integer not null check (season_wins >= 0),
  -- Distinct maker_achievements row count, for the "8 achievements" stat.
  achievements_count      integer not null check (achievements_count >= 0),
  -- Also the concurrency guard - see recompute_maker_rank() below.
  computed_at             timestamptz not null default now()
);

-- Supports maker_rank_positions()'s order-by-score, and any future
-- "top N makers" query that doesn't go through that function.
create index maker_ranks_score_idx on public.maker_ranks (score desc);

alter table public.maker_ranks enable row level security;

-- Public read (this is the whole point of a *rank* - it's bragging
-- rights), zero write policies - the votes/season_results/
-- maker_achievements precedent. RLS enabled with no policy for a given
-- command means every row implicitly fails that command, independent of
-- table-level GRANTs. The only write path is recompute_maker_rank()
-- below, SECURITY DEFINER, bypasses RLS.
create policy "maker_ranks are publicly readable" on public.maker_ranks
  for select using (true);

-- ============================================================
-- 2. recompute_maker_rank - concurrency posture
-- ============================================================
--
-- No row locking anywhere in this function - no pg_advisory_xact_lock, no
-- `for update`, unlike cast_vote (shared advisory lock + row locks) and
-- run_season_transition (exclusive advisory lock). Deliberate contrast, not
-- an oversight a future engineer should "fix":
--
-- cast_vote's products.rating is an *accumulative* +delta UPDATE - a lost
-- concurrent write there permanently discards a real rating change that
-- can never be reconstructed, which is exactly why it needs id-ordered row
-- locks. MakerRank's score is the opposite: a pure function of already-
-- durable source data (votes, products, maker_achievements, season_results)
-- that gets fully recomputed from scratch on every call, never
-- incremented. Two concurrent recomputes for the same maker (e.g. two of
-- their products each winning a battle in unrelated concurrent cast_vote
-- calls) each independently compute a complete, internally-consistent
-- snapshot of that instant; whichever commits last simply overwrites with
-- its own equally-valid computation. Nothing is discarded that isn't
-- immediately re-derivable from source data on the very next trigger, or
-- the daily cron safety net below - this is transient snapshot staleness,
-- not a lost-update bug, and is an acceptable self-correcting race.
--
-- The ONE real risk this function guards against: an *out-of-order* write
-- - e.g. a slow cron-triggered recompute finishing after a newer
-- vote-triggered recompute already wrote fresher data, clobbering it with
-- stale data. `insert ... on conflict (maker_id) do update ... where
-- maker_ranks.computed_at < excluded.computed_at` (a monotonic-timestamp
-- guard) is sufficient for that alone - the older write's UPDATE branch
-- simply matches zero rows and is silently a no-op. The DELETE branch
-- (maker just dropped to zero eligible products) needs the identical
-- guard, for the identical reason.
create or replace function public.recompute_maker_rank(p_maker_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_now                    timestamptz := now();
  v_eligible_count          integer;
  v_product_raw             numeric;
  v_product_component       numeric;
  v_product_ids             uuid[];
  v_wins                    integer;
  v_battles                 integer;
  v_shrunk_rate             numeric;
  v_volume_bonus            numeric;
  v_competition_component   numeric;
  v_achievements_count      integer;
  v_season_wins             integer;
  v_overall_wins            integer;
  v_season_points           integer;
  v_h_raw                   numeric;
  v_history_component       numeric;
  v_score                   numeric;
begin
  -- Product branch: top-3 avg all_time_rating among this maker's currently
  -- eligible products - published + battles_count >= 10, the identical bar
  -- the Elo K-factor (cast_vote) and product_divisions() already use.
  -- `order by ... limit 3` alone is sufficient: already proven by
  -- simulation that a maker with [1900,1700,1500,1300,1100] scores
  -- identically to one with only the top 3 published, so there is nothing
  -- beyond rank 3 this query needs to see.
  select count(*), avg(all_time_rating)
    into v_eligible_count, v_product_raw
  from (
    select all_time_rating
    from public.products
    where maker_id = p_maker_id
      and status = 'published'
      and battles_count >= 10
    order by all_time_rating desc
    limit 3
  ) top3;

  if coalesce(v_eligible_count, 0) = 0 then
    -- UNRANKED: zero eligible products. Delete any existing row instead of
    -- leaving a stale one. Guarded by v_now (captured once, at the top of
    -- this call) for the identical out-of-order reason as the upsert
    -- below: without the guard, a delayed/slow invocation of this branch
    -- could wipe out a row a fresher concurrent call already re-established
    -- (e.g. the maker regained eligibility in the meantime).
    delete from public.maker_ranks
    where maker_id = p_maker_id and computed_at < v_now;
    return;
  end if;

  -- Same logistic-400 curve cast_vote already uses for expected score,
  -- anchored at the 1500 starting rating.
  v_product_component := 100.0 / (1 + power(10.0, (1500 - v_product_raw) / 400.0));

  -- Competition branch: lifetime wins/battles, self-battles excluded.
  -- Exact query shape as check_battle_achievements() in 0010 - see that
  -- function's comment for why a naive join of votes to products on
  -- maker_id is wrong (two products of the same *other* maker can be
  -- randomly paired against each other and voted on by a third party,
  -- which would otherwise produce a contradictory win-row and loss-row for
  -- one single vote). Deliberately uses ALL of this maker's products
  -- regardless of status, not just the top-3 eligible set above - this is
  -- the maker's whole lifetime competitive record (a product that's since
  -- been archived still keeps its battle history), a different question
  -- from "which products currently represent their portfolio quality."
  select coalesce(array_agg(id), '{}') into v_product_ids
  from public.products where maker_id = p_maker_id;

  select count(*) into v_battles from public.votes
  where (winner_product_id = any(v_product_ids) and loser_product_id <> all(v_product_ids))
     or (loser_product_id  = any(v_product_ids) and winner_product_id <> all(v_product_ids));

  select count(*) into v_wins from public.votes
  where winner_product_id = any(v_product_ids) and loser_product_id <> all(v_product_ids);

  -- Locked constants: C=30 (shrinkage strength - trust a maker's own win
  -- rate about as much as 30 battles' worth of a neutral 50/50 prior would
  -- deserve), V_max=500 (battle count at which the volume bonus
  -- saturates), w_vol=0.18 (how much of the competition score is volume
  -- vs. shrunk win rate). C in the denominator also means this never
  -- divides by zero even at battles=0.
  v_shrunk_rate  := (v_wins + 30 * 0.5) / (v_battles + 30);
  v_volume_bonus := least(1.0, ln(1 + v_battles) / ln(1 + 500));
  v_competition_component := 100 * ((1 - 0.18) * v_shrunk_rate + 0.18 * v_volume_bonus);

  -- History branch. Achievement count is a plain row count - every
  -- maker_achievements row is already a distinct unlock event (enforced by
  -- 0010's per-scope partial unique indexes), so no separate "distinct"
  -- step is needed.
  select count(*) into v_achievements_count
  from public.maker_achievements where maker_id = p_maker_id;

  -- Season wins computed directly from the EXISTING season_results table
  -- (0008) - no dependency on the deferred season-achievement catalog rows
  -- 0010 left unbuilt. category_rank=1 already includes every
  -- overall_rank=1 case (an overall win strictly implies a category win in
  -- the same season, since overall_rank ranks the same products with no
  -- category partition - a platform-wide #1 is certainly a #1 within its
  -- own category too), so overall wins get the +5 without being counted
  -- twice as a separate population.
  select
    coalesce(count(*) filter (where category_rank = 1), 0),
    coalesce(count(*) filter (where overall_rank = 1), 0)
    into v_season_wins, v_overall_wins
  from public.season_results where maker_id = p_maker_id;

  v_season_points := v_season_wins * 3 + v_overall_wins * 5;
  v_h_raw := v_achievements_count + v_season_points;

  -- H_cap=20, locked: deliberately leaves headroom for future achievement
  -- catalog growth so H can never be fully saturated by the current
  -- 13-achievement catalog alone (maxes at 13/20 = 65% from achievements
  -- alone, leaving room for season points).
  v_history_component := 100 * least(1.0, v_h_raw / 20.0);

  v_score := 0.60 * v_product_component + 0.25 * v_competition_component + 0.15 * v_history_component;

  insert into public.maker_ranks (
    maker_id, score, product_component, competition_component, history_component,
    wins, battles, season_wins, achievements_count, computed_at
  ) values (
    p_maker_id, round(v_score, 2), round(v_product_component, 2),
    round(v_competition_component, 2), round(v_history_component, 2),
    v_wins, v_battles, v_season_wins, v_achievements_count, v_now
  )
  on conflict (maker_id) do update set
    score                  = excluded.score,
    product_component      = excluded.product_component,
    competition_component  = excluded.competition_component,
    history_component      = excluded.history_component,
    wins                   = excluded.wins,
    battles                = excluded.battles,
    season_wins            = excluded.season_wins,
    achievements_count     = excluded.achievements_count,
    computed_at             = excluded.computed_at
  -- Monotonic-timestamp guard (see function-level comment above): an
  -- out-of-order write becomes a no-op UPDATE instead of clobbering
  -- fresher data.
  where public.maker_ranks.computed_at < excluded.computed_at;
end;
$$;

-- Same EXECUTE-to-PUBLIC gap history this codebase has now found twice
-- (0008 for cast_vote, 0010 for the achievement functions): explicit
-- revoke, then grant only to authenticated. No auth.uid()-based self-check
-- on p_maker_id - same reasoning as check_product_count_achievements in
-- 0010: this function only ever re-derives a maker's TRUE state from
-- already-public, authoritative data - there is no data-forgery vector in
-- letting it be called with an arbitrary maker_id. This also lets it be
-- called BOTH directly via RPC (createProduct's Server Action) AND from
-- inside cast_vote's SECURITY DEFINER body below (that internal call runs
-- as cast_vote's owner regardless of this function's own grants).
--
-- ACCEPTED TRADE-OFF, not silently decided: unlike check_product_count_
-- achievements (a single cheap count), this function runs several real
-- aggregate scans and has no rate limit, unlike cast_vote's explicit
-- 60/hour cap - a malicious authenticated user could call this repeatedly
-- for arbitrary maker_ids at real DB cost. Accepted as the same risk class
-- as product_divisions()'s already-accepted full-population scan (and
-- gated behind requiring a real, email-verified account, unlike that
-- function's anon-callable exposure) rather than building new
-- rate-limiting infrastructure for one function. Revisit if this becomes a
-- real problem - either a self-only check (sacrifices the dual call-path
-- design) or a statement-level rate limit.
revoke execute on function public.recompute_maker_rank(uuid) from public, anon;
grant execute on function public.recompute_maker_rank(uuid) to authenticated;

-- ============================================================
-- 3. maker_rank_positions - live leaderboard-position query
-- ============================================================
--
-- Directly modeled on product_divisions() in 0009: same
-- row_number()-over(...)-count(*)-over() shape, `language sql stable
-- security invoker`. Cheap despite touching every ranked maker, because it
-- only sorts the ALREADY-MATERIALIZED score column in maker_ranks - the
-- expensive part (scanning votes/products/maker_achievements/
-- season_results per maker) is exactly what recompute_maker_rank() already
-- materialized ahead of time. This function just orders the result.
--
-- Tie-break: score desc, then the maker's account creation date asc - the
-- same "earlier wins a tie" convention products.created_at already uses in
-- every leaderboard/pairing query in this app. Deliberately NOT
-- maker_ranks.computed_at, which reflects operationally-irrelevant
-- recompute timing, not anything about the maker - using it would make
-- tied makers reshuffle position on every unrelated recompute.
create or replace function public.maker_rank_positions()
returns table (
  maker_id      uuid,
  rank_position integer,
  score         numeric,
  population    integer
)
language sql
stable
security invoker
as $$
  select
    mr.maker_id,
    (row_number() over (order by mr.score desc, m.created_at asc))::integer as rank_position,
    mr.score,
    (count(*) over ())::integer as population
  from public.maker_ranks mr
  join public.makers m on m.id = mr.maker_id;
$$;

-- No revoke needed - same reasoning product_divisions() and
-- get_random_pairing() already used: this only ever surfaces
-- already-public data (maker_ranks is fully public-SELECT above), so the
-- default posture already matches the intended one.
grant execute on function public.maker_rank_positions() to anon, authenticated;

-- ============================================================
-- 4. cast_vote integration - no signature change, no DROP FUNCTION needed
-- ============================================================

create or replace function public.cast_vote(
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

  perform pg_advisory_xact_lock_shared(8675309121);

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

  select id into v_season_id from public.seasons where status = 'active' limit 1;

  if v_first.id = p_winner_product_id then
    v_winner := v_first; v_loser := v_second;
  else
    v_winner := v_second; v_loser := v_first;
  end if;

  v_expected_win := 1.0 / (1.0 + power(10.0, (v_loser.rating - v_winner.rating) / 400.0));
  v_k_winner := case when v_winner.battles_count < 10 then 48 else 24 end;
  v_k_loser  := case when v_loser.battles_count  < 10 then 48 else 24 end;

  v_delta_winner := v_k_winner * (1 - v_expected_win);
  v_delta_loser  := -v_k_loser * (1 - v_expected_win);

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

  -- Achievement + MakerRank checks share one exception handler: neither
  -- must ever affect the core loop. If any of them raises, the vote and
  -- Elo update (already committed to this transaction's work above) must
  -- still go through.
  begin
    perform public.check_battle_achievements(v_winner.maker_id, v_winner.id, true);
    perform public.check_battle_achievements(v_loser.maker_id, v_loser.id, false);
    -- Both winner AND loser, unlike check_battle_achievements' short-circuit
    -- on a loss: MakerRank's competition branch depends on wins AND
    -- battles, so a loss changes it too (shrunk win rate and volume bonus
    -- both move even when nothing new unlocks).
    perform public.recompute_maker_rank(v_winner.maker_id);
    perform public.recompute_maker_rank(v_loser.maker_id);
  exception when others then
    raise warning 'post-vote achievement/rank checks failed: %', sqlerrm;
  end;

  return query select
    v_winner.rating, v_loser.rating, v_new_winner, v_new_loser,
    v_winner.all_time_rating, v_loser.all_time_rating,
    v_new_winner_all_time, v_new_loser_all_time;
end;
$$;

revoke execute on function public.cast_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_vote(uuid, uuid) to authenticated;

-- ============================================================
-- 5. recompute_all_maker_ranks - daily cron safety net
-- ============================================================
--
-- Closes TWO gaps the triggers above leave, not one:
--   (a) archiving a product fires no hook at all today - there is no
--       archiveProduct Server Action in this codebase yet (only
--       createProduct's insert ever sets status), though a maker CAN PATCH
--       their own product's status to 'archived' directly via REST today
--       (status is in 0007's re-granted UPDATE column list) - a maker
--       whose only eligible product gets archived this way would otherwise
--       keep a stale row forever.
--   (b) run_season_transition() is NOT wired to call recompute_maker_rank
--       - a maker who just earned a new season_results row (a fresh
--       category/overall win) won't have their history_component reflect
--       it until their next vote/publish trigger, or this cron. Bounded to
--       at most ~24h staleness after a season ends (seasons transition
--       monthly), which this cron closes - do not remove this job if an
--       archiveProduct action is ever built with its own trigger hook;
--       reason (b) is independent of reason (a).
--
-- Iterates the UNION of two populations, not just one - neither alone is
-- sufficient: every maker with at least one currently-eligible product
-- (picks up new qualifiers), union every maker who already has a
-- maker_ranks row regardless of current eligibility (catches an
-- eligibility *loss*, letting the DELETE branch above retire a stale row).
create or replace function public.recompute_all_maker_ranks()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_maker_id uuid;
begin
  for v_maker_id in
    select maker_id from public.maker_ranks
    union
    select distinct maker_id from public.products
    where status = 'published' and battles_count >= 10
  loop
    perform public.recompute_maker_rank(v_maker_id);
  end loop;
end;
$$;

-- Ops-only, same posture as run_season_transition: never callable by
-- anon/authenticated.
revoke execute on function public.recompute_all_maker_ranks() from public, anon, authenticated;
grant execute on function public.recompute_all_maker_ranks() to postgres;

-- Daily, not hourly like run_season_transition's guard: that guard is a
-- cheap no-op for all but one hour a month, so hourly polling is nearly
-- free. A full MakerRank recompute is genuinely expensive *every single
-- time* it fires (a per-maker scan across the union population above) -
-- hourly would mean paying that cost 24x more than needed for a feature
-- with no minute-level freshness requirement (vote-time and publish-time
-- triggers already keep the common cases fresh in real time; this is
-- purely the archive-gap and season-transition-lag backstop).
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'recompute-maker-ranks',
  '17 3 * * *', -- daily at 03:17 UTC (off-peak, off the :00 mark)
  $$select public.recompute_all_maker_ranks();$$
);

-- ============================================================
-- 6. Backfill - safe to run more than once (upsert/delete both guarded by
--    the monotonic computed_at check above)
-- ============================================================

do $$
declare v_maker_id uuid;
begin
  for v_maker_id in select id from public.makers loop
    perform public.recompute_maker_rank(v_maker_id);
  end loop;
end $$;
