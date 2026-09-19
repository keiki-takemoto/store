/* 希望シフトの書式。申請者ページが書き、管理者ページが読む。
   LINEに貼っても読みやすく、貼り付け直せば機械でも読める形にしてある。
   ここを直すときは必ず両方の画面で確かめること。 */
(function (root) {
  "use strict";

  var LABEL = { ok: "終日OK", am: "午前のみ", pm: "午後のみ", ng: "×" };
  var SHORT = { ok: "○", am: "午前", pm: "午後", ng: "×" };

  function z2h(s) {                       // 全角の数字・記号を半角に
    return String(s == null ? "" : s)
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0) })
      .replace(/[：]/g, ":").replace(/[－ー―‐~]/g, "-").replace(/[〜～]/g, "-")
      .replace(/[，、･]/g, ",").replace(/[／]/g, "/").replace(/　/g, " ");
  }
  function isTime(code) { return typeof code === "string" && /^\d{1,2}:\d{2}-/.test(code) }

  /* 「13.5」「13時半」「13:00」→ "13:30" のように直す */
  function toTime(raw) {
    var s = z2h(raw).trim().replace(/時半/, ":30").replace(/時/, ":").replace(/分/, "");
    var m = s.match(/^(\d{1,2})[.](\d)$/);            // 13.5 = 13:30
    if (m) return pad(m[1]) + ":" + (m[2] === "5" ? "30" : pad(String(Math.round(+("0." + m[2]) * 60))));
    m = s.match(/^(\d{1,2}):(\d{1,2})$/);
    if (m) return pad(m[1]) + ":" + pad(m[2]);
    m = s.match(/^(\d{1,2}):?$/);
    if (m) return pad(m[1]) + ":00";
    return "";
  }
  function pad(n) { return String(n).padStart(2, "0") }

  /* 時間指定コード "13:00-17:00" / "13:00-" を作る */
  function timeCode(from, to) {
    var f = toTime(from); if (!f) return "";
    var t = toTime(to);
    return f + "-" + (t || "");
  }
  function timeText(code) {
    var p = String(code).split("-");
    return p[1] ? p[0] + "-" + p[1] : p[0] + "から";
  }
  function codeText(code) { return isTime(code) ? timeText(code) : (SHORT[code] || "") }
  function codeLabel(code) { return isTime(code) ? timeText(code) : (LABEL[code] || "") }

  /* ---- 書く ---- */
  /* days は {"3":"ng","5":"am","9":"13:00-17:00"} 。ok の日は書かない。 */
  function buildRequestText(o) {
    var name = (o.name || "").trim();
    var ym = o.month || "";                            // "2026-10"
    var p = ym.split("-");
    var head = "【シフト希望】" + (p[0] ? p[0] + "年" : "") + (p[1] ? (+p[1]) + "月" : "");
    var g = { ng: [], am: [], pm: [] }, times = [];
    Object.keys(o.days || {}).map(Number).sort(function (a, b) { return a - b }).forEach(function (d) {
      var c = o.days[String(d)];
      if (!c || c === "ok") return;
      if (isTime(c)) times.push(d + "日 " + timeText(c));
      else if (g[c]) g[c].push(d);
    });
    var lines = [head, "名前：" + name, ""];
    if (g.ng.length) lines.push("× " + g.ng.join(", "));
    if (g.am.length) lines.push("午前のみ " + g.am.join(", "));
    if (g.pm.length) lines.push("午後のみ " + g.pm.join(", "));
    times.forEach(function (t) { lines.push("時間 " + t) });
    if (!g.ng.length && !g.am.length && !g.pm.length && !times.length) lines.push("すべて終日OK");
    else lines.push("ほかの日は終日OK");
    if ((o.note || "").trim()) { lines.push("", "メモ：" + o.note.trim()) }
    return lines.join("\n");
  }

  /* ---- 読む ---- */
  /* 1つの貼り付けに何人ぶん入っていてもよい。古い am/pm/off 形式も読む。 */
  function parseRequests(text, fallbackYear) {
    var raw = z2h(text).replace(/\r/g, "");
    var year = fallbackYear || new Date().getFullYear();
    var blocks = splitBlocks(raw);
    var out = [];
    blocks.forEach(function (b) {
      var r = parseBlock(b, year);
      if (r && (Object.keys(r.days).length || r.name)) out.push(r);
    });
    return out;
  }

  function splitBlocks(raw) {
    var lines = raw.split("\n");
    var blocks = [], cur = null;
    lines.forEach(function (ln) {
      var isHead = /【\s*シフト希望/.test(ln) || /^\s*名前\s*[:：]/.test(ln);
      if (isHead && cur && cur.hasName) { blocks.push(cur.lines); cur = null }
      if (!cur) cur = { lines: [], hasName: false };
      if (/^\s*名前\s*[:：]/.test(ln)) cur.hasName = true;
      cur.lines.push(ln);
    });
    if (cur && cur.lines.length) blocks.push(cur.lines);
    return blocks;
  }

  function parseBlock(lines, year) {
    var res = { name: "", month: "", days: {}, note: "" };
    var mon = "";
    lines.forEach(function (ln) {
      var m;
      if ((m = ln.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/))) { mon = m[1] + "-" + pad(m[2]) }
      else if (!mon && (m = ln.match(/(\d{1,2})\s*月(?!\s*\d)/))) { mon = year + "-" + pad(m[1]) }
      if ((m = ln.match(/名前\s*[:：]\s*(.+)$/))) res.name = m[1].trim();
      else if ((m = ln.match(/【\s*シフト希望\s*】\s*(?:\d{4}年)?\s*(?:\d{1,2}月)?\s*(\S.*)$/)) && !res.name) res.name = m[1].trim();
      if ((m = ln.match(/メモ\s*[:：]\s*(.+)$/))) res.note = (res.note ? res.note + " " : "") + m[1].trim();
    });
    res.month = mon;

    lines.forEach(function (ln) {
      var s = ln.trim();
      if (!s || /名前\s*[:：]/.test(s) || /メモ\s*[:：]/.test(s) || /^-+$/.test(s)) return;
      var m;
      /* まとめ書き： × 3, 7, 12 ／ 午前のみ 5,6 */
      if ((m = s.match(/^(?:×|✕|x|X|休み?|NG|ng|不可|出られません)\s*[:：]?\s*([\d,\s日]+)$/))) return setDays(res, m[1], "ng");
      if ((m = s.match(/^(?:午前(?:のみ)?|am|AM)\s*[:：]?\s*([\d,\s日]+)$/))) return setDays(res, m[1], "am");
      if ((m = s.match(/^(?:午後(?:のみ)?|pm|PM)\s*[:：]?\s*([\d,\s日]+)$/))) return setDays(res, m[1], "pm");
      /* 時間 9日 13:00-17:00 */
      if ((m = s.match(/^(?:時間|時刻)?\s*(\d{1,2})\s*日?\s*(\d{1,2}[:.]?\d{0,2})\s*-\s*(\d{0,2}[:.]?\d{0,2})/))) {
        var c = timeCode(m[2], m[3]); if (c) { res.days[String(+m[1])] = c; return }
      }
      if ((m = s.match(/^(?:時間|時刻)?\s*(\d{1,2})\s*日?\s*(?:から)?\s*(\d{1,2}[:.]\d{1,2}|\d{1,2}時半?)\s*(?:から|-)?$/))) {
        var c2 = timeCode(m[2], ""); if (c2) { res.days[String(+m[1])] = c2; return }
      }
      /* 1日ごと： 3日 ×  /  5 午前 / 7日 off / 8日 am・pm */
      if ((m = s.match(/^(\d{1,2})\s*日?\s*[  \t:：]*\s*(.+)$/))) {
        var d = +m[1], v = m[2].trim();
        if (d < 1 || d > 31) return;
        var c3 = readCode(v);
        if (c3) res.days[String(d)] = c3;
      }
    });
    return res;
  }

  function setDays(res, list, code) {
    String(list).split(/[,\s]+/).forEach(function (t) {
      var d = parseInt(String(t).replace(/日/g, ""), 10);
      if (d >= 1 && d <= 31) res.days[String(d)] = code;
    });
  }
  function readCode(v) {
    var s = v.trim();
    if (/^(am|AM|午前(のみ)?)$/.test(s)) return "am";
    if (/^(pm|PM|午後(のみ)?)$/.test(s)) return "pm";
    if (/^(off|OFF|×|✕|x|X|休み?|NG|ng|不可)$/.test(s)) return "ng";
    if (/^(○|◯|o|O|可|終日|終日OK|OK|ok|am[・,\/]pm)$/i.test(s)) return "ok";
    var m = s.match(/^(\d{1,2}[:.]?\d{0,2}|\d{1,2}時半?)\s*-\s*(\d{0,2}[:.]?\d{0,2}|\d{1,2}時半?)?$/);
    if (m) return timeCode(m[1], m[2] || "");
    m = s.match(/^(\d{1,2}[:.]\d{1,2}|\d{1,2}時半?)\s*(?:から)$/);
    if (m) return timeCode(m[1], "");
    return "";
  }

  root.ShiftFormat = {
    LABEL: LABEL, SHORT: SHORT,
    isTime: isTime, toTime: toTime, timeCode: timeCode, timeText: timeText,
    codeText: codeText, codeLabel: codeLabel,
    buildRequestText: buildRequestText, parseRequests: parseRequests
  };
})(typeof window !== "undefined" ? window : globalThis);
