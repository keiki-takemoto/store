/* 置き場所（Supabase）とのやりとり。
   申請者ページと管理者ページの両方が使う。
   表には直接触らず、SQLで作った関数（shift_ping / shift_submit_request /
   shift_list_requests / shift_publish / shift_get）だけを呼ぶ。
   合言葉は関数の中で確かめられるので、anonキーが人目に触れても中身は守られる。
   つながらないときは必ず例外を投げるので、呼ぶ側で「LINEで送る」に逃がすこと。 */
(function (root) {
  "use strict";
  var CFG = null;   // {url, anon, code, key}

  function clean(u) {
    return String(u || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1.*$/, "");
  }
  function configure(c) {
    CFG = (c && c.url && c.anon)
      ? { url: clean(c.url), anon: String(c.anon).trim(), code: c.code || "", key: c.key || "" }
      : null;
  }
  function config() { return CFG }
  function isOn() { return !!(CFG && CFG.url && CFG.anon) }

  function err(code, message) { var e = new Error(message || code); e.code = code; return e }

  function messageFor(code) {
    if (code === "bad_code") return "合言葉が違います";
    if (code === "bad_key") return "管理用キーが違います";
    if (code === "bad_input") return "送る内容に不足があります";
    if (code === "already_replied") return "店長がもう返事を書いています";
    if (code === "closed") return "その日の来店はもう確定しています";
    if (code === "no_function") return "SQLがまだ流されていないようです（はじめの設定をご確認ください）";
    if (code === "bad_anon") return "anonキーかURLが違います";
    if (code === "offline") return "つながりませんでした";
    if (code === "not_configured") return "置き場所が設定されていません";
    return "うまくいきませんでした";
  }

  async function rpc(fn, args) {
    if (!isOn()) throw err("not_configured");
    /* 新しい形式のキー（sb_publishable_…）はJWTではないので、Authorization には載せない。
       古い形式（eyJ… のJWT）のときだけ Bearer を付ける。 */
    var h = { "Content-Type": "application/json", "apikey": CFG.anon };
    if (/^ey/.test(CFG.anon)) h["Authorization"] = "Bearer " + CFG.anon;
    var res;
    try {
      res = await fetch(CFG.url + "/rest/v1/rpc/" + fn, {
        method: "POST", headers: h, body: JSON.stringify(args || {})
      });
    } catch (e) { throw err("offline", messageFor("offline")) }

    var text = await res.text().catch(function () { return "" });
    var data = null;
    try { data = JSON.parse(text) } catch (e) {}

    if (!res.ok) {
      var m = (data && (data.message || data.error_description || data.error)) || "";
      if (res.status === 404 || /Could not find the function|does not exist/i.test(m)) throw err("no_function", messageFor("no_function"));
      if (res.status === 401 || res.status === 403 || /JWT|api key/i.test(m)) throw err("bad_anon", messageFor("bad_anon"));
      if (/bad_code/.test(m)) throw err("bad_code", messageFor("bad_code"));
      if (/bad_key/.test(m)) throw err("bad_key", messageFor("bad_key"));
      if (/bad_input/.test(m)) throw err("bad_input", messageFor("bad_input"));
      if (/already_replied/.test(m)) throw err("already_replied", messageFor("already_replied"));
      if (/\bclosed\b/.test(m)) throw err("closed", messageFor("closed"));
      throw err("error", m || "うまくいきませんでした");
    }
    if (!data || data.ok !== true) throw err("bad_response", "返事を読み取れませんでした");
    return data;
  }

  /* 店長への報告の「種類」。言葉を変えたいときは nm だけ直す。
     k（req / stock …）は変えないこと。変えると、もう届いている報告の
     種類が分からなくなる。順番はそのまま画面に並ぶ。 */
  var CATS = [
    { k: "req",   nm: "要望",            ic: "🙋" },
    { k: "stock", nm: "在庫の不足",      ic: "📦" },
    { k: "fix",   nm: "設備の不具合",      ic: "🔧" },
    { k: "cust",  nm: "お客さまの声",     ic: "💬" },
    { k: "shift", nm: "シフトのこと",     ic: "🗓️" },
    { k: "other", nm: "その他",          ic: "📝" }
  ];
  function catOf(k) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].k === k) return CATS[i];
    return { k: "", nm: "未分類", ic: "▫️" };   // 種類が付く前に届いた報告
  }

  /* 来店の数えかた。紙の表と同じ並び（欧米／アジア／日本人 × 男／女／子供）。
     言葉を変えたいときは nm だけ直す。k（west / m …）は変えないこと。 */
  var AREAS = [
    { k: "west", nm: "欧米" },
    { k: "asia", nm: "アジア" },
    { k: "jp",   nm: "日本人" }
  ];
  var KINDS = [
    { k: "m",   nm: "男" },
    { k: "f",   nm: "女" },
    { k: "kid", nm: "子供" }
  ];
  function nameOf(list, k) {
    for (var i = 0; i < list.length; i++) if (list[i].k === k) return list[i].nm;
    return "";
  }

  root.Sync = {
    CATS: CATS,
    catOf: catOf,
    AREAS: AREAS,
    KINDS: KINDS,
    areaName: function (k) { return nameOf(AREAS, k) || "（区分なし）" },
    kindName: function (k) { return nameOf(KINDS, k) || "" },
    configure: configure, config: config, isOn: isOn, messageFor: messageFor,
    ping: function () { return rpc("shift_ping", {}) },
    submitRequest: function (r) {
      return rpc("shift_submit_request", {
        p_code: CFG && CFG.code, p_name: r.name, p_month: r.month,
        p_days: r.days || {}, p_note: r.note || ""
      });
    },
    listRequests: function (month) {
      return rpc("shift_list_requests", { p_key: CFG && CFG.key, p_month: month || null });
    },
    publishShift: function (month, days, closed) {
      return rpc("shift_publish", { p_key: CFG && CFG.key, p_month: month, p_days: days || {}, p_closed: closed || [] });
    },
    getShift: function (month) {
      return rpc("shift_get", { p_code: (CFG && (CFG.code || CFG.key)) || "", p_month: month });
    },
    /* 商品リスト（店長用キーだけ。スタッフ用の合言葉では読めない） */
    itemsGet: function (since) {
      return rpc("store_items_get", { p_key: (CFG && CFG.key) || "", p_since: since || null });
    },
    itemsPut: function (items, cats) {
      return rpc("store_items_put", { p_key: (CFG && CFG.key) || "", p_items: items || [], p_cats: cats || null });
    },
    /* 帳簿（変動費・固定費・人件費）。これも店長用キーだけ */
    booksGet: function (since) {
      return rpc("store_books_get", { p_key: (CFG && CFG.key) || "", p_since: since || null });
    },
    booksPut: function (rows) {
      return rpc("store_books_put", { p_key: (CFG && CFG.key) || "", p_rows: rows || [] });
    },
    /* 店長へ報告（ご意見箱）。送るのは合言葉、読む・返すのは店長用キー */
    reportSubmit: function (r) {
      return rpc("report_submit", {
        p_code: (CFG && CFG.code) || "", p_id: r.id,
        p_name: r.name || "", p_title: r.title || "", p_body: r.body || "",
        p_cat: r.cat || ""
      });
    },
    reportListMine: function (ids) {
      return rpc("report_list_mine", { p_code: (CFG && CFG.code) || "", p_ids: ids || [] });
    },
    reportList: function () {
      return rpc("report_list", { p_key: (CFG && CFG.key) || "" });
    },
    reportReply: function (id, reply) {
      return rpc("report_reply", { p_key: (CFG && CFG.key) || "", p_id: id, p_reply: reply });
    },
    reportCancel: function (id) {
      return rpc("report_cancel", { p_code: (CFG && CFG.code) || "", p_id: id });
    },
    /* スタッフ名簿（時給）。出すのは店長用キー、自分のぶんを見るのは合言葉 */
    staffPut: function (rows) {
      return rpc("staff_put", { p_key: (CFG && CFG.key) || "", p_rows: rows || [] });
    },
    staffMe: function () {
      return rpc("staff_me", { p_code: (CFG && CFG.code) || "" });
    },
    /* レジ（会計）。店長用キーだけ。レジは店舗管理アプリの中にある */
    salePut: function (rows) {
      return rpc("sale_put", { p_key: (CFG && CFG.key) || "", p_rows: rows || [] });
    },
    salesGet: function (from, to) {
      return rpc("sales_get", { p_key: (CFG && CFG.key) || "", p_from: from || null, p_to: to || null });
    },
    saleVoid: function (id) {
      return rpc("sale_void", { p_key: (CFG && CFG.key) || "", p_id: id });
    },
    /* 自分の販売力（スタッフ用アプリ）。自分だけの合言葉で、自分のぶんだけ */
    mePower: function (from, to) {
      return rpc("me_power", { p_code: (CFG && CFG.code) || "", p_from: from || null, p_to: to || null });
    },
    /* ランキング（スタッフ用アプリ）。自分だけの合言葉で、全員ぶんの件数だけ */
    powerBoard: function (from, to) {
      return rpc("power_board", { p_code: (CFG && CFG.code) || "", p_from: from || null, p_to: to || null });
    },
    /* 来店（紙で数えていたカウント）。店長用キーだけ */
    visitPut: function (rows) {
      return rpc("visit_put", { p_key: (CFG && CFG.key) || "", p_rows: rows || [] });
    },
    visitDel: function (id) {
      return rpc("visit_del", { p_key: (CFG && CFG.key) || "", p_id: id });
    },
    /* 来店の締め。18時を過ぎたら、その日の数を確定する */
    dayClose: function (today, closeToday) {
      return rpc("day_close", { p_key: (CFG && CFG.key) || "", p_today: today,
        p_close_today: !!closeToday });
    },
    dayOpen: function (day) {
      return rpc("day_open", { p_key: (CFG && CFG.key) || "", p_day: day });
    },
    visitMinus: function (day, area, kind) {
      return rpc("visit_minus", { p_key: (CFG && CFG.key) || "", p_day: day, p_area: area, p_kind: kind });
    },
    visitsGet: function (from, to) {
      return rpc("visits_get", { p_key: (CFG && CFG.key) || "", p_from: from || null, p_to: to || null });
    },
    /* ちょっとした設定（お客様の種類の一覧など）。店長用キーだけ */
    metaGet: function (k) {
      return rpc("meta_get", { p_key: (CFG && CFG.key) || "", p_k: k });
    },
    metaPut: function (k, v) {
      return rpc("meta_put", { p_key: (CFG && CFG.key) || "", p_k: k, p_v: v });
    },
    /* スマホへの通知。登録と解除は店長用キー */
    pushPut: function (sub, label) {
      var k = (sub && sub.keys) || {};
      return rpc("push_put", { p_key: (CFG && CFG.key) || "", p_endpoint: sub.endpoint,
        p_p256dh: k.p256dh || "", p_auth: k.auth || "", p_label: label || "" });
    },
    pushDel: function (endpoint) {
      return rpc("push_del", { p_key: (CFG && CFG.key) || "", p_endpoint: endpoint });
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
