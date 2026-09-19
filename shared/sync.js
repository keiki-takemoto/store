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
    if (code === "no_function") return "SQLがまだ流されていないようです（はじめの設定をご確認ください）";
    if (code === "bad_anon") return "anonキーかURLが違います";
    if (code === "offline") return "つながりませんでした";
    if (code === "not_configured") return "置き場所が設定されていません";
    return "うまくいきませんでした";
  }

  async function rpc(fn, args) {
    if (!isOn()) throw err("not_configured");
    var res;
    try {
      res = await fetch(CFG.url + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": CFG.anon,
          "Authorization": "Bearer " + CFG.anon
        },
        body: JSON.stringify(args || {})
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
      throw err("error", m || "うまくいきませんでした");
    }
    if (!data || data.ok !== true) throw err("bad_response", "返事を読み取れませんでした");
    return data;
  }

  root.Sync = {
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
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
