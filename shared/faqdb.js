/* マニュアルの質問と答えを、1か所でまとめて面倒みるところ。
   マニュアル（読む・聞く）と、設定 → マニュアル（足す・直す）の両方から使う。

   中身は3つ。
     ・はじめから入っている32問 …… manual/faq.js（window.FAQ）。直すのは私の仕事
     ・店長が足したぶん     …… storefaq.v1 の qa（この端末 → 置き場所 → ほかの端末）
     ・答えられなかった質問  …… storefaq.v1 の miss（辞書を育てる材料）

   置き場所には meta の "faq" に入れる。表を足さずに済ませるため、
   在庫の「月次の報告が必要」と同じやり方にしてある。2026-11-27 */
(function (w) {
  "use strict";

  var K = "storefaq.v1";
  var MK = "faq";                                   /* 置き場所の meta の名前 */
  var CAT0 = { k: "app", nm: "アプリについて", ic: "📱" };   /* はじめからあるカテゴリー */

  var DB = null;

  function load() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(K)) } catch (e) {}
    if (!v || typeof v !== "object") v = {};
    if (!Array.isArray(v.cats)) v.cats = [];
    if (!Array.isArray(v.qa))   v.qa   = [];
    if (!Array.isArray(v.miss)) v.miss = [];
    DB = v;
    return DB;
  }
  function db() { return DB || load() }
  function save() {
    try { localStorage.setItem(K, JSON.stringify(db())) } catch (e) {}
  }

  /* ---------- 字をそろえる ---------- */
  /* カタカナ・全角・記号のちがいで外さないようにする。 */
  function norm(s) {
    s = String(s == null ? "" : s).toLowerCase();
    s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0) });
    s = s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60) });
    s = s.replace(/[\s、。，．・！？!?\-ー－~〜「」『』（）()【】]/g, "");
    return s;
  }
  /* 日本語は単語の切れ目がないので、2文字ずつに切って重なりを見る。
     形態素解析の辞書（10MB以上）を積まずに済ませるための工夫。 */
  function grams(s) {
    if (s.length < 2) return s ? [s] : [];
    var a = []; for (var i = 0; i < s.length - 1; i++) a.push(s.substr(i, 2));
    return a;
  }

  /* ---------- 一覧 ---------- */
  /* はじめの32問に、店長が足した・直したぶんを重ねる。
     おなじ id があれば店長のぶんが勝つ（直す・隠すはこれで効く）。 */
  function all() {
    var out = [], seen = {};
    (db().qa || []).forEach(function (x) {
      if (!x || !x.id) return;
      seen[x.id] = 1;
      if (!x.off && x.q) out.push(norml(x));
    });
    ((w.FAQ) || []).forEach(function (x) {
      if (!x || !x.id || seen[x.id]) return;
      out.push(norml(x));
    });
    return out;
  }
  function norml(x) {
    return { id: x.id, c: x.c || CAT0.k, q: String(x.q || ""), a: String(x.a || ""),
             k: Array.isArray(x.k) ? x.k : [], go: x.go || "", mine: !!x.mine };
  }
  function cats() {
    var n = {};
    all().forEach(function (e) { n[e.c] = (n[e.c] || 0) + 1 });
    var out = [], seen = {};
    [CAT0].concat(db().cats || []).forEach(function (c) {
      if (!c || !c.k || seen[c.k]) return;
      seen[c.k] = 1;
      if (c.off) return;
      out.push({ k: c.k, nm: c.nm || c.k, ic: c.ic || "📄", n: n[c.k] || 0 });
    });
    /* カテゴリーの控えに無い名前が質問に付いていても、消えないように出す */
    Object.keys(n).forEach(function (k) {
      if (!seen[k]) out.push({ k: k, nm: k, ic: "📄", n: n[k] });
    });
    return out;
  }
  function list(c) {
    return all().filter(function (e) { return e.c === c });
  }
  function byId(id) {
    var a = all();
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }

  /* ---------- さがす ---------- */
  var HIT = 4;                                    /* これ未満は「当たっていない」 */
  function search(raw) {
    var nq = norm(raw);
    if (!nq) return [];
    var qg = grams(nq), out = [];
    all().forEach(function (e, i) {
      var words = [e.q].concat(e.k || []).map(norm).filter(Boolean);
      var g = {};
      words.forEach(function (ww) { grams(ww).forEach(function (x) { g[x] = 1 }) });
      /* 言いかえが丸ごと入っていたら、強く当たったとみなす。
         いちばん強く当たったものを採る（はじめに当たったもの、ではない）。 */
      var best = 0;
      for (var j = 0; j < words.length; j++) {
        var ww = words[j];
        if (ww.length >= 2 && nq.indexOf(ww) >= 0) best = 5;
        else if (ww.indexOf(nq) >= 0 && best < 4) best = 4;
        else if (ww.length === 1 && nq.indexOf(ww) >= 0 && best < 3) best = 3;
        if (best === 5) break;
      }
      var m = 0;
      for (var p = 0; p < qg.length; p++) if (g[qg[p]]) m++;
      var sc = best + m;
      if (sc > 0) out.push({ e: e, sc: sc, i: i });
    });
    out.sort(function (a, b) { return b.sc - a.sc || a.i - b.i });
    return out;
  }

  /* ---------- 答えられなかった質問 ---------- */
  /* 文字しか入らないので、レジ金のように1週間で消したりはしない。
     設定 → マニュアル から見て、辞書に足していくための材料。 */
  function remember(raw) {
    var key = norm(raw), d = db();
    var cur = d.miss.filter(function (x) { return x.key === key })[0];
    if (cur) { cur.n = (cur.n || 1) + 1; cur.last = new Date().toISOString() }
    else d.miss.unshift({ key: key, t: String(raw).slice(0, 120), n: 1,
                          last: new Date().toISOString(), done: 0 });
    if (d.miss.length > 500) d.miss.length = 500;
    save();
  }
  function missDone(key, on) {
    var m = db().miss.filter(function (x) { return x.key === key })[0];
    if (m) { m.done = on ? 1 : 0; save() }
  }
  function missDel(key) {
    var d = db();
    d.miss = d.miss.filter(function (x) { return x.key !== key });
    save();
  }

  /* ---------- 足す・直す ---------- */
  function newId() { return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
  function put(x) {
    var d = db();
    if (!x.id) x.id = newId();
    x.mine = true;
    var i = -1;
    for (var j = 0; j < d.qa.length; j++) if (d.qa[j].id === x.id) { i = j; break }
    if (i >= 0) d.qa[i] = x; else d.qa.unshift(x);
    d.at = new Date().toISOString();
    save();
    return x.id;
  }
  function hide(id, on) {
    var e = byId(id) || { id: id };
    var d = db(), cur = null;
    for (var j = 0; j < d.qa.length; j++) if (d.qa[j].id === id) { cur = d.qa[j]; break }
    if (!cur) { cur = { id: id, c: e.c, q: e.q, a: e.a, k: e.k, go: e.go }; d.qa.unshift(cur) }
    cur.off = on ? 1 : 0;
    d.at = new Date().toISOString();
    save();
  }
  function catPut(c) {
    var d = db();
    if (!c.k) c.k = "c" + Date.now().toString(36);
    var i = -1;
    for (var j = 0; j < d.cats.length; j++) if (d.cats[j].k === c.k) { i = j; break }
    if (i >= 0) d.cats[i] = c; else d.cats.push(c);
    d.at = new Date().toISOString();
    save();
    return c.k;
  }

  /* ---------- 置き場所とやりとり ---------- */
  /* 送るのは「店長が足したぶん」だけ。はじめの32問はアプリの中にあるので送らない。
     答えられなかった質問は端末ごとのものなので、これも送らない。 */
  function cfg() {
    try { var v = JSON.parse(localStorage.getItem("shiftadmin.v1")); return (v && v.sync) || null }
    catch (e) { return null }
  }
  function on() {
    var c = cfg();
    return !!(w.Sync && c && c.url && c.anon && c.key);
  }
  async function pull() {
    if (!on()) return false;
    w.Sync.configure(cfg());
    var r = await w.Sync.metaGet(MK);
    var v = r && r.v;
    if (!v || typeof v !== "object") return false;
    var d = db();
    /* 置き場所のほうが新しいときだけ入れ替える */
    if (v.at && d.at && String(v.at) <= String(d.at)) return false;
    d.cats = Array.isArray(v.cats) ? v.cats : [];
    d.qa   = Array.isArray(v.qa)   ? v.qa   : [];
    d.at   = v.at || new Date().toISOString();
    save();
    return true;
  }
  async function push() {
    if (!on()) return false;
    w.Sync.configure(cfg());
    var d = db();
    d.at = new Date().toISOString();
    await w.Sync.metaPut(MK, { cats: d.cats, qa: d.qa, at: d.at });
    save();
    return true;
  }

  w.FaqDB = {
    HIT: HIT, CAT0: CAT0,
    load: load, save: save, db: db,
    norm: norm, all: all, cats: cats, list: list, byId: byId, search: search,
    remember: remember, missDone: missDone, missDel: missDel,
    put: put, hide: hide, catPut: catPut,
    on: on, pull: pull, push: push
  };
})(window);
