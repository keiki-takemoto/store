/* 拡大（ピンチ・ダブルタップ）をさせない。全部の画面が読む。2026-11-28 竹本さんの指示。
   レジで指が2本ふれたり、続けて2回押したりすると画面が大きくなり、
   戻し方が分からなくなるのを防ぐ。

   iPadのSafariは <meta name="viewport" … user-scalable=no> を無視するので、それだけでは止まらない。
   ・CSS の touch-action で、ダブルタップ拡大とピンチを止める
   ・Safari 独自の gesture イベントを止める（ピンチ）
   ・2本指で動かしたときの touchmove を止める
   ・キーボードの ⌘＋／⌘−、トラックパッドの拡大も止める
   入力欄を押したときに勝手に拡大されるのは、viewport の maximum-scale=1 で止めている。 */
(function () {
  "use strict";
  var d = document;
  var css = d.createElement("style");
  css.textContent =
    "html,body,*{touch-action:pan-x pan-y}" +
    "html{-webkit-text-size-adjust:100%;text-size-adjust:100%}";
  (d.head || d.documentElement).appendChild(css);

  function stop(e) { if (e.cancelable) e.preventDefault() }
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (t) {
    d.addEventListener(t, stop, { passive: false });
  });
  d.addEventListener("touchmove", function (e) {
    if (e.touches && e.touches.length > 1) stop(e);
  }, { passive: false });
  /* ダブルタップ拡大は上の touch-action で止まる。
     touchend を止めるやり方は使わない：レジのテンキーを続けて押したときの
     2回目が押されなくなるため。 */
  d.addEventListener("wheel", function (e) { if (e.ctrlKey) stop(e) }, { passive: false });
  d.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0", ";", "^"].indexOf(e.key) >= 0) stop(e);
  });
})();
