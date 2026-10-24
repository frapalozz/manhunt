/* ===================== server: richieste, motore dei ping, notifiche ===================== */
// (questo blocco viene unito alla logica di gioco da dev/build.js → supabase/functions/manhunt/index.ts)

const SB_URL = Deno.env.get("SUPABASE_URL");
function secretKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (keys.default) return keys.default;
    const first = Object.values(keys)[0];
    if (first) return first;
  } catch (e) {}
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}
const admin = createClient(SB_URL, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

const TICK_SECRET = Deno.env.get("TICK_SECRET");
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:manhunt@example.com";
let pushReady = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); pushReady = true; }
  catch (e) { console.error("chiavi VAPID non valide", e); }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function cleanCode(c) {
  const code = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 5) throw new GameError("invalid-argument", "Il codice ha 5 caratteri.");
  return code;
}

/* ---------- accesso alla partita con controllo di versione (niente modifiche perse) ---------- */
async function loadGame(code) {
  const { data, error } = await admin.from("games").select("state, rev").eq("code", code).maybeSingle();
  if (error) throw error;
  return data;
}
/** fn(g) modifica lo stato e restituisce un risultato; se restituisce false non salva nulla. */
async function mutate(code, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await loadGame(code);
    if (!row) throw new GameError("not-found", `Nessuna partita con il codice ${code}.`);
    const g = row.state;
    const result = fn(g);
    if (result === false) return { g, result, changed: false };
    g.updatedAt = Date.now();
    const { data, error } = await admin.from("games")
      .update({ state: g, rev: row.rev + 1, status: g.status, updated_at: new Date().toISOString() })
      .eq("code", code).eq("rev", row.rev).select("code");
    if (error) throw error;
    if (data && data.length) return { g, result, changed: true };
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
  }
  throw new GameError("aborted", "Troppe modifiche nello stesso momento, riprova.");
}

/* ---------- notifiche push ---------- */
async function push(uids, msg) {
  uids = [...new Set(uids)].filter(Boolean);
  if (!pushReady || !uids.length) return;
  const { data: all, error } = await admin.from("push_subs").select("endpoint, p256dh, auth, seen_at").in("uid", uids);
  if (error || !all) return;
  // chi ha l'app aperta in questo momento vede già tutto a schermo: niente notifica
  const subs = all.filter((s) => !s.seen_at || Date.parse(s.seen_at) < Date.now() - 20000);
  if (!subs.length) return;
  const payload = JSON.stringify({ title: msg.title, body: msg.body, tag: msg.tag || "manhunt", r: msg.r || "", url: `./?g=${msg.code}${msg.r ? "&r=" + msg.r : ""}` });
  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 180, urgency: "high" });
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(s.endpoint);
      else console.warn("push non riuscita", e && (e.statusCode || e.message));
    }
  }));
  if (dead.length) await admin.from("push_subs").delete().in("endpoint", dead);
}
const allPlayers = (g) => Object.keys(g.players);
const seekersOf = (g) => Object.keys(g.players).filter((id) => g.players[id].role === "seeker");
const pushEnd = (code, g) => push(allPlayers(g), {
  code, tag: "end",
  title: g.winner === "seekers" ? "Vincono i cercatori" : "Vincono i nascosti",
  body: "La partita è finita. Apri per vedere la classifica.",
});

/* ---------- azioni dei giocatori ---------- */
async function createGame(uid, data) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let code = "";
    for (let i = 0; i < 5; i++) code += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    const g = newGame(code, uid, data.name, Date.now());
    const { error } = await admin.from("games").insert({ code, state: g, rev: 0, status: "lobby" });
    if (!error) return { code };
    if (error.code !== "23505") throw error; // 23505 = codice già usato, ne provo un altro
  }
  throw new GameError("unavailable", "Non riesco a creare un codice, riprova.");
}

async function gameAction(uid, data) {
  const code = cleanCode(data.code);
  const now = Date.now();
  const { g, result } = await mutate(code, (g) => {
    if (data.op !== "join" && !g.players[uid]) throw new GameError("permission-denied", "Non fai parte di questa partita.");
    switch (data.op) {
      case "join": join(g, uid, data.name, now); return {};
      case "leave": leave(g, uid); return {};
      case "setRole": setRole(g, uid, String(data.target || ""), data.role); return {};
      case "kick": kick(g, uid, String(data.target || "")); return {};
      case "shuffle": shuffle(g, uid, data.seekers); return {};
      case "settings": setSettings(g, uid, data.settings); return {};
      case "start": start(g, uid, now); return { started: true };
      case "rematch": rematch(g, uid); return {};
      case "catch": {
        const hider = String(data.hider || "");
        const r = reportCatch(g, uid, hider, data.by ? String(data.by) : null, now);
        return r.already ? {} : { caught: hider };
      }
      default: throw new GameError("invalid-argument", "Azione sconosciuta.");
    }
  });
  if (result.started) {
    await push(allPlayers(g).filter((id) => id !== uid), { code, tag: "start", title: "La partita è iniziata", body: "Apri Manhunt: i nascosti hanno poco tempo per sparire." });
  }
  if (result.caught) {
    await push([result.caught], { code, tag: "caught", title: "Sei stato trovato", body: "Ora sei un cercatore: apri il sito e dai la caccia agli altri." });
    if (g.status === "ended") await pushEnd(code, g);
  }
  return { code };
}

