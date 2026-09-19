-- シフト管理の置き場所（Supabase）
-- Supabaseの SQL Editor に貼って Run するだけ。何度流しても大丈夫。
--
-- 考え方：表そのものは誰にも触らせない（RLSを有効にしてポリシーを作らない）。
-- 下の関数だけが表に触れて、関数の中で合言葉を確かめる。
-- だから、アプリに埋め込む anon キーが人目に触れても、合言葉が無ければ何もできない。

-- この2つはこの店だけのもの。変えるときは下の2行を書き換えて、もう一度 Run。
--   スタッフ用 : iq9kbjfflg
--   店長用     : eu5gh80n32faz4m2hv0zgwui

create table if not exists shift_requests (
  month       text not null,
  name        text not null,
  days        jsonb not null default '{}'::jsonb,
  note        text  not null default '',
  updated_at  timestamptz not null default now(),
  primary key (month, name)
);

create table if not exists shift_published (
  month        text primary key,
  days         jsonb not null default '{}'::jsonb,
  closed       jsonb not null default '[]'::jsonb,
  published_at timestamptz not null default now()
);

alter table shift_requests  enable row level security;
alter table shift_published enable row level security;
-- ポリシーは作らない ＝ 表への直接の読み書きは全部拒否される。

create or replace function shift_ping()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'at', to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI:SS'));
$$;

-- スタッフ：希望を出す（同じ人・同じ月は上書き）
create or replace function shift_submit_request(p_code text, p_name text, p_month text, p_days jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name,''));
begin
  if p_code is distinct from 'iq9kbjfflg' then raise exception 'bad_code'; end if;
  if v_name = '' or p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'bad_input'; end if;
  insert into shift_requests (month, name, days, note, updated_at)
  values (p_month, v_name, coalesce(p_days,'{}'::jsonb), coalesce(p_note,''), now())
  on conflict (month, name) do update
    set days = excluded.days, note = excluded.note, updated_at = now();
  return jsonb_build_object('ok', true,
    'at', to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI:SS'));
end $$;

-- 店長：届いた希望をまとめて受け取る（p_month が空なら全部）
create or replace function shift_list_requests(p_key text, p_month text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb;
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'at',    to_char(r.updated_at at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI:SS'),
           'month', r.month, 'name', r.name, 'days', r.days, 'note', r.note
         ) order by r.month, r.name), '[]'::jsonb)
    into v_items
    from shift_requests r
   where p_month is null or p_month = '' or r.month = p_month;
  return jsonb_build_object('ok', true, 'items', v_items);
end $$;

-- 店長：確定したシフトをスタッフに出す
create or replace function shift_publish(p_key text, p_month text, p_days jsonb, p_closed jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'bad_input'; end if;
  insert into shift_published (month, days, closed, published_at)
  values (p_month, coalesce(p_days,'{}'::jsonb), coalesce(p_closed,'[]'::jsonb), now())
  on conflict (month) do update
    set days = excluded.days, closed = excluded.closed, published_at = now();
  return jsonb_build_object('ok', true,
    'at', to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI:SS'));
end $$;

-- スタッフ：確定したシフトを見る
create or replace function shift_get(p_code text, p_month text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row shift_published%rowtype;
begin
  if p_code is distinct from 'iq9kbjfflg' and p_code is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_code'; end if;
  select * into v_row from shift_published where month = p_month;
  if not found then
    return jsonb_build_object('ok', true, 'month', p_month, 'days', null, 'closed', '[]'::jsonb, 'publishedAt', '');
  end if;
  return jsonb_build_object('ok', true, 'month', v_row.month, 'days', v_row.days, 'closed', v_row.closed,
    'publishedAt', to_char(v_row.published_at at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI:SS'));
end $$;

-- アプリ（anonキー）から、この5つの関数だけ呼べるようにする
grant execute on function shift_ping()                                              to anon, authenticated;
grant execute on function shift_submit_request(text, text, text, jsonb, text)       to anon, authenticated;
grant execute on function shift_list_requests(text, text)                           to anon, authenticated;
grant execute on function shift_publish(text, text, jsonb, jsonb)                   to anon, authenticated;
grant execute on function shift_get(text, text)                                     to anon, authenticated;
