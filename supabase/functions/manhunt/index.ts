// @ts-nocheck
// Manhunt: Edge Function "manhunt" (file generato da dev/build.js: modifica i sorgenti in dev/ e rigenera).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

/* ===================== logica di gioco ===================== */
/**
 * Logica di gioco pura: nessun accesso a Firebase qui dentro.
 * Ogni funzione riceve lo stato della partita (oggetto del documento games/{code}),
 * lo modifica e restituisce eventuali informazioni utili. Lancia GameError se l'azione non è valida.
 */

class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const LIMITS = {
  pingSec: [30, 60, 90, 120, 180, 300, 600],
  hideSec: [30, 60, 120, 180, 300, 600],
  durationMin: [10, 15, 20, 30, 45, 60, 90, 120],
  maxMissed: [0, 1, 2, 3, 5],   // ping saltati prima della squalifica (0 = mai)
};
const MAX_PLAYERS = 30;
const MAX_EVENTS = 40;

const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 20);

function newGame(code, uid, name, now) {
  const n = cleanName(name);
  if (!n) throw new GameError("invalid-argument", "Serve un nome.");
  return {
    code, hostId: uid, status: "lobby", gid: null,
    settings: { pingSec: 120, hideSec: 120, durationMin: 30, maxMissed: 2 },
    players: { [uid]: { name: n, role: "hider", joinedAt: now } },
    startAt: null, hideEnd: null, endAt: null, endedAt: null,
    winner: null, lastPingK: -1, lastPingAt: null, lastWarnK: -1, missCountedK: -1, events: [],
    createdAt: now, updatedAt: now,
  };
}

function requireHost(g, uid) {
  if (g.hostId !== uid) throw new GameError("permission-denied", "Solo l'host può farlo.");
}
function requireLobby(g) {
  if (g.status !== "lobby") throw new GameError("failed-precondition", "La partita è già iniziata.");
}
function pushEvent(g, e) {
  g.events = (g.events || []).concat([e]).slice(-MAX_EVENTS);
}

function join(g, uid, name, now) {
  const n = cleanName(name);
  if (!n) throw new GameError("invalid-argument", "Serve un nome.");
  const p = g.players[uid];
  if (p) { p.name = n; return { rejoined: true }; }
  if (g.status === "ended") throw new GameError("failed-precondition", "La partita è finita.");
  if (Object.keys(g.players).length >= MAX_PLAYERS) throw new GameError("resource-exhausted", "La partita è piena.");
  const running = g.status === "running";
  g.players[uid] = { name: n, role: running ? "seeker" : "hider", joinedAt: now };
  if (running) { g.players[uid].late = true; pushEvent(g, { t: now, type: "late", who: uid }); }
  return { rejoined: false };
}

function leave(g, uid) {
  if (!g.players[uid]) return;
  if (g.status === "lobby") {
    delete g.players[uid];
    if (g.hostId === uid) {
      const next = Object.keys(g.players).sort((a, b) => g.players[a].joinedAt - g.players[b].joinedAt)[0];
      if (next) g.hostId = next; else g.status = "ended";
    }
  }
  // durante la partita il giocatore resta in classifica
}

function setRole(g, uid, target, role) {
  requireHost(g, uid); requireLobby(g);
  if (!g.players[target]) throw new GameError("not-found", "Giocatore non trovato.");
  if (role !== "seeker" && role !== "hider") throw new GameError("invalid-argument", "Ruolo non valido.");
  g.players[target].role = role;
}

function kick(g, uid, target) {
  requireHost(g, uid); requireLobby(g);
  if (target === uid) throw new GameError("invalid-argument", "Non puoi rimuovere te stesso.");
  delete g.players[target];
}

function shuffle(g, uid, seekers, rng = Math.random) {
  requireHost(g, uid); requireLobby(g);
  const ids = Object.keys(g.players);
  if (ids.length < 2) throw new GameError("failed-precondition", "Servono almeno 2 giocatori.");
  const k = Math.min(Math.max(1, Math.floor(Number(seekers) || 1)), ids.length - 1);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  ids.forEach((id, i) => { g.players[id].role = i < k ? "seeker" : "hider"; });
}

function setSettings(g, uid, s) {
  requireHost(g, uid); requireLobby(g);
  for (const key of Object.keys(LIMITS)) {
    if (s && s[key] != null) {
      const v = Number(s[key]);
      if (!LIMITS[key].includes(v)) throw new GameError("invalid-argument", `Valore non valido per ${key}.`);
      g.settings[key] = v;
    }
  }
}

function start(g, uid, now) {
  requireHost(g, uid); requireLobby(g);
  const list = Object.values(g.players);
  if (!list.some((p) => p.role === "seeker") || !list.some((p) => p.role === "hider")) {
    throw new GameError("failed-precondition", "Serve almeno un cercatore e un nascosto.");
  }
  const s = g.settings;
  g.gid = now.toString(36);
  g.startAt = now;
  g.hideEnd = now + s.hideSec * 1000;
  g.endAt = g.hideEnd + s.durationMin * 60000;
  g.status = "running"; g.winner = null; g.endedAt = null;
  g.lastPingK = -1; g.lastPingAt = null; g.lastWarnK = -1; g.missCountedK = -1; g.events = [];
  if (g.settings.maxMissed == null) g.settings.maxMissed = 2;
  for (const p of list) { p.origRole = p.role; delete p.caughtAt; delete p.caughtBy; delete p.late; delete p.missed; delete p.dq; }
  return g.gid;
}

