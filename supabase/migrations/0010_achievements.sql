-- Phase 2B.3: Achievements. Event/history-based unlock records, not boolean
-- flags on makers/products - matches votes/season_results already being
-- append-only. Achievements never write to products.rating/all_time_rating/
-- battles_count, and this migration never references subscriptions/
-- payments/featured_campaigns: money must never buy competitive standing,
-- and that principle extends to achievements exactly as it does to rating.
--
-- Three separate trigger points, not one "atomic with cast_vote": battle/
-- rating achievements are genuinely vote-time events (checked inside
-- cast_vote), maker/product achievements are publish-time events (checked
-- inside createProduct's second RPC call), and season achievements
-- (Champion, Division Promotion, etc.) are deferred entirely - season_results
-- doesn't store a division column yet, so "Promotion" can't be computed
-- against real data. season_id below exists now so that follow-up needs no
-- ALTER TABLE, only new rows + a new check_* function.

-- ============================================================
-- 1. achievements (catalog)
-- ============================================================

create table public.achievements (
  code        text primary key,
  name        text not null,
  description text not null,
  icon        text not null,
  -- 'season' included now (unused this pass) so the deferred
  -- season-achievement follow-up never needs an ALTER TABLE ... ADD CHECK
  -- before it can seed a row.
  category    text not null check (category in ('competitive', 'rating', 'product', 'season')),
  scope       text not null check (scope in ('maker', 'product')),
  sort_order  integer not null default 0
);

alter table public.achievements enable row level security;
create policy "achievements are publicly readable" on public.achievements for select using (true);

insert into public.achievements (code, name, description, icon, category, scope, sort_order) values
  ('first_victory',  'First Victory',   'Win your first battle.',            '🏆', 'competitive', 'maker',   1),
  ('victories_10',   '10 Victories',    'Win 10 battles.',                   '⚔️', 'competitive', 'maker',   2),
  ('victories_50',   '50 Victories',    'Win 50 battles.',                   '🗡️', 'competitive', 'maker',   3),
  ('battles_100',    '100 Battles',     'Compete in 100 battles.',           '🎖️', 'competitive', 'maker',   4),
  ('win_streak_5',   '5-Win Streak',    'Win 5 battles in a row.',           '🔥', 'competitive', 'maker',   5),
  ('win_streak_10',  '10-Win Streak',   'Win 10 battles in a row.',          '🚀', 'competitive', 'maker',   6),
  ('rating_1600',    'Rating 1600',     'Reach a 1600 all-time rating.',     '📈', 'rating',       'product', 7),
  ('rating_1700',    'Rating 1700',     'Reach a 1700 all-time rating.',     '📊', 'rating',       'product', 8),
  ('rating_1800',    'Rating 1800',     'Reach a 1800 all-time rating.',     '⭐', 'rating',       'product', 9),
  ('rating_1900',    'Rating 1900',     'Reach a 1900 all-time rating.',     '🌟', 'rating',       'product', 10),
  ('first_product',  'First Product',   'Publish your first product.',       '🎉', 'product',      'maker',   11),
  ('products_3',     '3 Products',      'Publish 3 products.',               '🏗️', 'product',      'maker',   12),
  ('products_5',     '5 Products',      'Publish 5 products.',               '🏭', 'product',      'maker',   13);

-- ============================================================
-- 2. maker_achievements (unlock records)
-- ============================================================

create table public.maker_achievements (
  id               uuid primary key default gen_random_uuid(),
  -- CASCADE, deliberately unlike votes/season_results' no-cascade posture:
  -- an achievement is a personal record about the account itself, not a
  -- competitive-integrity record another party's history depends on the
  -- way an opponent's vote row must survive that opponent's own account
  -- deletion. Losing your own achievement shelf when you delete your
  -- account is correct, not a loss of someone else's history.
  maker_id         uuid not null references public.makers(id) on delete cascade,
  achievement_code text not null references public.achievements(code),
  -- Set for product-scoped unlocks (rating milestones), null for
  -- maker-scoped ones. No ON DELETE clause on product_id/season_id -
  -- matches votes/season_results (products/seasons are never hard-deleted).
  product_id       uuid references public.products(id),
  -- Present now, unused until the deferred season-achievement follow-up -
  -- that follow-up needs no ALTER TABLE, just new rows + a new check_*
  -- function.
  season_id        uuid references public.seasons(id),
  unlocked_at      timestamptz not null default now(),
  metadata         jsonb not null default '{}'::jsonb
);

-- Three different uniqueness rules for three different scopes - partial
-- unique indexes (matching seasons_single_active_idx's precedent) instead
-- of one all-purpose constraint that would need null-coalescing hacks.
create unique index maker_achievements_maker_scope_idx
  on public.maker_achievements (maker_id, achievement_code)
  where product_id is null and season_id is null;

create unique index maker_achievements_product_scope_idx
  on public.maker_achievements (product_id, achievement_code)
  where product_id is not null and season_id is null;

-- Not used by anything seeded this pass - defined now purely so the
-- deferred season-achievement follow-up needs no migration for uniqueness
-- itself. Whether a season achievement ends up maker-scoped ("Season
-- Champion") or product-scoped (a per-product "Division Champion", which
-- would need product_id in this index instead) is exactly the kind of
-- decision that follow-up resolves, not this one.
create unique index maker_achievements_season_scope_idx
  on public.maker_achievements (maker_id, achievement_code, season_id)
  where season_id is not null;

create index maker_achievements_maker_idx on public.maker_achievements (maker_id, unlocked_at desc);
create index maker_achievements_product_idx on public.maker_achievements (product_id, unlocked_at desc) where product_id is not null;

alter table public.maker_achievements enable row level security;

-- Public read (bragging rights, meant for profiles), no write policy at all -
-- the votes precedent. RLS enabled with zero policies for a given command
-- means every row implicitly fails that command (default false), independent
-- of table-level GRANTs. All writes go through the two SECURITY DEFINER
-- functions below.
create policy "maker_achievements are publicly readable" on public.maker_achievements for select using (true);

-- ============================================================
-- 3. check_battle_achievements - vote-time trigger (competitive + rating)
-- ============================================================

-- Longest-streak-ever semantic, not "current active streak": every other
-- achievement here is a permanent one-time unlock, and this schema has no
-- un-earn mechanism, so "current streak" would be the only mutable/
-- re-checkable stat in the whole catalog. "Longest ever achieved" is the
-- only semantic consistent with everything else.
--
-- A maker can own multiple products, and get_random_pairing only excludes
-- the *viewer's* own products from a pairing - it does nothing to stop two
-- products owned by the *same other* maker from being randomly paired and
-- voted on by a third party. A naive join of votes to products on maker_id
-- would then produce two contradictory rows for one single vote (a "win"
-- via the winner-side join and a "loss" via the loser-side join, at the
-- identical timestamp) - corrupting win/battle counts and the win-streak
-- grouping. Every query below excludes any vote where *both* sides belong
-- to the maker's own product set.
create or replace function public.check_battle_achievements(
  p_maker_id uuid, p_product_id uuid, p_won boolean
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_product_ids  uuid[];
  v_win_count    integer;
  v_battle_count integer;
  v_streak       integer;
  v_all_time     integer;
begin
  select coalesce(array_agg(id), '{}') into v_product_ids from public.products where maker_id = p_maker_id;

  select count(*) into v_battle_count from public.votes
  where (winner_product_id = any(v_product_ids) and loser_product_id <> all(v_product_ids))
     or (loser_product_id  = any(v_product_ids) and winner_product_id <> all(v_product_ids));

  insert into public.maker_achievements (maker_id, achievement_code, metadata)
  select p_maker_id, 'battles_100', jsonb_build_object('battles', v_battle_count)
  where v_battle_count >= 100
  on conflict (maker_id, achievement_code) where product_id is null and season_id is null do nothing;

  if not p_won then
    return; -- a loss can never newly cross a win-count, streak, or rating threshold
  end if;

  select count(*) into v_win_count from public.votes
  where winner_product_id = any(v_product_ids) and loser_product_id <> all(v_product_ids);

  insert into public.maker_achievements (maker_id, achievement_code, metadata)
  select p_maker_id, t.code, jsonb_build_object('wins', v_win_count)
  from (values ('first_victory',1),('victories_10',10),('victories_50',50)) as t(code, threshold)
  where v_win_count >= t.threshold
  on conflict (maker_id, achievement_code) where product_id is null and season_id is null do nothing;

  with maker_votes as (
    select created_at, id, true as won from public.votes
    where winner_product_id = any(v_product_ids) and loser_product_id <> all(v_product_ids)
    union all
    select created_at, id, false as won from public.votes
    where loser_product_id = any(v_product_ids) and winner_product_id <> all(v_product_ids)
  ),
  grouped as (
    -- (created_at, id) tie-break in both row_number() calls, must match
    -- exactly for the grouping trick to hold - id guards exact-timestamp
    -- ties, which are plausible given this codebase's own verified
    -- 10-concurrent-vote test in Phase 2A.
    select won, row_number() over (order by created_at, id) - row_number() over (partition by won order by created_at, id) as grp
    from maker_votes
  )
  select coalesce(max(streak_len), 0) into v_streak
  from (select count(*) as streak_len from grouped where won group by grp) s;

  insert into public.maker_achievements (maker_id, achievement_code, metadata)
  select p_maker_id, t.code, jsonb_build_object('streak', v_streak)
  from (values ('win_streak_5',5),('win_streak_10',10)) as t(code, threshold)
  where v_streak >= t.threshold
  on conflict (maker_id, achievement_code) where product_id is null and season_id is null do nothing;

  -- Pinned to all_time_rating (never resets), not season `rating` - a
  -- permanent badge tied to a value that resets to 1500 every month would
  -- be conceptually wrong. Read fresh (not caller-supplied) since this runs
  -- after cast_vote's own UPDATE of this row.
  select all_time_rating into v_all_time from public.products where id = p_product_id;

  insert into public.maker_achievements (maker_id, achievement_code, product_id, metadata)
  select p_maker_id, t.code, p_product_id, jsonb_build_object('all_time_rating', v_all_time)
  from (values ('rating_1600',1600),('rating_1700',1700),('rating_1800',1800),('rating_1900',1900)) as t(code, threshold)
  where v_all_time >= t.threshold
  on conflict (product_id, achievement_code) where product_id is not null and season_id is null do nothing;
end;
$$;

-- Ops-internal only: no legitimate client ever calls this directly (it
-- operates on arbitrary OTHER makers - winner AND loser, who by cast_vote's
-- own self-vote check are never the caller). Reachable only from inside
-- cast_vote's body - because cast_vote is itself SECURITY DEFINER, that
-- internal call executes as cast_vote's owner (postgres), so no grant to
-- authenticated is needed for the real call path to work.
revoke execute on function public.check_battle_achievements(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.check_battle_achievements(uuid, uuid, boolean) to postgres;

-- ============================================================
-- 4. check_product_count_achievements - publish-time trigger
-- ============================================================

create or replace function public.check_product_count_achievements(p_maker_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_product_count integer;
begin
  -- Current published count, not lifetime-ever-published (accepted
  -- simplification: no status-change history exists to do better without
  -- new tracking; a later archive stops counting toward a not-yet-earned
  -- threshold).
  select count(*) into v_product_count from public.products where maker_id = p_maker_id and status = 'published';

  insert into public.maker_achievements (maker_id, achievement_code, metadata)
  select p_maker_id, t.code, jsonb_build_object('products', v_product_count)
  from (values ('first_product',1),('products_3',3),('products_5',5)) as t(code, threshold)
  where v_product_count >= t.threshold
  on conflict (maker_id, achievement_code) where product_id is null and season_id is null do nothing;
end;
$$;

-- Same EXECUTE-to-PUBLIC gap cast_vote had in 0007/0008: explicit revoke,
-- then grant only to authenticated - createProduct's Server Action calls
-- this as a genuinely separate RPC under the signed-in user's own session
-- (unlike check_battle_achievements above, this really is directly
-- client-reachable, so it needs a real grant, not just postgres).
--
-- No internal auth.uid() self-check. This function only ever *re-derives* a
-- maker's true, already-earned product count from real data - there's no
-- forgery vector in letting it be called with an arbitrary maker_id, so the
-- REVOKE/GRANT boundary alone is the real (and sufficient) control here.
-- Deliberately dropped rather than added: an auth.uid()-based self-check
-- would return null and silently no-op every call made from inside the
-- backfill below, which runs in a migration with no authenticated session.
revoke execute on function public.check_product_count_achievements(uuid) from public, anon;
grant execute on function public.check_product_count_achievements(uuid) to authenticated;

-- ============================================================
-- 5. cast_vote integration - no signature change, no DROP FUNCTION needed
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

  -- Achievement checks are wrapped in their own exception handler:
  -- achievements must never affect the core loop. If either check raises,
  -- the vote and Elo update (already committed to this transaction's work
  -- above) must still go through - a bug in the achievement system cannot
  -- be allowed to roll back an otherwise-valid vote.
  begin
    perform public.check_battle_achievements(v_winner.maker_id, v_winner.id, true);
    perform public.check_battle_achievements(v_loser.maker_id, v_loser.id, false);
  exception when others then
    raise warning 'check_battle_achievements failed: %', sqlerrm;
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
-- 6. Backfill - safe to run more than once (ON CONFLICT DO NOTHING)
-- ============================================================

do $$
declare v_maker_id uuid;
begin
  for v_maker_id in select id from public.makers loop
    perform public.check_product_count_achievements(v_maker_id);
  end loop;
end $$;

do $$
declare v_product record;
begin
  for v_product in select id, maker_id from public.products where status = 'published' loop
    perform public.check_battle_achievements(v_product.maker_id, v_product.id, true);
  end loop;
end $$;
