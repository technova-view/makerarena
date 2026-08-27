-- TD-001 fix (see TECH_DEBT.md): cast_vote() only ever checked that the
-- VOTER doesn't own either product in a matchup - it never checked whether
-- the two products belong to the SAME maker as each other. A maker
-- controlling a second, product-less "voter" account could call cast_vote
-- directly to repeatedly score one of their own products as the winner
-- over another, legitimately moving rating/all_time_rating (and therefore
-- MakerRank's 60%-weighted product_component) with no real contest behind
-- it. Achievements (check_battle_achievements) and MakerRank
-- (recompute_maker_rank) already exclude self-battles from their OWN
-- aggregates, but that was always a downstream patch, not a fix at the
-- source - all_time_rating itself remained exploitable through this path
-- until now.
--
-- Both functions keep their exact existing signatures - CREATE OR REPLACE,
-- no DROP FUNCTION needed for either.

-- ============================================================
-- 1. cast_vote - one new integrity check
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

  -- TD-001 fix: reject regardless of who the voter is - a real contest
  -- requires two different makers' products, full stop. This is the check
  -- that actually closes the exploit (a colluding/sockpuppet third-party
  -- voter scoring a same-maker pairing); get_random_pairing() below is
  -- only the UX-side companion so a legitimate voter never organically
  -- hits this.
  if v_first.maker_id = v_second.maker_id then
    raise exception 'A maker cannot battle their own products against each other.' using errcode = '42501';
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
-- 2. get_random_pairing - UX-side companion fix
-- ============================================================
--
-- Previously `order by random() limit 2`: two independent draws, which
-- can't guarantee the two rows belong to different makers even after
-- excluding the viewer's own products (two products of the same OTHER
-- maker could still both be drawn). Rewritten as two sequential draws -
-- the second explicitly excludes the first pick's maker_id - so a
-- same-maker pairing can never be suggested by the arena in the first
-- place. This is UX-only: cast_vote's new check above is what actually
-- closes the security gap, since a pairing can still be constructed
-- through a direct RPC call that never goes through this function at all.
create or replace function public.get_random_pairing(
  p_viewer_id uuid default null,
  p_category_slug text default null
)
returns table (
  id uuid, name text, slug text, tagline text, logo_url text,
  rating integer, category_slug text
)
language sql
as $$
  with first_pick as (
    select id, name, slug, tagline, logo_url, rating, category_slug, maker_id
    from public.products
    where status = 'published'
      and (p_viewer_id is null or maker_id <> p_viewer_id)
      and (p_category_slug is null or category_slug = p_category_slug)
    order by random()
    limit 1
  ),
  second_pick as (
    select id, name, slug, tagline, logo_url, rating, category_slug
    from public.products
    where status = 'published'
      and (p_viewer_id is null or maker_id <> p_viewer_id)
      and (p_category_slug is null or category_slug = p_category_slug)
      and maker_id <> (select maker_id from first_pick)
      and id <> (select id from first_pick)
    order by random()
    limit 1
  )
  select id, name, slug, tagline, logo_url, rating, category_slug from first_pick
  union all
  select id, name, slug, tagline, logo_url, rating, category_slug from second_pick;
$$;

-- Grants unchanged from 0007 - this function's posture was never the
-- problem, only its pairing logic.
grant execute on function public.get_random_pairing(uuid, text) to anon, authenticated;
