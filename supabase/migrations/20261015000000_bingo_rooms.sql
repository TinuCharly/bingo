create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.rooms (
  id text primary key,
  name text not null,
  grid_size integer not null check (grid_size between 3 and 10),
  is_private boolean not null default false,
  owner_id uuid not null,
  status text not null default 'waiting' check (status in ('waiting', 'setup', 'playing', 'finished')),
  player_count integer not null default 0,
  current_turn_index integer not null default 0,
  current_chosen_number integer,
  setup_deadline timestamptz,
  turn_deadline timestamptz,
  winner text,
  winner_player_id uuid,
  expires_at timestamptz not null default now() + interval '2 hours',
  created_at timestamptz not null default now()
);

create table if not exists public.private_room_secrets (
  room_id text primary key references public.rooms(id) on delete cascade,
  password_hash text not null
);

create table if not exists public.room_players (
  room_id text not null references public.rooms(id) on delete cascade,
  player_id uuid not null,
  name text not null,
  seat integer not null,
  grid integer[],
  marked_numbers integer[] not null default '{}',
  turn_marked boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id, player_id),
  unique (room_id, seat)
);

create index if not exists rooms_public_waiting_idx
  on public.rooms (status, is_private, created_at)
  where status = 'waiting';
create index if not exists rooms_expiry_idx on public.rooms (expires_at);
create index if not exists room_players_room_seat_idx on public.room_players (room_id, seat);

create or replace function public.update_room_player_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_code text;
begin
  if tg_op = 'DELETE' then
    room_code := old.room_id;
  else
    room_code := new.room_id;
  end if;

  update public.rooms
  set player_count = (
    select count(*)::integer from public.room_players where room_id = room_code
  )
  where id = room_code;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists room_players_update_count on public.room_players;
create trigger room_players_update_count
after insert or delete on public.room_players
for each row execute function public.update_room_player_count();

create or replace function public.delete_expired_rooms()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rooms where expires_at <= now();
$$;

create or replace function public.list_public_rooms()
returns table (id text, name text, grid_size integer, player_count integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.delete_expired_rooms();
  return query
    select r.id, r.name, r.grid_size, r.player_count
    from public.rooms r
    where not r.is_private
      and r.status = 'waiting'
      and r.expires_at > now()
    order by r.created_at desc;
end;
$$;

create or replace function public.get_room_state(p_room_code text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'gridSize', r.grid_size,
    'isPrivate', r.is_private,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.player_id,
        'name', p.name,
        'grid', p.grid,
        'markedNumbers', p.marked_numbers,
        'hasSubmittedGrid', p.grid is not null
      ) order by p.seat)
      from public.room_players p
      where p.room_id = r.id
    ), '[]'::jsonb),
    'status', r.status,
    'currentTurnIndex', r.current_turn_index,
    'currentChosenNumber', r.current_chosen_number,
    'setupDeadline', r.setup_deadline,
    'turnDeadline', r.turn_deadline,
    'winner', r.winner,
    'winnerPlayerId', r.winner_player_id
  )
  from public.rooms r
  where r.id = p_room_code
    and r.expires_at > now();
$$;

create or replace function public.get_room(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.room_players p
    where p.room_id = p_room_code and p.player_id = auth.uid()
  ) then
    raise exception 'You are not a member of this room.';
  end if;

  return public.get_room_state(p_room_code);
end;
$$;

