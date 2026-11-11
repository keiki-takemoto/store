/* 店長用の画面に、かんたんな鍵をかける。
 *
 * なぜ要るか：店のiPadはカウンターに置きっぱなしになる。鍵が無いと、
 * 誰でも 売上・お給料・仕入れ値・時給 が見られるうえ、
 * 設定 → 置き場所 には「管理用キー」が文字のまま出ている。
 *
 * これは「覗き見を止める鍵」であって、金庫ではない。
 * 中を調べる気のある人は回避できる。止めたいのは、通りすがりに触られること。
 *
 * 決めごと
 *  - 暗証番号は4〜8桁の数字。カウンターで何度も打つので、長い文字列にしない
 *  - 番号そのものは残さない。塩を混ぜて変換した値だけを置く
 *  - 開いた印は sessionStorage に置く。アプリを閉じれば鍵がかかる
 *  - 10分さわらなければ、また鍵がかかる
 *  - 忘れたときは「管理用キー」で解ける（締め出されないように）
 */
(function (root) {
  "use strict";

  var K_LOCK = "storelock.v1";     /* {v,salt,hash} 端末ごと */
  var K_OPEN = "storelock.open";   /* 開いている期限（sessionStorage） */
  var K_SHIFT = "shiftadmin.v1";
  var HOLD = 10 * 60 * 1000;       /* 10分 */

  function get(k, store) {
    try { return JSON.parse((store || localStorage).getItem(k)) } catch (e) { return null }
  }
  function conf() {
    var c = get(K_LOCK);
    return (c && c.hash && c.salt) ? c : null;
  }
  function has() { return !!conf() }

  /* いま開いているか。開いていれば、そのたびに期限を延ばす */
  function open() {
    if (!has()) return true;                 /* 鍵をかけていなければ、ずっと開いている */
    var t = 0;
    try { t = Number(sessionStorage.getItem(K_OPEN)) || 0 } catch (e) {}
    if (!t || Date.now() > t) return false;
    try { sessionStorage.setItem(K_OPEN, String(Date.now() + HOLD)) } catch (e) {}
    return true;
  }
  function markOpen() {
    try { sessionStorage.setItem(K_OPEN, String(Date.now() + HOLD)) } catch (e) {}
  }
  function lockNow() {
    try { sessionStorage.removeItem(K_OPEN) } catch (e) {}
  }

  /* 番号は残さず、塩を混ぜて変換した値だけを置く。
     端末を覗かれても、そこから番号は出てこない。 */
  function salt() {
    var a = new Uint8Array(16), s = "";
    try { crypto.getRandomValues(a) } catch (e) { for (var j = 0; j < 16; j++) a[j] = Math.floor(Math.random() * 256) }
    for (var i = 0; i < a.length; i++) s += ("0" + a[i].toString(16)).slice(-2);
    return s;
  }
  async function digest(s, pin) {
    var buf = new TextEncoder().encode(s + ":" + pin);
    var out = await crypto.subtle.digest("SHA-256", buf);
    var b = new Uint8Array(out), h = "";
    for (var i = 0; i < b.length; i++) h += ("0" + b[i].toString(16)).slice(-2);
    return h;
  }
  function okPin(pin) { return /^[0-9]{4,8}$/.test(String(pin || "")) }

  async function set(pin) {
    if (!okPin(pin)) throw new Error("4〜8桁の数字にしてください");
    var s = salt();
    var c = { v: 1, salt: s, hash: await digest(s, String(pin)) };
    localStorage.setItem(K_LOCK, JSON.stringify(c));
    markOpen();
    return true;
  }
  function clear() { try { localStorage.removeItem(K_LOCK) } catch (e) {} lockNow() }

  async function check(pin) {
    var c = conf(); if (!c) return true;
    if (!okPin(pin)) return false;
    return (await digest(c.salt, String(pin))) === c.hash;
  }
  /* 忘れたとき用。設定 → 置き場所 の「管理用キー」で解ける。
     これが最後の鍵。番号を忘れても締め出されないようにしてある。 */
  function checkMaster(key) {
    var v = get(K_SHIFT), k = v && v.sync && v.sync.key;
    return !!(k && String(key || "").trim() === String(k));
  }
  function hasMaster() {
    var v = get(K_SHIFT);
    return !!(v && v.sync && v.sync.key);
  }

  /* ---- 画面 ---- */
  var CSS = '\
#__lk{position:fixed;inset:0;z-index:2147483000;background:var(--bg,#FAF8F4);\
  display:flex;align-items:center;justify-content:center;padding:20px;\
  font-family:var(--ui,-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif);\
  color:var(--ink,#1B1A17);overflow:auto;-webkit-overflow-scrolling:touch}\
#__lk .bx{width:100%;max-width:330px;text-align:center}\
#__lk .ic{font-size:40px;line-height:1}\
#__lk h2{font-size:17px;margin:12px 0 4px}\
#__lk p{font-size:13px;color:var(--ink-2,#57534A);margin:0 0 18px;line-height:1.8}\
#__lk .dots{display:flex;gap:11px;justify-content:center;margin-bottom:18px;min-height:15px}\
#__lk .dots i{width:13px;height:13px;border-radius:50%;background:var(--line-2,#CFC8B8)}\
#__lk .dots i.on{background:var(--accent,#27496D)}\
#__lk .pad{display:grid;grid-template-columns:repeat(3,1fr);gap:11px}\
#__lk .pad button{font:inherit;font-size:23px;font-weight:600;padding:16px 0;\
  border:1px solid var(--line,#E4DFD4);background:var(--surface,#fff);color:inherit;\
  border-radius:14px;cursor:pointer;-webkit-tap-highlight-color:transparent}\
#__lk .pad button:active{background:var(--surface-2,#F3F0E9)}\
#__lk .pad button.sm{font-size:14px;font-weight:700}\
#__lk .msg{font-size:13px;color:var(--ng,#AE322A);min-height:20px;margin-top:14px}\
#__lk .lnk{margin-top:16px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap}\
#__lk .lnk a{font-size:13px;color:var(--ink-2,#57534A);cursor:pointer;text-decoration:underline}\
#__lk input[type=password],#__lk input[type=text]{width:100%;box-sizing:border-box;font-size:16px;\
  padding:12px;border:1px solid var(--line,#E4DFD4);border-radius:11px;\
  background:var(--surface,#fff);color:inherit;margin-bottom:10px}';

  function style() {
    if (document.getElementById("__lkCss")) return;
    var el = document.createElement("style");
    el.id = "__lkCss"; el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  /* 暗証番号をたずねる。閉じられない形（hard）と、やめられる形がある。 */
  function ask(opt) {
    opt = opt || {};
    return new Promise(function (done) {
      style();
      var old = document.getElementById("__lk");
      if (old) old.remove();
      var box = document.createElement("div");
      box.id = "__lk";
      var pin = "", tries = 0, master = false;
      box.innerHTML =
        '<div class="bx">' +
        '<div class="ic">🔒</div>' +
        '<h2>' + (opt.title || "暗証番号") + '</h2>' +
        '<p>' + (opt.note || "店長用の画面です。暗証番号を入れてください。") + '</p>' +
        '<div class="dots" id="__lkD"></div>' +
        '<div class="pad" id="__lkP">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button data-n="' + n + '">' + n + '</button>' }).join("") +
        '<button class="sm" data-a="del">けす</button>' +
        '<button data-n="0">0</button>' +
        '<button class="sm" data-a="ok">OK</button>' +
        '</div>' +
        '<div class="msg" id="__lkM"></div>' +
        '<div class="lnk" id="__lkL">' +
        (hasMaster() ? '<a data-a="forgot">番号を忘れた</a>' : '') +
        (opt.hard ? '<a data-a="home">ホームへ</a>' : '<a data-a="cancel">やめる</a>') +
        '</div></div>';
      (document.body || document.documentElement).appendChild(box);

      var D = box.querySelector("#__lkD"), M = box.querySelector("#__lkM");
      function dots() {
        D.innerHTML = "";
        for (var i = 0; i < Math.max(4, pin.length); i++) {
          var d = document.createElement("i");
          if (i < pin.length) d.className = "on";
          D.appendChild(d);
        }
      }
      dots();
      function fail(m) {
        M.textContent = m; pin = ""; dots();
        try { if (navigator.vibrate) navigator.vibrate(60) } catch (e) {}
      }
      async function submit() {
        if (!pin) return;
        if (await check(pin)) { markOpen(); box.remove(); done(true); return }
        tries++;
        fail(tries >= 3 ? "番号が違います（" + tries + "回目）" : "番号が違います");
      }
      box.querySelector("#__lkP").addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b) return;
        var n = b.getAttribute("data-n"), a = b.getAttribute("data-a");
        if (n != null) { if (pin.length < 8) { pin += n; dots(); M.textContent = "" } if (pin.length >= 8) submit(); return }
        if (a === "del") { pin = pin.slice(0, -1); dots(); return }
        if (a === "ok") submit();
      });
      box.querySelector("#__lkL").addEventListener("click", function (e) {
        var a = e.target.closest("[data-a]"); if (!a) return;
        var act = a.getAttribute("data-a");
        if (act === "cancel") { box.remove(); done(false); return }
        if (act === "home") { location.href = homeUrl(); return }
        if (act === "forgot" && !master) {
          master = true;
          box.querySelector(".bx").innerHTML =
            '<div class="ic">🔑</div><h2>管理用キーで解く</h2>' +
            '<p>設定 → 置き場所 の<b>管理用キー</b>を入れてください。<br>' +
            'バックアップのファイルの中にも入っています。</p>' +
            '<input type="password" id="__lkK" autocomplete="off" spellcheck="false" placeholder="管理用キー">' +
            '<div class="pad" style="grid-template-columns:1fr 1fr">' +
            '<button class="sm" data-a2="back">もどる</button>' +
            '<button class="sm" data-a2="go">解く</button></div>' +
            '<div class="msg" id="__lkM2"></div>';
          box.querySelector(".bx").addEventListener("click", function (ev) {
            var b2 = ev.target.closest("[data-a2]"); if (!b2) return;
            if (b2.getAttribute("data-a2") === "back") { box.remove(); ask(opt).then(done); return }
            var v = box.querySelector("#__lkK").value;
            if (checkMaster(v)) { markOpen(); box.remove(); done(true) }
            else box.querySelector("#__lkM2").textContent = "合いませんでした";
          });
          return;
        }
      });
    });
  }

  function homeUrl() {
    /* どの階層から呼ばれてもホームに戻れるように、置き場所から見てひとつ上 */
    var p = location.pathname.replace(/[^/]*$/, "");
    return p.replace(/[^/]+\/$/, "") || "/";
  }

  /* 店長用のページの先頭で呼ぶ。鍵がかかっていれば、入るまで中を見せない。 */
  function guard() {
    if (!has() || open()) { watch(); return Promise.resolve(true) }
    return ask({ hard: true }).then(function (ok) { if (ok) watch(); return ok });
  }
  /* 開いたまま置き去りにされたとき用。期限が切れたら、また出す */
  var watching = false;
  function watch() {
    if (watching || !has()) return;
    watching = true;
    setInterval(function () {
      if (document.visibilityState !== "visible") return;
      if (document.getElementById("__lk")) return;
      var t = 0;
      try { t = Number(sessionStorage.getItem(K_OPEN)) || 0 } catch (e) {}
      if (t && Date.now() > t) ask({ hard: true, note: "しばらく使っていなかったので、もう一度入れてください。" });
    }, 20000);
  }

  root.Lock = {
    has: has, open: open, ask: ask, guard: guard,
    set: set, clear: clear, check: check, lockNow: lockNow, markOpen: markOpen
  };
})(window);
