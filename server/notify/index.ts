// ご意見箱に報告が届いたら、店長のスマホに通知を出す。
//
// Supabase の Edge Function として動かす。名前は notify。
// 呼ばれるのは Supabase の Database Webhook から（store_reports に insert されたとき）。
//
// 置く秘密（Edge Function の Secrets に入れる。ここにもGitHubにも書かない）
//   VAPID_PRIVATE … 「通知のかぎ.txt」の下のほう
//   VAPID_PUBLIC  … 同じファイルの上のほう（アプリにも入っている）
//   NOTIFY_KEY    … 自分で決めた合言葉。Webhook のヘッダーと同じにする
//
// SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で入れてくれる。

import webpush from "npm:web-push@3.6.7";

// 画面から貼るときに改行や空白が混ざりやすいので、取り除いてから使う。
// base64url の末尾の "=" も、web-push が嫌うので落とす。
function env(name: string) {
  return (Deno.env.get(name) ?? "").trim().replace(/\s+/g, "").replace(/=+$/, "");
}

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();

// データベースを読むための鍵。Supabaseが自動で入れてくれる名前は版によって違うので、
// 考えられるものを順に探す。見つからなければ DB_KEY を自分で足してもらう。
const KEY_NAMES = [
  "DB_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SB_SECRET_KEY",
  "SUPABASE_SECRET_KEY",
];
let keyFrom = "";
let SERVICE_KEY = "";
for (const n of KEY_NAMES) {
  const v = (Deno.env.get(n) ?? "").trim();
  if (v) { SERVICE_KEY = v; keyFrom = n; break; }
}
const VAPID_PUBLIC = env("VAPID_PUBLIC");
const VAPID_PRIVATE = env("VAPID_PRIVATE");
const NOTIFY_KEY = (Deno.env.get("NOTIFY_KEY") ?? "").trim();

// 連絡先として、お店のページのURLを渡す（メールアドレスは渡さない）
// かぎが入っていないときにここで落ちると原因が分からないので、理由を残す。
let vapidError = "";
try {
  webpush.setVapidDetails(
    "https://keiki-takemoto.github.io/store/",
    VAPID_PUBLIC,
    VAPID_PRIVATE,
  );
} catch (e) {
  vapidError = String((e as Error)?.message ?? e);
  console.error("VAPIDのかぎが読めません:", vapidError,
    "VAPID_PUBLIC の長さ:", VAPID_PUBLIC.length,
    "VAPID_PRIVATE の長さ:", VAPID_PRIVATE.length);
}

const db = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

function cut(s: string, n: number) {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

Deno.serve(async (req) => {
  // 合言葉が合わないものは受け付けない
  if (!NOTIFY_KEY || req.headers.get("x-notify-key") !== NOTIFY_KEY) {
    return new Response("forbidden", { status: 401 });
  }

  console.log("DBの鍵:", keyFrom || "見つかりません",
    "URL:", SUPABASE_URL ? "あり" : "なし");
  if (!SERVICE_KEY) {
    console.error(
      "データベースを読む鍵がありません。Secrets に DB_KEY という名前で、" +
      "Project Settings → API Keys の service_role（または secret）キーを足してください。",
    );
    return new Response(JSON.stringify({ ok: false, error: "no_db_key" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (vapidError) {
    return new Response(
      JSON.stringify({ ok: false, error: "vapid", detail: vapidError }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const rec = (body as { record?: Record<string, string> }).record ?? {};
  const who = cut(rec.name || "スタッフ", 20);
  const what = cut(rec.title || rec.body || "報告が届きました", 60);

  const payload = JSON.stringify({
    title: "ご意見箱に新しい報告",
    body: `${who} さん：${what}`,
    url: "/store/box/",
    tag: "zipang-report",
  });

  const res = await db("store_push?select=endpoint,p256dh,auth");
  if (!res.ok) {
    const t = await res.text();
    console.error("通知先の一覧を読めません:", res.status, t);
    return new Response("db error", { status: 500 });
  }
  const subs = (await res.json()) as Array<
    { endpoint: string; p256dh: string; auth: string }
  >;
  console.log("通知を出す端末:", subs.length, "台");
  if (subs.length === 0) {
    console.warn("1台も登録されていません。ご意見箱の「このスマホに通知を出す」を押してください。");
  }

  let sent = 0, gone = 0;
  const failed: string[] = [];
  for (const s of subs) {
    const where = new URL(s.endpoint).host;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      sent++;
      console.log("送れました:", where);
    } catch (e) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      const code = err?.statusCode ?? 0;
      console.error("送れません:", where, "status:", code,
        "body:", String(err?.body ?? err?.message ?? e).slice(0, 300));
      failed.push(`${where}:${code}`);
      // その端末がもう受け取れない（アプリを消した等）なら、覚えておく必要がない
      if (code === 404 || code === 410) {
        await db(`store_push?endpoint=eq.${encodeURIComponent(s.endpoint)}`, {
          method: "DELETE",
        });
        gone++;
      }
    }
  }

  console.log("おわり 送れた:", sent, "消した:", gone, "失敗:", failed.join(","));
  return new Response(JSON.stringify({ ok: true, subs: subs.length, sent, gone, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
