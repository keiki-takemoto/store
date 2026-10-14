/* 売上の受け口。収支表はここだけから売上を受け取る。
   いまはレジ機能がまだ無いので「つながっていない」と返す。
   レジを作ったら、この get() の中身だけを書き換えればよい（収支表の側は直さなくてよい）。

   Sales.get(from, to) … from / to は "2026-10-01" の形（両端を含む）
     返すもの（Promise）
       つながっていないとき: {connected:false}
       つながったとき      : {connected:true, total:売上の合計(円), byDay:{"2026-10-01":円, …}}
     売上は税込で揃えること（経費も税込で入れているため）。 */
(function (root) {
  "use strict";
  function get(from, to) {
    return Promise.resolve({ connected: false });
  }
  root.Sales = { get: get };
})(typeof window !== "undefined" ? window : globalThis);