/* ---------- motore: avvisi, ping, squalifiche, fine partita ---------- */
async function tickGame(code) {
  const now = Date.now();
  const { g, result, changed } = await mutate(code, (g) => {
    if (g.status !== "running") return false;
    if (g.lastWarnK == null) g.lastWarnK = -1;
    const out = { warn: null, ping: null, ended: false };
    const kw = dueWarnIndex(g, now);
    if (kw > g.lastWarnK) { g.lastWarnK = kw; out.warn = { k: kw, hiders: hidersLeft(g), at: pingTime(g, kw) }; }
    const k = duePingIndex(g, now);
    if (k > g.lastPingK) {
      g.lastPingK = k; g.lastPingAt = now;
      out.ping = { k, gid: g.gid, hiders: hidersLeft(g), seekers: seekersOf(g), warnFrom: pingTime(g, k) - warnLeadMs(g) };
    }
    if (checkEnd(g, now)) out.ended = true;
    if (!out.warn && !out.ping && !out.ended) return false;
    return out;
  });
  if (!changed) return;

  if (result.warn && result.warn.hiders.length) {
    const secs = Math.max(5, Math.round((result.warn.at - now) / 1000));
    await push(result.warn.hiders, {
      code, tag: "ping", r: "ping", title: `Ping tra ${secs} secondi`,
      body: "Tocca qui per inviare la tua posizione. Se non rispondi, conta come ping saltato.",
    });
  }
  if (result.ping && result.ping.hiders.length) {
    const stale = await writePings(code, result.ping, now);
    if (stale.length) {
      const r = await mutate(code, (g2) => {
        if (g2.gid !== result.ping.gid) return false;
        const dq = applyMisses(g2, result.ping.k, stale, Date.now());
        return { dq };
      });
      if (r.changed) {
        if (r.result.dq.length) await push(r.result.dq, { code, tag: "caught", title: "Squalificato", body: "Hai saltato troppi ping: ora sei un cercatore." });
        if (r.g.status === "ended") await pushEnd(code, r.g);
      }
    }
    await push(result.ping.seekers, { code, tag: "seekping", title: "Nuovo ping", body: "Le posizioni dei nascosti sono aggiornate." });
  }
  if (result.ended) await pushEnd(code, g);
}

/** Copia le posizioni private nei ping visibili ai cercatori. Restituisce chi non ha risposto all'avviso. */
async function writePings(code, { k, gid, hiders, warnFrom }, now) {
  const { data: locs, error } = await admin.from("locs").select("uid, lat, lng, acc, t, at, bg").eq("code", code).in("uid", hiders);
  if (error) throw error;
  const byUid = Object.fromEntries((locs || []).map((l) => [l.uid, l]));
  const stale = [];
  const rows = hiders.map((uid) => {
    const d = byUid[uid];
    const fixAt = d ? (d.at ? Date.parse(d.at) : d.t) : null;
    const fresh = !!d && ((fixAt && fixAt >= warnFrom - 20000) || d.bg === true);
    if (!fresh) stale.push(uid);
    return d
      ? { code, gid, k, uid, t: now, lat: d.lat, lng: d.lng, acc: d.acc || 0, fix_at: fixAt, stale: !fresh, nofix: false }
      : { code, gid, k, uid, t: now, stale: true, nofix: true };
  });
  const { error: e2 } = await admin.from("pings").upsert(rows, { onConflict: "code,gid,k,uid" });
  if (e2) throw e2;
  return stale;
}

async function tickAll() {
  const { data, error } = await admin.from("games").select("code").eq("status", "running");
  if (error) throw error;
  for (const row of data || []) {
    try { await tickGame(row.code); } catch (e) { console.error("tick", row.code, e); }
  }
  return { games: (data || []).length };
}

/* ---------- ingresso HTTP ---------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body = {};
  try { body = await req.json(); } catch (e) {}
  try {
    if (body.op === "tick") {
      if (!TICK_SECRET || req.headers.get("x-tick-secret") !== TICK_SECRET) return json({ error: { code: "forbidden", message: "no" } }, 403);
      return json(await tickAll());
    }
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth, error: authErr } = token ? await admin.auth.getUser(token) : { data: null, error: true };
    if (authErr || !auth || !auth.user) return json({ error: { code: "unauthenticated", message: "Accesso richiesto: ricarica la pagina." } });
    const uid = auth.user.id;
    const out = body.op === "create" ? await createGame(uid, body) : await gameAction(uid, body);
    return json({ ok: true, serverNow: Date.now(), ...out });
  } catch (e) {
    if (e instanceof GameError) return json({ error: { code: e.code, message: e.message }, serverNow: Date.now() });
    console.error(e);
    return json({ error: { code: "internal", message: "Errore del server, riprova." } });
  }
});