create or replace function public.create_room(
  p_name text,
  p_grid_size integer,
  p_is_private boolean,
  p_password text,
  p_player_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_code text := encode(extensions.gen_random_bytes(5), 'hex');
begin
  if auth.uid() is null then
    raise exception 'A player session is required.';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 50 then
    raise exception 'Room names must contain 1 to 50 characters.';
  end if;
  if p_player_name is null or length(trim(p_player_name)) not between 1 and 30 then
    raise exception 'Player names must contain 1 to 30 characters.';
  end if;
  if p_grid_size not between 3 and 10 then
    raise exception 'Grid size must be between 3 and 10.';
  end if;
  if p_is_private and (p_password is null or length(p_password) not between 1 and 100) then
    raise exception 'Private rooms require a password.';
  end if;

  insert into public.rooms (
    id, name, grid_size, is_private, owner_id
  ) values (
    room_code,
    trim(p_name),
    p_grid_size,
    p_is_private,
    auth.uid()
  );

  if p_is_private then
    insert into public.private_room_secrets (room_id, password_hash)
    values (room_code, extensions.crypt(p_password, extensions.gen_salt('bf')));
  end if;

  insert into public.room_players (room_id, player_id, name, seat)
  values (room_code, auth.uid(), trim(p_player_name), 0);

  return room_code;
end;
$$;

create or replace function public.join_room(
  p_room_code text,
  p_player_name text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms%rowtype;
  existing public.room_players%rowtype;
  password_hash text;
  next_seat integer;
begin
  if auth.uid() is null then
    raise exception 'A player session is required.';
  end if;
  if p_player_name is null or length(trim(p_player_name)) not between 1 and 30 then
    raise exception 'Player names must contain 1 to 30 characters.';
  end if;

  select * into target from public.rooms where id = lower(trim(p_room_code)) for update;
  if not found or target.expires_at <= now() then
    raise exception 'Room not found or expired.';
  end if;

  select * into existing from public.room_players
  where room_id = target.id and player_id = auth.uid();
  if found then
    return public.get_room_state(target.id);
  end if;

  if target.status <> 'waiting' then
    raise exception 'Game already started.';
  end if;
  if target.is_private then
    select s.password_hash into password_hash
    from public.private_room_secrets s
    where s.room_id = target.id;
    if password_hash is null or p_password is null
       or extensions.crypt(p_password, password_hash) is distinct from password_hash then
      raise exception 'Incorrect password.';
    end if;
  end if;

  select coalesce(max(seat), -1) + 1 into next_seat
  from public.room_players where room_id = target.id;

  insert into public.room_players (room_id, player_id, name, seat)
  values (target.id, auth.uid(), trim(p_player_name), next_seat);
  update public.rooms set expires_at = now() + interval '2 hours' where id = target.id;

  return public.get_room_state(target.id);
end;
$$;

create or replace function public.has_bingo(p_grid integer[], p_marked integer[], p_size integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  line_index integer;
  matched_count integer;
  matched_lines integer := 0;
begin
  if p_size is null or p_size < 1 or p_grid is null or cardinality(p_grid) <> p_size * p_size then
    return false;
  end if;

  for line_index in 0..p_size - 1 loop
    select count(*) into matched_count
    from generate_series(0, p_size - 1) col
    where p_grid[line_index * p_size + col + 1] = any(p_marked);
    if matched_count = p_size then matched_lines := matched_lines + 1; end if;

    select count(*) into matched_count
    from generate_series(0, p_size - 1) row_index
    where p_grid[row_index * p_size + line_index + 1] = any(p_marked);
    if matched_count = p_size then matched_lines := matched_lines + 1; end if;
  end loop;

  select count(*) into matched_count
  from generate_series(0, p_size - 1) i
  where p_grid[i * p_size + i + 1] = any(p_marked);
  if matched_count = p_size then matched_lines := matched_lines + 1; end if;

  select count(*) into matched_count
  from generate_series(0, p_size - 1) i
  where p_grid[i * p_size + p_size - i] = any(p_marked);
  if matched_count = p_size then matched_lines := matched_lines + 1; end if;

  return matched_lines >= p_size;
end;
$$;

create or replace function public.finish_room_if_won(p_room_code text, p_player_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms%rowtype;
  player public.room_players%rowtype;
begin
  select * into target from public.rooms where id = p_room_code;
  select * into player from public.room_players
  where room_id = p_room_code and player_id = p_player_id;

  if target.status <> 'playing' or not public.has_bingo(player.grid, player.marked_numbers, target.grid_size) then
    return false;
  end if;

  update public.rooms
  set status = 'finished',
      winner = player.name,
      winner_player_id = player.player_id,
      current_chosen_number = null,
      setup_deadline = null,
      turn_deadline = null,
      expires_at = now() + interval '15 minutes'
  where id = p_room_code;
  return true;
end;
$$;

create or replace function public.start_game(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms%rowtype;
begin
  select * into target from public.rooms where id = p_room_code for update;
  if not found or target.expires_at <= now() then raise exception 'Room not found or expired.'; end if;
  if target.owner_id <> auth.uid() then raise exception 'Only the room host can start the game.'; end if;
  if target.status <> 'waiting' then raise exception 'This room is no longer waiting.'; end if;
  if target.player_count < 2 then raise exception 'At least two players are required.'; end if;

  update public.rooms
  set status = 'setup',
      setup_deadline = now() + interval '120 seconds',
      expires_at = now() + interval '2 hours'
  where id = p_room_code;
  return public.get_room_state(p_room_code);
end;
$$;

create or replace function public.submit_grid(p_room_code text, p_grid integer[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms%rowtype;
  max_number integer;
begin
  select * into target from public.rooms where id = p_room_code for update;
  if not found or target.status <> 'setup' then raise exception 'Grid setup is not active.'; end if;
  if target.setup_deadline <= now() then raise exception 'Grid setup time has expired.'; end if;

  max_number := target.grid_size * target.grid_size;
  if p_grid is null or cardinality(p_grid) <> max_number then
    raise exception 'Grid must contain exactly % numbers.', max_number;
  end if;
  if exists (
    select 1 from unnest(p_grid) n where n is null or n < 1 or n > max_number
  ) or (select count(distinct n) from unnest(p_grid) n) <> max_number then
    raise exception 'Grid numbers must be unique whole numbers between 1 and %.', max_number;
  end if;
  if not exists (
    select 1 from public.room_players where room_id = p_room_code and player_id = auth.uid()
  ) then
    raise exception 'You are not a member of this room.';
  end if;

  update public.room_players set grid = p_grid
  where room_id = p_room_code and player_id = auth.uid();

  if not exists (
    select 1 from public.room_players where room_id = p_room_code and grid is null
  ) then
    update public.rooms set status = 'playing', setup_deadline = null, expires_at = now() + interval '2 hours'
    where id = p_room_code;
  end if;

  return public.get_room_state(p_room_code);
end;
$$;

create or replace function public.complete_setup_timeout(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms%rowtype;
  max_number integer;
  player record;
begin
  select * into target from public.rooms where id = p_room_code for update;
  if not found or target.status <> 'setup' or target.setup_deadline is null or target.setup_deadline > now() then
    return public.get_room_state(p_room_code);
  end if;

  max_number := target.grid_size * target.grid_size;
  for player in
    select player_id from public.room_players
    where room_id = p_room_code and grid is null
  loop
    update public.room_players
    set grid = (
      select array_agg(n order by random())
      from generate_series(1, max_number) n
    )
    where room_id = p_room_code and player_id = player.player_id;
  end loop;

  update public.rooms
  set status = 'playing', setup_deadline = null, expires_at = now() + interval '2 hours'
  where id = p_room_code;
  return public.get_room_state(p_room_code);
end;
$$;

create or replace function public.choose_number(p_room_code text, p_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms%rowtype;
  chooser public.room_players%rowtype;
begin
  select * into target from public.rooms where id = p_room_code for update;
  if not found or target.status <> 'playing' then raise exception 'The game is not active.'; end if;
  if target.current_chosen_number is not null then raise exception 'A number is already being played.'; end if;

  select * into chooser from public.room_players
  where room_id = p_room_code and seat = target.current_turn_index for update;
  if not found or chooser.player_id <> auth.uid() then raise exception 'It is not your turn.'; end if;
  if p_number is null or not (p_number = any(chooser.grid)) then
    raise exception 'Choose a number from your own grid.';
  end if;
  if p_number = any(chooser.marked_numbers) then raise exception 'That number is already marked.'; end if;

  update public.rooms
  set current_chosen_number = p_number, turn_deadline = now() + interval '30 seconds',
      expires_at = now() + interval '2 hours'
  where id = p_room_code;
  update public.room_players
  set marked_numbers = array_append(marked_numbers, p_number), turn_marked = true
  where room_id = p_room_code and player_id = auth.uid();

  if public.finish_room_if_won(p_room_code, auth.uid()) then
    return public.get_room_state(p_room_code);
  end if;

  return public.get_room_state(p_room_code);
end;
$$;

create or replace function public.mark_number(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms%rowtype;
  player public.room_players%rowtype;
begin
  select * into target from public.rooms where id = p_room_code for update;
  if not found or target.status <> 'playing' or target.current_chosen_number is null then
    raise exception 'There is no number to mark right now.';
  end if;
  select * into player from public.room_players
  where room_id = p_room_code and player_id = auth.uid() for update;
  if not found then raise exception 'You are not a member of this room.'; end if;
  if player.turn_marked then raise exception 'You already marked this turn.'; end if;
  if not (target.current_chosen_number = any(player.grid)) then
    raise exception 'That number is not on your grid.';
  end if;

  update public.room_players
  set marked_numbers = array_append(marked_numbers, target.current_chosen_number), turn_marked = true
  where room_id = p_room_code and player_id = auth.uid();

  if public.finish_room_if_won(p_room_code, auth.uid()) then
    return public.get_room_state(p_room_code);
  end if;

  if not exists (
    select 1 from public.room_players where room_id = p_room_code and not turn_marked
  ) then
    update public.rooms
    set current_chosen_number = null,
        current_turn_index = (current_turn_index + 1) % player_count,
        turn_deadline = null,
        expires_at = now() + interval '2 hours'
    where id = p_room_code;
    update public.room_players set turn_marked = false where room_id = p_room_code;
  end if;

  return public.get_room_state(p_room_code);
end;
$$;

create or replace function public.resolve_turn_timeout(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms%rowtype;
  player record;
begin
  select * into target from public.rooms where id = p_room_code for update;
  if not found or target.status <> 'playing' or target.turn_deadline is null
     or target.current_chosen_number is null or target.turn_deadline > now() then
    return public.get_room_state(p_room_code);
  end if;

  for player in
    select player_id, grid, marked_numbers
    from public.room_players
    where room_id = p_room_code and not turn_marked
    order by seat
  loop
    update public.room_players
    set marked_numbers = case
          when target.current_chosen_number = any(grid)
        and not (target.current_chosen_number = any(marked_numbers))
          then array_append(marked_numbers, target.current_chosen_number)
          else marked_numbers
        end,
        turn_marked = true
    where room_id = p_room_code and player_id = player.player_id;

    if target.current_chosen_number = any(player.grid)
       and not (target.current_chosen_number = any(player.marked_numbers))
       and public.finish_room_if_won(p_room_code, player.player_id) then
      return public.get_room_state(p_room_code);
    end if;
  end loop;

  if not exists (
    select 1 from public.room_players where room_id = p_room_code and not turn_marked
  ) then
    update public.rooms
    set current_chosen_number = null,
        current_turn_index = (current_turn_index + 1) % player_count,
        turn_deadline = null,
        expires_at = now() + interval '2 hours'
    where id = p_room_code;
    update public.room_players set turn_marked = false where room_id = p_room_code;
  end if;

  return public.get_room_state(p_room_code);
end;
$$;

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.private_room_secrets enable row level security;

drop policy if exists "Room members can read rooms" on public.rooms;
create policy "Room members can read rooms"
on public.rooms for select to authenticated
using (
  (not is_private and status in ('waiting', 'setup') and expires_at > now())
  or exists (
    select 1 from public.room_players p
    where p.room_id = rooms.id and p.player_id = auth.uid()
  )
);

drop policy if exists "Room members can read players" on public.room_players;
create or replace function public.is_room_member(p_room_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_players p
    where p.room_id = p_room_code and p.player_id = auth.uid()
  );
$$;

create policy "Room members can read players"
on public.room_players for select to authenticated
using (public.is_room_member(room_id));

grant select on public.rooms, public.room_players to authenticated;
revoke all on public.private_room_secrets from public, anon, authenticated;
revoke insert, update, delete on public.rooms, public.room_players from anon, authenticated;

revoke all on function public.update_room_player_count() from public, anon, authenticated;
revoke all on function public.delete_expired_rooms() from public, anon, authenticated;
revoke all on function public.get_room_state(text) from public, anon, authenticated;
revoke all on function public.has_bingo(integer[], integer[], integer) from public, anon, authenticated;
revoke all on function public.finish_room_if_won(text, uuid) from public, anon, authenticated;
revoke all on function public.is_room_member(text) from public, anon;
grant execute on function public.is_room_member(text) to authenticated;

revoke all on function public.list_public_rooms() from public, anon;
revoke all on function public.get_room(text) from public, anon;
revoke all on function public.create_room(text, integer, boolean, text, text) from public, anon;
revoke all on function public.join_room(text, text, text) from public, anon;
revoke all on function public.start_game(text) from public, anon;
revoke all on function public.submit_grid(text, integer[]) from public, anon;
revoke all on function public.complete_setup_timeout(text) from public, anon;
revoke all on function public.choose_number(text, integer) from public, anon;
revoke all on function public.mark_number(text) from public, anon;
revoke all on function public.resolve_turn_timeout(text) from public, anon;

grant execute on function public.list_public_rooms() to authenticated;
grant execute on function public.get_room(text) to authenticated;
grant execute on function public.create_room(text, integer, boolean, text, text) to authenticated;
grant execute on function public.join_room(text, text, text) to authenticated;
grant execute on function public.start_game(text) to authenticated;
grant execute on function public.submit_grid(text, integer[]) to authenticated;
grant execute on function public.complete_setup_timeout(text) to authenticated;
grant execute on function public.choose_number(text, integer) to authenticated;
grant execute on function public.mark_number(text) to authenticated;
grant execute on function public.resolve_turn_timeout(text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_players'
  ) then
    alter publication supabase_realtime add table public.room_players;
  end if;
end;
$$;
