// Meeting alerts sender.
//
// Called fire-and-forget by the app when an admin posts an announcement or a
// Vote Counter opens a poll. Verifies the caller is a real, approved member
// (announcements additionally require an admin), then web-pushes to every
// registered device and prunes subscriptions that have died.
//
// Deploy:   supabase functions deploy notify --no-verify-jwt=false
// Secrets:  supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const APP_URL = "https://wajahat934.github.io/toastmasters-club-app/";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:mwajahat934@gmail.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("method", { status: 405, headers: CORS });

  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return new Response("auth", { status: 401, headers: CORS });

  const { data: prof } = await admin.from("profiles")
    .select("id,role,approved").eq("auth_id", user.id).maybeSingle();
  if (!prof || !prof.approved) return new Response("member", { status: 403, headers: CORS });

  let type = "", data: Record<string, unknown> = {};
  try { ({ type, data } = await req.json()); } catch { /* fall through */ }

  let title = "", body = "";
  if (type === "announcement") {
    if (prof.role !== "admin") return new Response("admin only", { status: 403, headers: CORS });
    title = "📣 Club announcement";
    body = String(data?.text ?? "").slice(0, 140);
  } else if (type === "poll") {
    title = "🗳 Voting is open";
    body = "Tap to cast your vote: " + String(data?.category ?? "").slice(0, 60);
  } else {
    return new Response("type", { status: 400, headers: CORS });
  }

  const { data: subs } = await admin.from("push_subscriptions").select("*");
  const payload = JSON.stringify({ title, body, url: APP_URL });
  const results = await Promise.allSettled(
    (subs ?? []).map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload)
    ),
  );

  const dead: string[] = [];
  results.forEach((r, i) => {
    const code = (r as PromiseRejectedResult).reason?.statusCode;
    if (r.status === "rejected" && (code === 404 || code === 410)) dead.push(subs![i].endpoint);
  });
  if (dead.length) await admin.from("push_subscriptions").delete().in("endpoint", dead);

  return new Response(
    JSON.stringify({ sent: (subs?.length ?? 0) - dead.length, pruned: dead.length }),
    { headers: { ...CORS, "content-type": "application/json" } },
  );
});
