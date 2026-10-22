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

-- あとから足した「種類」。要望・在庫の不足…を入れる。
-- 入っていない古い報告は '' のまま＝未分類として出る。
alter table store_reports add column if not exists cat text not null default '';

alter table store_reports enable row level security;
-- ポリシーは作らない ＝ 表への直接の読み書きは全部拒否される。

-- スタッフ：報告を送る
-- 「種類」を足したぶん引数が1つ増えたので、前の形（5つ）は捨ててから作り直す。
drop function if exists report_submit(text, text, text, text, text);
create or replace function report_submit(p_code text, p_id text, p_name text, p_title text, p_body text,
                                          p_cat text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := btrim(coalesce(p_id,''));
begin
  if p_code is distinct from 'iq9kbjfflg' then raise exception 'bad_code'; end if;
  if v_id = '' or btrim(coalesce(p_body,'')) = '' then raise exception 'bad_input'; end if;
  insert into store_reports (id, name, title, body, cat, created_at)
  values (v_id, btrim(coalesce(p_name,'')), btrim(coalesce(p_title,'')), p_body,
          btrim(coalesce(p_cat,'')), now())
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
           'id', r.id, 'title', r.title, 'body', r.body, 'cat', r.cat,
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
           'id', r.id, 'name', r.name, 'title', r.title, 'body', r.body, 'cat', r.cat,
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

grant execute on function report_submit(text, text, text, text, text, text) to anon, authenticated;
grant execute on function report_cancel(text, text)                   to anon, authenticated;
grant execute on function report_list_mine(text, jsonb)               to anon, authenticated;
grant execute on function report_list(text)                           to anon, authenticated;
grant execute on function report_reply(text, text, text)              to anon, authenticated;

-- ========================================================================
-- スタッフ名簿（時給）
-- 店長の「設定 → スタッフ」で入れた時給を、スタッフ用アプリの
-- 「ステータス」に出すためだけの置き場所。
-- 名前は空白を取り除いたもので引く。
-- ========================================================================

create table if not exists store_staff (
  name       text primary key,          -- 空白を取り除いた名前
  disp       text not null default '',  -- 表示用の名前
  wage       integer,
  updated_at timestamptz not null default now()
);

alter table store_staff enable row level security;
-- ポリシーは作らない ＝ 表への直接の読み書きは全部拒否される。

-- 店長：名簿をまるごと出す（ここに無い人は消える）
create or replace function staff_put(p_key text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'bad_input'; end if;
  delete from store_staff
   where name not in (select coalesce(x->>'name','') from jsonb_array_elements(p_rows) x);
  insert into store_staff (name, disp, wage, updated_at)
  select x->>'name', coalesce(x->>'disp',''), nullif(x->>'wage','')::integer, now()
    from jsonb_array_elements(p_rows) x
   where coalesce(x->>'name','') <> ''
  on conflict (name) do update
    set disp = excluded.disp, wage = excluded.wage, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- スタッフ：自分の時給を見る
create or replace function staff_me(p_code text, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row store_staff%rowtype;
begin
  if p_code is distinct from 'iq9kbjfflg' then raise exception 'bad_code'; end if;
  select * into v_row from store_staff where name = btrim(coalesce(p_name,''));
  if not found then return jsonb_build_object('ok', true, 'found', false); end if;
  return jsonb_build_object('ok', true, 'found', true,
    'disp', v_row.disp, 'wage', v_row.wage);
end $$;

grant execute on function staff_put(text, jsonb) to anon, authenticated;
grant execute on function staff_me(text, text)   to anon, authenticated;

-- ========================================================================
-- スタッフひとりひとりの合言葉（個人用リンク）
-- これまでは全員が同じ合言葉だったので、名前を入れ替えれば人の時給も
-- 見られてしまった。ひとりに1つ合言葉を持たせて、そこから本人を引く。
-- 店長が名簿に追加すると自動で作られ、個人用のURLに入る。
-- ========================================================================

alter table store_staff add column if not exists tok text not null default '';
create unique index if not exists store_staff_tok on store_staff (tok) where tok <> '';

-- 合言葉として通すかどうか（みんな共通の合言葉か、誰かの個人用か）
create or replace function code_ok(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select btrim(coalesce(p_code,'')) = 'iq9kbjfflg'
      or exists (select 1 from store_staff s
                  where s.tok <> '' and s.tok = btrim(coalesce(p_code,'')));
$$;
-- この関数はアプリには公開しない（中の関数からだけ呼ぶ）。

-- スタッフ：自分の時給を見る（個人用の合言葉だけ。名前では引けない）
drop function if exists staff_me(text, text);
create or replace function staff_me(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row store_staff%rowtype;
begin
  select * into v_row from store_staff
   where tok <> '' and tok = btrim(coalesce(p_code,''));
  if not found then
    -- 個人用のリンクではない（昔の共通リンク）
    return jsonb_build_object('ok', true, 'personal', false, 'found', false);
  end if;
  return jsonb_build_object('ok', true, 'personal', true, 'found', true,
    'disp', v_row.disp, 'wage', v_row.wage);
end $$;

-- 個人用の合言葉でも通るようにする（共通の合言葉もしばらく使える）
create or replace function shift_submit_request(p_code text, p_name text, p_month text, p_days jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name,''));
begin
  if not code_ok(p_code) then raise exception 'bad_code'; end if;
  if v_name = '' or p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'bad_input'; end if;
  insert into shift_requests (month, name, days, note, updated_at)
  values (p_month, v_name, coalesce(p_days,'{}'::jsonb), coalesce(p_note,''), now())
  on conflict (month, name) do update
    set days = excluded.days, note = excluded.note, updated_at = now();
  return jsonb_build_object('ok', true,
    'at', to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI:SS'));
end $$;

create or replace function shift_get(p_code text, p_month text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row shift_published%rowtype;
begin
  if not code_ok(p_code) and p_code is distinct from 'eu5gh80n32faz4m2hv0zgwui' then
    raise exception 'bad_code';
  end if;
  select * into v_row from shift_published where month = p_month;
  if not found then
    return jsonb_build_object('ok', true, 'month', p_month, 'days', null, 'closed', '[]'::jsonb, 'publishedAt', '');
  end if;
  return jsonb_build_object('ok', true, 'month', v_row.month, 'days', v_row.days, 'closed', v_row.closed,
    'publishedAt', to_char(v_row.published_at at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI:SS'));
end $$;

create or replace function report_submit(p_code text, p_id text, p_name text, p_title text, p_body text,
                                          p_cat text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := btrim(coalesce(p_id,''));
begin
  if not code_ok(p_code) then raise exception 'bad_code'; end if;
  if v_id = '' or btrim(coalesce(p_body,'')) = '' then raise exception 'bad_input'; end if;
  insert into store_reports (id, name, title, body, cat, created_at)
  values (v_id, btrim(coalesce(p_name,'')), btrim(coalesce(p_title,'')), p_body,
          btrim(coalesce(p_cat,'')), now())
  on conflict (id) do nothing;
  return jsonb_build_object('ok', true,
    'at', to_char(now() at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI'));
end $$;

create or replace function report_list_mine(p_code text, p_ids jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb;
begin
  if not code_ok(p_code) then raise exception 'bad_code'; end if;
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' then
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'title', r.title, 'body', r.body, 'cat', r.cat,
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

create or replace function report_cancel(p_code text, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not code_ok(p_code) then raise exception 'bad_code'; end if;
  delete from store_reports where id = p_id and replied = false;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'already_replied'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- 店長：名簿を出す（個人用の合言葉もいっしょに預ける）
create or replace function staff_put(p_key text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'bad_input'; end if;
  delete from store_staff
   where name not in (select coalesce(x->>'name','') from jsonb_array_elements(p_rows) x);
  insert into store_staff (name, disp, wage, tok, updated_at)
  select x->>'name', coalesce(x->>'disp',''), nullif(x->>'wage','')::integer,
         coalesce(x->>'tok',''), now()
    from jsonb_array_elements(p_rows) x
   where coalesce(x->>'name','') <> ''
  on conflict (name) do update
    set disp = excluded.disp, wage = excluded.wage,
        tok = case when excluded.tok <> '' then excluded.tok else store_staff.tok end,
        updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

grant execute on function staff_me(text) to anon, authenticated;

-- ========================================================================
-- スマホへの通知（プッシュ通知）
-- 通知を受け取る端末を覚えておくための表。
-- 実際に送るのは Supabase の Edge Function（server/notify/index.ts）。
-- 秘密のかぎは Edge Function の Secrets にだけ置く。ここには書かない。
-- ========================================================================

create table if not exists store_push (
  endpoint   text primary key,
  p256dh     text not null default '',
  auth       text not null default '',
  label      text not null default '',
  created_at timestamptz not null default now()
);

alter table store_push enable row level security;
-- ポリシーは作らない ＝ 表への直接の読み書きは全部拒否される。

-- 店長：この端末に通知を出すよう登録する
create or replace function push_put(p_key text, p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  if btrim(coalesce(p_endpoint,'')) = '' then raise exception 'bad_input'; end if;
  insert into store_push (endpoint, p256dh, auth, label, created_at)
  values (p_endpoint, coalesce(p_p256dh,''), coalesce(p_auth,''), coalesce(p_label,''), now())
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label;
  return jsonb_build_object('ok', true);
end $$;

-- 店長：この端末への通知をやめる
create or replace function push_del(p_key text, p_endpoint text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  delete from store_push where endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function push_put(text, text, text, text, text) to anon, authenticated;
grant execute on function push_del(text, text)                   to anon, authenticated;

-- 通知を送る Edge Function は、この表だけを直接読む（ほかの表はすべて関数ごし）。
-- 既定では service_role に権限が無く、42501（権限がありません）で止まるので与えておく。
grant select, delete on table store_push to service_role;

-- ========================================================================
-- レジ（会計の記録）
-- 1回の会計を1行で持つ。中身（何がいくつ）は lines にまとめて入れる。
-- 売価も仕入れ値も「売った時点の値」を写して残す。あとから原価表を直しても、
-- 過去の利益が変わらないようにするため。金額はすべて税込。
-- 店長用キーだけが触れる。レジは店舗管理アプリの中にあるので同じキーでよい。
-- ========================================================================

create table if not exists store_sales (
  id         text primary key,                   -- 端末で作る。二度送っても増えない
  at         timestamptz not null default now(), -- 会計した時刻
  staff      text    not null default '',        -- 誰が売ったか
  pay        text    not null default 'cash',    -- cash（現金）／card（カード）
  subtotal   integer not null default 0,         -- 値引き前
  discount   integer not null default 0,         -- 値引き
  total      integer not null default 0,         -- 受け取った額（subtotal - discount）
  cost       integer not null default 0,         -- 売った時点の仕入れ値の合計
  qty        integer not null default 0,         -- 点数
  lines      jsonb   not null default '[]'::jsonb,
  note       text    not null default '',
  voided     boolean not null default false,     -- 打ち消した会計
  created_at timestamptz not null default now()
);
create index if not exists store_sales_at on store_sales (at);

alter table store_sales enable row level security;
-- ポリシーは作らない ＝ 表への直接の読み書きは全部拒否される。

-- 店長：会計を記録する（まとめて送れる。つながらなかったぶんを後から流すため）
-- 新しく入った会計のぶんだけ、商品の在庫を減らす。
create or replace function sale_put(p_key text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new int := 0; v_stock int := 0;
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'bad_input'; end if;

  with ins as (
    insert into store_sales (id, at, staff, pay, subtotal, discount, total, cost, qty, lines, note)
    select x->>'id',
           coalesce(nullif(x->>'at','')::timestamptz, now()),
           btrim(coalesce(x->>'staff','')),
           case when x->>'pay' = 'card' then 'card' else 'cash' end,
           coalesce(nullif(x->>'subtotal','')::integer, 0),
           coalesce(nullif(x->>'discount','')::integer, 0),
           coalesce(nullif(x->>'total','')::integer, 0),
           coalesce(nullif(x->>'cost','')::integer, 0),
           coalesce(nullif(x->>'qty','')::integer, 0),
           case when jsonb_typeof(x->'lines') = 'array' then x->'lines' else '[]'::jsonb end,
           coalesce(x->>'note','')
      from jsonb_array_elements(p_rows) x
     where coalesce(x->>'id','') <> ''
    on conflict (id) do nothing          -- 同じ会計を二度送っても増えない
    returning id, lines
  ), sold as (
    select l->>'id' as item_id, sum(coalesce(nullif(l->>'qty','')::integer, 0)) as n
      from ins, jsonb_array_elements(ins.lines) l
     where coalesce(l->>'id','') <> ''
     group by 1
  ), upd as (
    -- 在庫を入れていない商品（stock が空）は、そのまま空にしておく
    update store_items i
       set stock = i.stock - s.n, updated_at = now()
      from sold s
     where i.id = s.item_id and i.stock is not null
    returning i.id
  )
  select (select count(*) from ins), (select count(*) from upd) into v_new, v_stock;

  return jsonb_build_object('ok', true, 'added', v_new, 'stock', v_stock);
end $$;

-- 店長：会計を受け取る（p_from / p_to は "2026-10-01" の形。両端を含む）
create or replace function sales_get(p_key text, p_from text default null, p_to text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb; v_from date; v_to date;
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  v_from := case when coalesce(p_from,'') = '' then null else p_from::date end;
  v_to   := case when coalesce(p_to,'')   = '' then null else p_to::date   end;
  -- 日付は日本時間で見る（サーバーのUTCで切ると、夜の会計が前の日に入ってしまう）
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'staff', s.staff, 'pay', s.pay,
           'subtotal', s.subtotal, 'discount', s.discount, 'total', s.total,
           'cost', s.cost, 'qty', s.qty, 'lines', s.lines, 'note', s.note,
           'voided', s.voided,
           'day', to_char(s.at at time zone 'Asia/Tokyo','YYYY-MM-DD'),
           'at',  to_char(s.at at time zone 'Asia/Tokyo','YYYY-MM-DD HH24:MI')
         ) order by s.at desc), '[]'::jsonb)
    into v_items
    from store_sales s
   where (v_from is null or (s.at at time zone 'Asia/Tokyo')::date >= v_from)
     and (v_to   is null or (s.at at time zone 'Asia/Tokyo')::date <= v_to);
  return jsonb_build_object('ok', true, 'items', v_items);
end $$;

-- 店長：打ち間違えた会計を取り消す（在庫は戻す）
create or replace function sale_void(p_key text, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lines jsonb;
begin
  if p_key is distinct from 'eu5gh80n32faz4m2hv0zgwui' then raise exception 'bad_key'; end if;
  update store_sales set voided = true where id = p_id and voided = false
  returning lines into v_lines;
  if v_lines is null then raise exception 'bad_input'; end if;   -- もう無いか、取り消しずみ
  update store_items i
     set stock = i.stock + s.n, updated_at = now()
    from (select l->>'id' as item_id, sum(coalesce(nullif(l->>'qty','')::integer, 0)) as n
            from jsonb_array_elements(v_lines) l
           where coalesce(l->>'id','') <> ''
           group by 1) s
   where i.id = s.item_id and i.stock is not null;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function sale_put(text, jsonb)       to anon, authenticated;
grant execute on function sales_get(text, text, text) to anon, authenticated;
grant execute on function sale_void(text, text)       to anon, authenticated;
