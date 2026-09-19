/* 置き場所（Google Apps Script）とのやりとり。
   申請者ページと管理者ページの両方が使う。
   つながらないときは必ず例外を投げるので、呼ぶ側で「LINEで送る」に逃がすこと。 */
(function (root) {
  "use strict";
  var CFG = null;   // {url, code, key}

  function configure(c) { CFG = (c && c.url) ? { url: String(c.url).trim(), code: c.code || "", key: c.key || "" } : null }
  function config() { return CFG }
  function isOn() { return !!(CFG && CFG.url) }

  function err(code, message) { var e = new Error(message || code); e.code = code; return e }

  function qs(params) {
    return Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== "" })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]) }).join("&");
  }

  async function get(params) {
    if (!isOn()) throw err("not_configured");
    var res;
    try { res = await fetch(CFG.url + (CFG.url.indexOf("?") < 0 ? "?" : "&") + qs(params), { redirect: "follow" }) }
    catch (e) { throw err("offline", "つながりませんでした") }
    return unwrap(res);
  }
  async function post(body) {
    if (!isOn()) throw err("not_configured");
    var res;
    try {
      res = await fetch(CFG.url, {
        method: "POST", redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },   /* 事前確認を起こさないため */
        body: JSON.stringify(body)
      });
    } catch (e) { throw err("offline", "つながりませんでした") }
    return unwrap(res);
  }
  async function unwrap(res) {
    var text = await res.text().catch(function () { return "" });
    var data = null;
    try { data = JSON.parse(text) } catch (e) {}
    if (!data) {
      if (/<html/i.test(text)) throw err("not_published", "URLが違うか、公開の設定ができていません");
      throw err("bad_response", "返事を読み取れませんでした");
    }
    if (!data.ok) throw err(data.error || "error", messageFor(data.error));
    return data;
  }
  function messageFor(code) {
    if (code === "bad_code") return "合言葉が違います";
    if (code === "bad_key") return "管理用キーが違います";
    if (code === "bad_input") return "送る内容に不足があります";
    return "うまくいきませんでした";
  }

  root.Sync = {
    configure: configure, config: config, isOn: isOn, messageFor: messageFor,
    ping: function () { return get({ action: "ping" }) },
    submitRequest: function (r) {
      return post({ action: "submitRequest", code: CFG && CFG.code, name: r.name, month: r.month, days: r.days || {}, note: r.note || "" });
    },
    listRequests: function (month) { return get({ action: "requests", key: CFG && CFG.key, month: month }) },
    publishShift: function (month, days, closed) {
      return post({ action: "publishShift", key: CFG && CFG.key, month: month, days: days, closed: closed || [] });
    },
    getShift: function (month) { return get({ action: "shift", code: CFG && CFG.code, month: month }) }
  };
})(typeof window !== "undefined" ? window : globalThis);
