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
const SERVICE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
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
  if (!res.ok) return new Response("db error", { status: 500 });
  const subs = (await res.json()) as Array<
    { endpoint: string; p256dh: string; auth: string }
  >;

  let sent = 0, gone = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      // その端末がもう受け取れない（アプリを消した等）なら、覚えておく必要がない
      if (code === 404 || code === 410) {
        await db(`store_push?endpoint=eq.${encodeURIComponent(s.endpoint)}`, {
          method: "DELETE",
        });
        gone++;
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, gone }), {
    headers: { "Content-Type": "application/json" },
  });
});