function rematch(g, uid) {
  requireHost(g, uid);
  if (g.status !== "ended") throw new GameError("failed-precondition", "La partita non è finita.");
  for (const p of Object.values(g.players)) {
    p.role = p.origRole || p.role;
    delete p.caughtAt; delete p.caughtBy; delete p.late; delete p.origRole; delete p.missed; delete p.dq;
  }
  Object.assign(g, { status: "lobby", gid: null, startAt: null, hideEnd: null, endAt: null, endedAt: null,
    winner: null, lastPingK: -1, lastPingAt: null, lastWarnK: -1, missCountedK: -1, events: [] });
}

/** reporter: chi segnala (cercatore oppure il nascosto stesso). by: chi l'ha preso (facoltativo). */
function reportCatch(g, reporter, hiderId, byId, now) {
  if (g.status !== "running") throw new GameError("failed-precondition", "La partita non è in corso.");
  if (now < g.hideEnd) throw new GameError("failed-precondition", "Il tempo per nascondersi non è ancora finito.");
  const h = g.players[hiderId];
  if (!h) throw new GameError("not-found", "Giocatore non trovato.");
  if (h.role !== "hider") return { already: true };
  const rep = g.players[reporter];
  if (reporter !== hiderId && (!rep || rep.role !== "seeker")) {
    throw new GameError("permission-denied", "Solo un cercatore o il nascosto stesso può segnalarlo.");
  }
  let by = byId || (reporter !== hiderId ? reporter : null);
  if (by && (!g.players[by] || g.players[by].role !== "seeker")) by = null;
  h.role = "seeker"; h.caughtAt = now; h.caughtBy = by;
  pushEvent(g, { t: now, type: "found", who: hiderId, by });
  checkEnd(g, now);
  return { already: false };
}

function hidersLeft(g) { return Object.keys(g.players).filter((id) => g.players[id].role === "hider"); }

function checkEnd(g, now) {
  if (g.status !== "running") return false;
  if (hidersLeft(g).length === 0) { endGame(g, "seekers", now); return true; }
  if (now >= g.endAt) { endGame(g, "hiders", now); return true; }
  return false;
}
function endGame(g, winner, now) {
  g.status = "ended"; g.winner = winner; g.endedAt = Math.min(now, g.endAt || now);
  pushEvent(g, { t: now, type: "end", who: winner });
}

/** Indice dell'ultimo ping che dovrebbe essere già partito (o -1). */
function duePingIndex(g, now) {
  if (g.status !== "running" || now < g.hideEnd) return -1;
  const ms = g.settings.pingSec * 1000;
  const last = Math.min(now, g.endAt - 1);
  return Math.floor((last - g.hideEnd) / ms);
}
function pingTime(g, k) { return g.hideEnd + k * g.settings.pingSec * 1000; }

/** Anticipo dell'avviso push prima di ogni ping: 45 s, o metà intervallo se i ping sono fitti. */
function warnLeadMs(g) { return Math.min(45000, Math.floor((g.settings.pingSec * 1000) / 2)); }
function lastPingIndex(g) { return Math.floor((g.endAt - 1 - g.hideEnd) / (g.settings.pingSec * 1000)); }

/** Indice dell'ultimo avviso che dovrebbe essere già partito (o -1). */
function dueWarnIndex(g, now) {
  if (g.status !== "running") return -1;
  const ms = g.settings.pingSec * 1000, lead = warnLeadMs(g);
  if (now + lead < g.hideEnd) return -1;
  return Math.min(Math.floor((now + lead - g.hideEnd) / ms), lastPingIndex(g));
}

/** Prossimo istante in cui il server deve fare qualcosa (avviso, ping o fine). */
function nextWakeTime(g) {
  const lead = warnLeadMs(g), kMax = lastPingIndex(g);
  const t = [g.endAt];
  if ((g.lastPingK ?? -1) + 1 <= kMax) t.push(pingTime(g, (g.lastPingK ?? -1) + 1));
  if ((g.lastWarnK ?? -1) + 1 <= kMax) t.push(pingTime(g, (g.lastWarnK ?? -1) + 1) - lead);
  return Math.min(...t);
}

/**
 * Conta i ping a cui un nascosto non ha risposto (posizione non aggiornata dopo l'avviso).
 * Oltre il limite fissato nelle regole il nascosto è squalificato e passa ai cercatori.
 * Restituisce gli id squalificati.
 */
function applyMisses(g, k, staleUids, now) {
  if (g.status !== "running" || k <= (g.missCountedK ?? -1)) return [];
  g.missCountedK = k;
  const max = g.settings.maxMissed || 0;
  const dq = [];
  for (const uid of staleUids) {
    const p = g.players[uid];
    if (!p || p.role !== "hider") continue;
    p.missed = (p.missed || 0) + 1;
    if (max > 0 && p.missed >= max) {
      p.role = "seeker"; p.caughtAt = now; p.caughtBy = null; p.dq = true;
      pushEvent(g, { t: now, type: "dq", who: uid });
      dq.push(uid);
    }
  }
  if (dq.length) checkEnd(g, now);
  return dq;
}

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
  const { data: subs, error } = await admin.from("push_subs").select("endpoint, p256dh, auth").in("uid", uids);
  if (error || !subs || !subs.length) return;
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
