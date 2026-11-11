/* 売上の受け口。収支表はここだけから売上を受け取る。
   中身はレジ（./reg/）が置き場所に書いた会計。

   Sales.get(from, to) … from / to は "2026-10-01" の形（両端を含む）
     返すもの（Promise）
       つながっていないとき: {connected:false}
       つながったとき      : {connected:true, total:売上の合計(円), byDay:{"2026-10-01":円, …}}
     売上は税込で揃えること（経費も税込で入れているため）。

   Sales.rows(from, to) … 会計そのものが要るとき（レジの控え・集計用）
     {connected:false} か {connected:true, rows:[…]}
     打ち消した会計（voided）も入っているので、数えるときは外すこと。

   つないでいないときは {connected:false, local:true, rows:[…]} を返す。
   その端末のレジが打ったぶんだけ。使うかどうかは呼んだ側が決める
   （何も知らずに使うと「お店ぜんぶの売上」に見えてしまうため、
    connected は false のままにしてある）。 */
(function (root) {
  "use strict";

  /* つなぎ先は シフト管理 → ④設定 で入れたものを、そのまま借りている */
  var K_SHIFT = "shiftadmin.v1";
  function cfg() {
    try { var v = JSON.parse(localStorage.getItem(K_SHIFT)); return (v && v.sync) || null }
    catch (e) { return null }
  }
  function on() {
    var c = cfg();
    return !!(root.Sync && c && c.url && c.anon && c.key);
  }

  /* ---- つないでいないときの、この端末のぶん ---- */

  var K_REG = "storereg.v1";

  /* レジ（./reg/）が localStorage に残している会計。
     つないだあとは「送りおわったものは3日で捨てる」ので、ここが全部になるのは
     まだつないでいない端末だけ。つないである端末では使わないこと。 */
  function localRows(from, to) {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(K_REG)) } catch (e) {}
    var list = (v && Array.isArray(v.sales)) ? v.sales : [];
    return list.filter(function (s) {
      var d = String((s && s.day) || "");
      return d && d >= from && d <= to;
    }).slice().sort(function (a, b) {
      return String(a.at || "") < String(b.at || "") ? -1 : 1;
    });
  }

  function rows(from, to) {
    if (!on()) return Promise.resolve({ connected: false, local: true,
                                        rows: localRows(from, to) });
    root.Sync.configure(cfg());
    return root.Sync.salesGet(from, to).then(function (r) {
      return { connected: true, rows: (r && r.items) || [] };
    });
  }

  function get(from, to) {
    return rows(from, to).then(function (r) {
      if (!r.connected) return { connected: false };
      var total = 0, byDay = {};
      r.rows.forEach(function (s) {
        if (s.voided) return;                       /* 打ち消した会計は数えない */
        var a = Number(s.total) || 0;
        total += a;
        byDay[s.day] = (byDay[s.day] || 0) + a;
      });
      return { connected: true, total: total, byDay: byDay };
    });
  }

  root.Sales = { get: get, rows: rows, on: on, localRows: localRows };
})(typeof window !== "undefined" ? window : globalThis);
