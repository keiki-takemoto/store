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

-- ========================================================================
-- 商品リスト（店舗管理の「設定 → 商品」）
-- 店長用キーだけが触れる。スタッフ用の合言葉では読めないので、
-- 仕入れ値や原価率がスタッフのURLから見えることはない。
-- ========================================================================

create table if not exists store_items (
  id         text primary key,
  no         text    not null default '',
  name       text    not null default '',
  cat        text    not null default '',
  price      integer,
  cost       integer,
  stock      integer,
  alert      integer,
  deleted    boolean not null default false,   -- 消した印。ほかの端末にも消したことを伝えるため残す
  updated_at timestamptz not null default now()
);
create index if not exists store_items_upd on store_items (updated_at);

-- カテゴリーの並びなど、商品以外のちょっとしたもの
create table if not exists store_meta (
  k          text primary key,
  v          jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table store_items enable row level security;
alter table store_meta  enable row level security;
-- ポリシーは作らない ＝ 表への直接の読み書きは全部拒否される。

-- 店長：商品を受け取る（p_since より後に変わったものだけ。空なら全部）
create or replace function store_items_get(p_key text, p_since text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb; v_cats jsonb; v_since timestamptz;
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  v_since := case when coalesce(p_since,'') = '' then null else p_since::timestamptz end;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'no', i.no, 'name', i.name, 'cat', i.cat,
           'price', i.price, 'cost', i.cost, 'stock', i.stock, 'alert', i.alert,
           'deleted', i.deleted,
           'upd', to_char(i.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         ) order by i.updated_at), '[]'::jsonb)
    into v_items
    from store_items i
   where v_since is null or i.updated_at > v_since;
  select v into v_cats from store_meta where k = 'cats';
  -- 5秒だけ手前を返す。ちょうど同じ瞬間に書かれたものを取りこぼさないため。
  return jsonb_build_object('ok', true, 'items', v_items,
    'cats', coalesce(v_cats, '[]'::jsonb),
    'now', to_char((now() - interval '5 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- 店長：商品を書き込む（同じ id は上書き）
create or replace function store_items_put(p_key text, p_items jsonb, p_cats jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    insert into store_items (id, no, name, cat, price, cost, stock, alert, deleted, updated_at)
    select x->>'id',
           coalesce(x->>'no',''), coalesce(x->>'name',''), coalesce(x->>'cat',''),
           nullif(x->>'price','')::integer, nullif(x->>'cost','')::integer,
           nullif(x->>'stock','')::integer, nullif(x->>'alert','')::integer,
           coalesce((x->>'deleted')::boolean, false), now()
      from jsonb_array_elements(p_items) x
     where coalesce(x->>'id','') <> ''
    on conflict (id) do update
      set no = excluded.no, name = excluded.name, cat = excluded.cat,
          price = excluded.price, cost = excluded.cost,
          stock = excluded.stock, alert = excluded.alert,
          deleted = excluded.deleted, updated_at = now();
  end if;
  if p_cats is not null and jsonb_typeof(p_cats) = 'array' then
    insert into store_meta (k, v, updated_at) values ('cats', p_cats, now())
    on conflict (k) do update set v = excluded.v, updated_at = now();
  end if;
  return jsonb_build_object('ok', true,
    'now', to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

grant execute on function store_items_get(text, text)        to anon, authenticated;
grant execute on function store_items_put(text, jsonb, jsonb) to anon, authenticated;

-- ========================================================================
-- 帳簿（店舗管理の「経費」と「収支表」）
-- 変動費・固定費・人件費を1つの表にまとめて入れる。kind で見分ける。
--   exp   … 変動費（day＝使った日。data に 科目・支払い方法・金額・メモ）
--   fix   … 固定費（day は空。data に 名称・月額・支払い方法・メモ）
--   labor … 人件費（day＝働いた日。data に スタッフ・始まり・終わり・その時の時給・交通費）
-- お給料や経費はスタッフに見せないので、店長用キーだけが触れる。
-- ========================================================================

create table if not exists store_books (
  id         text primary key,
  kind       text    not null default '',
  day        text    not null default '',
  data       jsonb   not null default '{}'::jsonb,
  deleted    boolean not null default false,   -- 消した印。ほかの端末にも消したことを伝えるため残す
  updated_at timestamptz not null default now()
);
create index if not exists store_books_upd on store_books (updated_at);

alter table store_books enable row level security;
-- ポリシーは作らない ＝ 表への直接の読み書きは全部拒否される。

-- 店長：帳簿を受け取る（p_since より後に変わったものだけ。空なら全部）
create or replace function store_books_get(p_key text, p_since text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_since timestamptz;
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  v_since := case when coalesce(p_since,'') = '' then null else p_since::timestamptz end;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'kind', b.kind, 'day', b.day, 'data', b.data, 'deleted', b.deleted
         ) order by b.updated_at), '[]'::jsonb)
    into v_rows
    from store_books b
   where v_since is null or b.updated_at > v_since;
  -- 5秒だけ手前を返す。ちょうど同じ瞬間に書かれたものを取りこぼさないため。
  return jsonb_build_object('ok', true, 'rows', v_rows,
    'now', to_char((now() - interval '5 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

-- 店長：帳簿を書き込む（同じ id は上書き）
create or replace function store_books_put(p_key text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  if p_rows is not null and jsonb_typeof(p_rows) = 'array' then
    insert into store_books (id, kind, day, data, deleted, updated_at)
    select x->>'id', coalesce(x->>'kind',''), coalesce(x->>'day',''),
           coalesce(x->'data','{}'::jsonb), coalesce((x->>'deleted')::boolean, false), now()
      from jsonb_array_elements(p_rows) x
     where coalesce(x->>'id','') <> ''
    on conflict (id) do update
      set kind = excluded.kind, day = excluded.day, data = excluded.data,
          deleted = excluded.deleted, updated_at = now();
  end if;
  return jsonb_build_object('ok', true,
    'now', to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

grant execute on function store_books_get(text, text)  to anon, authenticated;
grant execute on function store_books_put(text, jsonb) to anon, authenticated;

-- ========================================================================
-- 店長へ報告（スタッフ用アプリ）と、ご意見箱（店長の画面）
-- 送るのはスタッフ用の合言葉。読むのと返すのは店長用キー。
-- 返事を書くと replied が立ち、店長のご意見箱からは消える。
-- スタッフは、自分の端末に控えてあるID ぶんだけ見られる。
-- （合言葉はみんな同じなので、名前で引くと人の報告も読めてしまうため）
-- ========================================================================

create table if not exists store_reports (
  id         text primary key,
  name       text    not null default '',
  title      text    not null default '',
  body       text    not null default '',
  reply      text    not null default '',
  replied    boolean not null default false,
  created_at timestamptz not null default now(),
  replied_at timestamptz
);
create index if not exists store_reports_open on store_reports (replied, created_at);

alter table store_reports enable row level security;
-- ポリシーは作らない ＝ 表への直接の読み書きは全部拒否される。

-- スタッフ：報告を送る
create or replace function report_submit(p_code text, p_id text, p_name text, p_title text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := btrim(coalesce(p_id,''));
begin
  if p_code is distinct from 'iq9kbjfflg' then raise exception 'bad_code'; end if;
  if v_id = '' or btrim(coalesce(p_body,'')) = '' then raise exception 'bad_input'; end if;
  insert into store_reports (id, name, title, body, created_at)
  values (v_id, btrim(coalesce(p_name,'')), btrim(coalesce(p_title,'')), p_body, now())
  on conflict (id) do nothing;       -- 二重送信はそのまま受け流す
  return jsonb_build_object('ok', true,
    'at', to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI'));
end $$;

-- スタッフ：自分が出した報告と、店長からの返事を見る
create or replace function report_list_mine(p_code text, p_ids jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb;
begin
  if p_code is distinct from 'iq9kbjfflg' then raise exception 'bad_code'; end if;
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' then
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'title', r.title, 'body', r.body,
           'reply', r.reply, 'replied', r.replied,
           'at', to_char(r.created_at at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI'),
           'replyAt', case when r.replied_at is null then ''
                      else to_char(r.replied_at at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI') end
         ) order by r.created_at desc), '[]'::jsonb)
    into v_items
    from store_reports r
   where r.id in (select jsonb_array_elements_text(p_ids));
  return jsonb_build_object('ok', true, 'items', v_items);
end $$;

-- 店長：まだ返事をしていない報告を受け取る
create or replace function report_list(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb;
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'title', r.title, 'body', r.body,
           'at', to_char(r.created_at at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI')
         ) order by r.created_at), '[]'::jsonb)
    into v_items
    from store_reports r
   where r.replied = false;
  return jsonb_build_object('ok', true, 'items', v_items);
end $$;

-- 店長：返事を書く（書いたらご意見箱からは消える）
create or replace function report_reply(p_key text, p_id text, p_reply text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  if btrim(coalesce(p_reply,'')) = '' then raise exception 'bad_input'; end if;
  update store_reports
     set reply = p_reply, replied = true, replied_at = now()
   where id = p_id;
  if not found then raise exception 'bad_input'; end if;
  return jsonb_build_object('ok', true,
    'at', to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI'));
end $$;

-- スタッフ：送ったものを取り消す（店長がまだ返事を書いていないときだけ）
create or replace function report_cancel(p_code text, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if p_code is distinct from 'iq9kbjfflg' then raise exception 'bad_code'; end if;
  delete from store_reports where id = p_id and replied = false;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'already_replied'; end if;   -- 返事ずみか、もう無い
  return jsonb_build_object('ok', true);
end $$;

grant execute on function report_submit(text, text, text, text, text) to anon, authenticated;
grant execute on function report_cancel(text, text)                   to anon, authenticated;
grant execute on function report_list_mine(text, jsonb)               to anon, authenticated;
grant execute on function report_list(text)                           to anon, authenticated;
grant execute on function report_reply(text, text, text)              to anon, authenticated;
