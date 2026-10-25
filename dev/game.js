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
  zoneStart: [0, 500, 1000, 1500, 2000, 3000], // raggio iniziale della zona in metri (0 = niente zona)
  zoneEvery: [120, 180, 300, 600],              // ogni quanti secondi la zona si restringe
  zoneOut: [30, 60, 120, 180],                  // secondi massimi fuori zona prima della squalifica
};
const COUNTDOWN_MS = 3000;   // 3, 2, 1 prima di svelare i ruoli
const ZONE_END_M = 100;      // raggio finale della zona
const ZONE_TOL_M = 50;       // margine massimo concesso per l'imprecisione del GPS
const MAX_PLAYERS = 30;
const MAX_EVENTS = 40;

const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 20);

function newGame(code, uid, name, now) {
  const n = cleanName(name);
  if (!n) throw new GameError("invalid-argument", "Serve un nome.");
  return {
    code, hostId: uid, status: "lobby", gid: null,
    settings: { pingSec: 120, hideSec: 120, durationMin: 30, maxMissed: 2, seekers: 1, zoneStart: 1500, zoneEvery: 300, zoneOut: 60 },
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
  if (s && s.seekers != null) {
    const v = Math.floor(Number(s.seekers));
    if (!(v >= 1 && v < MAX_PLAYERS)) throw new GameError("invalid-argument", "Numero di cercatori non valido.");
    g.settings.seekers = v;
  }
  for (const key of Object.keys(LIMITS)) {
    if (s && s[key] != null) {
      const v = Number(s[key]);
      if (!LIMITS[key].includes(v)) throw new GameError("invalid-argument", `Valore non valido per ${key}.`);
      g.settings[key] = v;
    }
  }
}

/**
 * Avvia la partita: ruoli a caso, conto alla rovescia, zona.
 * opts.center = {lat, lng} punto di partenza della zona (posizione media dei giocatori), opts.rng = numeri casuali.
 */
function start(g, uid, now, opts = {}) {
  requireHost(g, uid); requireLobby(g);
  const rng = opts.rng || Math.random;
  const ids = Object.keys(g.players);
  if (ids.length < 2) throw new GameError("failed-precondition", "Servono almeno 2 giocatori.");
  const s = g.settings;
  const k = Math.min(Math.max(1, Math.floor(Number(s.seekers) || 1)), ids.length - 1);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  ids.forEach((id, i) => { g.players[id].role = i < k ? "seeker" : "hider"; });
  g.gid = now.toString(36);
  g.startAt = now;
  g.revealAt = now + COUNTDOWN_MS;
  g.hideEnd = g.revealAt + s.hideSec * 1000;
  g.endAt = g.hideEnd + s.durationMin * 60000;
  g.status = "running"; g.winner = null; g.endedAt = null;
  g.lastPingK = -1; g.lastPingAt = null; g.lastWarnK = -1; g.missCountedK = -1; g.events = [];
  if (g.settings.maxMissed == null) g.settings.maxMissed = 2;
  for (const p of Object.values(g.players)) {
    p.origRole = p.role;
    for (const f of ["caughtAt", "caughtBy", "late", "missed", "dq", "dqReason", "outSince"]) delete p[f];
  }
  g.zone = null; g.zoneK = 0; g.zoneWarnK = 0;
  if (s.zoneStart > 0) {
    if (opts.center && typeof opts.center.lat === "number") {
      const every = (s.zoneEvery || 300) * 1000;
      const steps = Math.max(0, Math.ceil((g.endAt - g.hideEnd) / every) - 1);
      g.zone = { everyMs: every, outMs: (s.zoneOut || 60) * 1000, zones: makeZones(opts.center, s.zoneStart, steps, rng) };
    } else {
      pushEvent(g, { t: now, type: "nozone", who: "zone" });
    }
  }
  return g.gid;
}

/* ---------- zona ---------- */
function distM(a, b) {
  const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function offsetM(p, d, angle) {
  const dLat = (d * Math.cos(angle)) / 111320, dLng = (d * Math.sin(angle)) / (111320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat + dLat, lng: p.lng + dLng };
}
/** Cerchi della zona: il primo grande, poi sempre più piccoli e spostati a caso dentro il precedente. */
function makeZones(center, r0, steps, rng = Math.random) {
  const zones = [{ lat: center.lat, lng: center.lng, r: r0 }];
  const rEnd = Math.min(ZONE_END_M, r0);
  for (let k = 1; k <= steps; k++) {
    const prev = zones[k - 1];
    const r = Math.round(r0 * Math.pow(rEnd / r0, k / steps));
    const room = Math.max(0, prev.r - r);
    const c = offsetM(prev, room * Math.sqrt(rng()) * 0.9, rng() * Math.PI * 2);
    zones.push({ lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), r });
  }
  return zones;
}
function zoneIndex(g, t) {
  if (!g.zone) return -1;
  if (t < g.hideEnd) return 0;
  return Math.min(g.zone.zones.length - 1, Math.floor((t - g.hideEnd) / g.zone.everyMs));
}
const zoneShrinkAt = (g, k) => g.hideEnd + k * g.zone.everyMs;
const zoneWarnLead = (g) => Math.min(60000, Math.floor(g.zone.everyMs / 3));
function outsideZone(pos, z) { return distM(pos, z) - Math.min(pos.acc || 0, ZONE_TOL_M) > z.r; }

/**
 * Controllo della zona (chiamato dal server ogni pochi secondi).
 * locs: { uid: {lat, lng, acc} } ultime posizioni note. Restituisce cosa notificare.
 */
function applyZone(g, locs, now) {
  const out = { changed: false, shrunk: null, warn: null, nowOut: [], dq: [] };
  if (!g.zone || g.status !== "running" || now < g.hideEnd) return out;
  const zs = g.zone.zones, k = zoneIndex(g, now);
  if (k > (g.zoneK || 0)) {
    g.zoneK = k; out.changed = true; out.shrunk = k;
    pushEvent(g, { t: now, type: "shrink", who: "z" + k });
  }
  const kn = k + 1;
  if (kn < zs.length && now >= zoneShrinkAt(g, kn) - zoneWarnLead(g) && (g.zoneWarnK || 0) < kn) {
    g.zoneWarnK = kn; out.changed = true;
    out.warn = { k: kn, at: zoneShrinkAt(g, kn), ids: hidersLeft(g).filter((id) => locs[id] && outsideZone(locs[id], zs[kn])) };
  }
  const cur = zs[k];
  for (const id of hidersLeft(g)) {
    const p = g.players[id], pos = locs[id];
    if (!pos) continue; // posizione sconosciuta: nessuna penalità
    if (outsideZone(pos, cur)) {
      if (!p.outSince) { p.outSince = now; out.changed = true; out.nowOut.push(id); }
      else if (now - p.outSince >= g.zone.outMs) {
        p.role = "seeker"; p.caughtAt = now; p.caughtBy = null; p.dq = true; p.dqReason = "zone"; delete p.outSince;
        pushEvent(g, { t: now, type: "zone", who: id });
        out.dq.push(id); out.changed = true;
      }
    } else if (p.outSince) { delete p.outSince; out.changed = true; }
  }
  if (out.dq.length) checkEnd(g, now);
  return out;
}
function rematch(g, uid) {
  requireHost(g, uid);
  if (g.status !== "ended") throw new GameError("failed-precondition", "La partita non è finita.");
  for (const p of Object.values(g.players)) {
    p.role = p.origRole || p.role;
    for (const f of ["caughtAt", "caughtBy", "late", "origRole", "missed", "dq", "dqReason", "outSince"]) delete p[f];
  }
  Object.assign(g, { status: "lobby", gid: null, startAt: null, revealAt: null, hideEnd: null, endAt: null, endedAt: null,
    winner: null, lastPingK: -1, lastPingAt: null, lastWarnK: -1, missCountedK: -1, events: [], zone: null, zoneK: 0, zoneWarnK: 0 });
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
      p.role = "seeker"; p.caughtAt = now; p.caughtBy = null; p.dq = true; p.dqReason = "ping"; delete p.outSince;
      pushEvent(g, { t: now, type: "dq", who: uid });
      dq.push(uid);
    }
  }
  if (dq.length) checkEnd(g, now);
  return dq;
}

module.exports = {
  GameError, LIMITS, newGame, join, leave, setRole, kick, shuffle, setSettings, start, rematch,
  reportCatch, checkEnd, endGame, hidersLeft, duePingIndex, pingTime, cleanName,
  warnLeadMs, dueWarnIndex, nextWakeTime, applyMisses, lastPingIndex,
  COUNTDOWN_MS, ZONE_END_M, distM, makeZones, zoneIndex, zoneShrinkAt, outsideZone, applyZone,
};
