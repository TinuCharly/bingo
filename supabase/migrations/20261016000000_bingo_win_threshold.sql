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
