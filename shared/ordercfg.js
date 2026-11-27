/* 発注のきまり（カテゴリーごとの仕入先・仕入先ごとの頼み方の追加ぶん）。
   設定 → 仕入先 と 発注 の画面の両方が使う。2026-11-28

   中身 { cat:{ "夜長堂":"v…（仕入先のid）" }, xl:{ "v…":1 }, at:最後に直した時刻(ms) }
     cat … カテゴリーごとの仕入先。このお店はカテゴリーがほぼ仕入先なので、
           1つ決めれば中の商品ぜんぶに付く。商品ごとの仕入先（it.vendor）があれば、そちらが先。
     xl  … 「メール＋Excel」で頼む仕入先の印。
           置き場所の仕入先の表は how を 'mail' か 'web' しか持てない（SQLで決まっている）ので、
           Excel かどうかは別にここで持つ。how は 'mail' のまま。

   置き場所へは meta の "ordercfg" に丸ごと入れる（FAQ と同じやり方。SQL を足さずに済む）。
   どちらが新しいかは at で決める。 */
(function (root) {
  "use strict";
  var K = "storeordercfg.v1", MK = "ordercfg";

  function load() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(K)) } catch (e) {}
    if (!v || typeof v !== "object") v = {};
    if (!v.cat || typeof v.cat !== "object") v.cat = {};
    if (!v.xl || typeof v.xl !== "object") v.xl = {};
    v.at = Number(v.at) || 0;
    return v;
  }
  var C = load();
  function save() { try { localStorage.setItem(K, JSON.stringify(C)) } catch (e) {} }
  function on() { return !!(root.Sync && root.Sync.isOn && root.Sync.isOn()) }

  /* 置き場所に送る。失敗しても端末には残っているので、次に直したときにまた送る */
  function push() {
    if (!on()) return Promise.resolve(false);
    return root.Sync.metaPut(MK, { cat: C.cat, xl: C.xl, at: C.at })
      .then(function () { return true }).catch(function () { return false });
  }
  /* 受け取る。置き場所のほうが新しいときだけ入れかえる */
  function pull() {
    if (!on()) return Promise.resolve(false);
    return root.Sync.metaGet(MK).then(function (r) {
      var v = r && r.v;
      if (!v || typeof v !== "object") return false;
      if ((Number(v.at) || 0) <= C.at) {
        if (C.at > (Number(v.at) || 0)) push();    /* こちらが新しいなら送っておく */
        return false;
      }
      C.cat = (v.cat && typeof v.cat === "object") ? v.cat : {};
      C.xl = (v.xl && typeof v.xl === "object") ? v.xl : {};
      C.at = Number(v.at) || 0;
      save();
      return true;
    }).catch(function () { return false });
  }
  function touch() { C.at = Date.now(); save(); return push() }

  root.OrderCfg = {
    catVendor: function (cat) { return C.cat[String(cat || "")] || "" },
    setCatVendor: function (cat, vid) {
      cat = String(cat || "");
      if (vid) C.cat[cat] = vid; else delete C.cat[cat];
      return touch();
    },
    /* 商品の仕入先。商品ごとに決めてあればそれ、無ければカテゴリーの仕入先 */
    vendorOf: function (it) {
      if (!it) return "";
      return it.vendor || C.cat[String(it.cat || "")] || "";
    },
    isXl: function (vid) { return !!(vid && C.xl[vid]) },
    setXl: function (vid, onOff) {
      if (!vid) return Promise.resolve(false);
      if (onOff) C.xl[vid] = 1; else delete C.xl[vid];
      return touch();
    },
    /* 仕入先を消したとき、その仕入先を指していたカテゴリーを外す */
    dropVendor: function (vid) {
      var ch = false;
      Object.keys(C.cat).forEach(function (k) { if (C.cat[k] === vid) { delete C.cat[k]; ch = true } });
      if (C.xl[vid]) { delete C.xl[vid]; ch = true }
      return ch ? touch() : Promise.resolve(false);
    },
    cats: function () { return C.cat },
    pull: pull, push: push
  };
})(typeof window !== "undefined" ? window : globalThis);
