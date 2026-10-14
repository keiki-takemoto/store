/* 帳簿（変動費・固定費・人件費）の置き場所。経費の画面と収支表の画面が使う。
   まず端末の中（localStorage の storebooks.v1）に入れ、つないであれば
   Supabase の store_books にも送る。商品リストと同じやり方。
   店長用キーが要る関数だけを通すので、スタッフのURLからは見えない。
   つなぎ先は シフト管理 → ③設定 で入れたもの（shiftadmin.v1 の sync）を借りる。

   1件の形（kind で見分ける）
     exp   … 変動費  {id, kind:"exp",   day:"2026-10-15", cat, pay, amount, memo}
     fix   … 固定費  {id, kind:"fix",   day:"",           name, amount, pay, memo}
     labor … 人件費  {id, kind:"labor", day:"2026-10-15", sid, name, start:"17:00", end:"22:30", wage, fare}
           wage は入力した時点の時給。あとで名簿の時給を変えても過去の月は変わらない。 */
(function (root) {
  "use strict";
  var K = "storebooks.v1", K_SHIFT = "shiftadmin.v1";
  var HEAD = { id: 1, kind: 1, day: 1, d: 1, del: 1 };   /* data に入れないもの */

  function load() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(K)) } catch (e) {}
    if (!v || !Array.isArray(v.rows)) v = { rows: [] };
    return v;
  }
  function save() {
    try { localStorage.setItem(K, JSON.stringify(B)); return true }
    catch (e) { return false }
  }
  function shift() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(K_SHIFT)) } catch (e) {}
    return (v && typeof v === "object") ? v : {};
  }
  function uid() { return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }

  var B = load();
  var listeners = [];
  function changed() { listeners.forEach(function (f) { try { f() } catch (e) {} }) }

  /* ---- つなぎ先 ---- */
  function cfg() { var s = shift().sync; return (s && s.url && s.anon && s.key) ? s : null }
  function syncOn() { return !!(root.Sync && cfg()) }
  function configure() { if (root.Sync) Sync.configure(cfg()) }
  configure();

  /* ---- 読む ---- */
  function rows(kind) { return B.rows.filter(function (r) { return !r.del && (!kind || r.kind === kind) }) }
  /* ym = "2026-10" または "2026"（年まるごと） */
  function inPeriod(kind, ym) {
    return rows(kind).filter(function (r) { return String(r.day || "").indexOf(ym) === 0 });
  }

  /* ---- 書く ---- */
  function put(r) {
    if (!r.id) r.id = uid();
    var cur = B.rows.filter(function (x) { return x.id === r.id })[0];
    if (cur) { Object.keys(cur).forEach(function (k) { delete cur[k] }); Object.assign(cur, r) }
    else { cur = r; B.rows.push(cur) }
    cur.d = 1;
    var ok = save(); queueSync(); changed();
    return ok ? cur : null;
  }
  function remove(id) {
    var cur = B.rows.filter(function (x) { return x.id === id })[0];
    if (!cur) return;
    cur.del = 1; cur.d = 1;
    if (!syncOn()) B.rows = B.rows.filter(function (x) { return x !== cur });   /* 伝える先が無ければすぐ消す */
    save(); queueSync(); changed();
  }

  /* ---- 人件費の計算 ---- */
  function toMin(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ""));
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }
  /* 働いた分（分）。終わりが始まりより前なら日をまたいだとみなす（例 18:00〜1:00） */
  function minutes(r) {
    var a = toMin(r.start), b = toMin(r.end);
    if (a == null || b == null) return 0;
    if (b <= a) b += 24 * 60;
    return b - a;
  }
  function pay(r) {   /* お給料（交通費は別） */
    var w = Number(r.wage) || 0;
    return Math.round(minutes(r) / 60 * w);
  }
  function laborCost(r) { return pay(r) + (Number(r.fare) || 0) }

  /* ---- ほかの端末と同じにする ---- */
  var busy = false, timer = null, state = { msg: "", err: "" };
  function pushDirty() {
    var dirty = B.rows.filter(function (r) { return r.d });
    if (!dirty.length) return Promise.resolve(0);
    var out = dirty.map(function (r) {
      var data = {};
      Object.keys(r).forEach(function (k) { if (!HEAD[k]) data[k] = r[k] });
      return { id: r.id, kind: r.kind, day: r.day || "", data: data, deleted: !!r.del };
    });
    var parts = [], p = Promise.resolve();
    for (var i = 0; i < out.length; i += 200) parts.push(out.slice(i, i + 200));
    parts.forEach(function (part) { p = p.then(function () { return Sync.booksPut(part) }) });
    return p.then(function () {
      dirty.forEach(function (r) { delete r.d });
      B.rows = B.rows.filter(function (r) { return !r.del });   /* 消したことは伝えたので手元から外す */
      save();
      return dirty.length;
    });
  }
  function pull() {
    return Sync.booksGet(B.pulledAt || null).then(function (res) {
      var byId = {}; B.rows.forEach(function (r) { byId[r.id] = r });
      (res.rows || []).forEach(function (sr) {
        var cur = byId[sr.id];
        if (cur && cur.d) return;                 /* この端末で直したものは残す。次に送る */
        if (sr.deleted) { if (cur) cur.del = 1; return }
        var r = Object.assign({}, sr.data || {}, { id: sr.id, kind: sr.kind, day: sr.day || "" });
        if (cur) { Object.keys(cur).forEach(function (k) { delete cur[k] }); Object.assign(cur, r) }
        else { B.rows.push(r); byId[r.id] = r }
      });
      B.rows = B.rows.filter(function (r) { return !(r.del && !r.d) });
      if (res.now) B.pulledAt = res.now;
      save();
    });
  }
  function hhmm() { var d = new Date(); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) }
  function syncNow(quiet) {
    configure();
    if (!syncOn() || busy) return Promise.resolve();
    clearTimeout(timer);
    busy = true; changed();
    return pushDirty().then(pull).then(function () {
      busy = false; state.err = ""; state.msg = "ほかの端末と同じです（" + hhmm() + " に確認）";
      changed();
    }).catch(function (e) {
      busy = false;
      state.err = (e && e.message) || "つながりませんでした";
      changed();
      if (!quiet && root.Books.onError) root.Books.onError(state.err);
    });
  }
  function queueSync() {
    if (!syncOn()) return;
    clearTimeout(timer); timer = setTimeout(function () { syncNow(true) }, 1200);
  }
  /* 帯に出す文 */
  function status() {
    if (!syncOn()) return { on: false, text: "" };
    var w = B.rows.filter(function (r) { return r.d }).length;
    return {
      on: true,
      text: busy ? "合わせています…"
        : (w ? ("まだ送っていないもの " + w + "件" + (state.err ? "／" + state.err : "（まもなく送ります）"))
             : (state.err || state.msg || "ほかの端末と同じにしています"))
    };
  }
  /* ほかの画面で変わっていたら読み直す */
  function reload() { B = load(); configure(); changed() }

  root.Books = {
    rows: rows, inPeriod: inPeriod, put: put, remove: remove,
    minutes: minutes, pay: pay, laborCost: laborCost, toMin: toMin,
    staff: function () { var s = shift().staff; return Array.isArray(s) ? s : [] },
    shiftMonths: function () { var m = shift().months; return (m && typeof m === "object") ? m : {} },
    syncOn: syncOn, syncNow: syncNow, status: status, reload: reload,
    onChange: function (f) { listeners.push(f) }, onError: null
  };
})(typeof window !== "undefined" ? window : globalThis);
