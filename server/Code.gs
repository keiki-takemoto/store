/**
 * シフト管理の置き場所（Google Apps Script）
 *
 * スタッフが出した希望をスプレッドシートに貯め、店長の画面に渡す。
 * 確定したシフトを受け取って、スタッフの画面に返す。
 *
 * 使い方はアプリの「はじめの設定」ページに書いてある。
 * この2つの合言葉は、この店だけのもの。他人に見せないこと。
 */
var STAFF_CODE = '87dduya6ac';   // スタッフ用（希望を出す・確定シフトを見る）
var ADMIN_KEY  = 'ztstdlprjg6iyhy2uaios7';   // 店長用（希望を全部見る・シフトを公開する）

var SH_REQ = '希望';
var SH_SFT = '確定シフト';

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    switch (p.action) {
      case 'ping':     return json({ ok: true, at: now() });
      case 'requests': return json(listRequests(p));
      case 'shift':    return json(getShift(p));
      default:         return json({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}') } catch (err) {}
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    switch (body.action) {
      case 'submitRequest': return json(submitRequest(body));
      case 'publishShift':  return json(publishShift(body));
      default:              return json({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock() } catch (err2) {}
  }
}

/* ---------- スタッフ：希望を出す ---------- */
function submitRequest(b) {
  if (b.code !== STAFF_CODE) return { ok: false, error: 'bad_code' };
  var name = String(b.name || '').trim();
  var month = String(b.month || '').trim();
  if (!name || !/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: 'bad_input' };

  var sh = sheet(SH_REQ, ['受信日時', '月', '名前', '希望(JSON)', 'メモ']);
  var vals = sh.getDataRange().getValues();
  var row = 0;
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][1]) === month && String(vals[i][2]).trim() === name) { row = i + 1; break }
  }
  var rec = [now(), month, name, JSON.stringify(b.days || {}), String(b.note || '')];
  if (row) sh.getRange(row, 1, 1, rec.length).setValues([rec]);
  else sh.appendRow(rec);
  return { ok: true, at: rec[0] };
}

/* ---------- 店長：希望を受け取る ---------- */
function listRequests(p) {
  if (p.key !== ADMIN_KEY) return { ok: false, error: 'bad_key' };
  var sh = sheet(SH_REQ, ['受信日時', '月', '名前', '希望(JSON)', 'メモ']);
  var vals = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (!r[2]) continue;
    if (p.month && String(r[1]) !== p.month) continue;
    var days = {};
    try { days = JSON.parse(r[3] || '{}') } catch (e) {}
    out.push({ at: String(r[0]), month: String(r[1]), name: String(r[2]).trim(), days: days, note: String(r[4] || '') });
  }
  return { ok: true, items: out };
}

/* ---------- 店長：確定シフトを公開する ---------- */
function publishShift(b) {
  if (b.key !== ADMIN_KEY) return { ok: false, error: 'bad_key' };
  var month = String(b.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: 'bad_input' };
  var sh = sheet(SH_SFT, ['月', '内容(JSON)', '公開日時']);
  var vals = sh.getDataRange().getValues();
  var row = 0;
  for (var i = 1; i < vals.length; i++) if (String(vals[i][0]) === month) { row = i + 1; break }
  var rec = [month, JSON.stringify({ days: b.days || {}, closed: b.closed || [] }), now()];
  if (row) sh.getRange(row, 1, 1, rec.length).setValues([rec]);
  else sh.appendRow(rec);
  return { ok: true, at: rec[2] };
}

/* ---------- スタッフ：確定シフトを見る ---------- */
function getShift(p) {
  if (p.code !== STAFF_CODE && p.key !== ADMIN_KEY) return { ok: false, error: 'bad_code' };
  var sh = sheet(SH_SFT, ['月', '内容(JSON)', '公開日時']);
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(p.month)) {
      var d = { days: {}, closed: [] };
      try { d = JSON.parse(vals[i][1] || '{}') } catch (e) {}
      return { ok: true, month: String(p.month), days: d.days || {}, closed: d.closed || [], publishedAt: String(vals[i][2]) };
    }
  }
  return { ok: true, month: String(p.month), days: null, closed: [], publishedAt: '' };
}

/* ---------- 小物 ---------- */
function sheet(name, header) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function now() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss') }
function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
