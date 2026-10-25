import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

/* ============ Supabase ============ */
const CFG = self.MANHUNT_CONFIG;
const sb = createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "manhunt-auth" },
  realtime: { params: { eventsPerSecond: 10 } },
});

/* ============ costanti e utilità ============ */
const PING_OPTS = [30, 60, 90, 120, 180, 300, 600];
const HIDE_OPTS = [30, 60, 120, 180, 300, 600];
const DUR_OPTS = [10, 15, 20, 30, 45, 60, 90, 120];
const MISS_OPTS = [0, 1, 2, 3, 5];
const COL = { hide: "#9ad8c6", danger: "#ff5c5c", blaze: "#ff6b1a" };
// colori dei nascosti (l'arancione resta riservato ai cercatori, il rosso agli avvisi)
const PALETTE = ["#9ad8c6", "#ff7eb6", "#ffd23f", "#6cb4ff", "#c39bff", "#8ee06a", "#f2f2f2", "#d9a679"];

const chars = (w) => Array.from(w || "");
function baseIni(name, n) {
  const words = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const out = n === 1 ? chars(words[0])[0] : words.length > 1 ? chars(words[0])[0] + chars(words[1])[0] : chars(words[0]).slice(0, 2).join("");
  return out.toUpperCase();
}
/** Iniziali uniche (1 lettera, 2 se serve, poi un numero) e colore stabile per ogni giocatore. */
let looksKey = "", looksVal = {};
function looks() {
  if (!game) return {};
  const P = game.players;
  const ids = Object.keys(P).sort((a, b) => P[a].joinedAt - P[b].joinedAt || (a < b ? -1 : 1));
  const key = ids.map((i) => i + ":" + P[i].name + ":" + (P[i].origRole || P[i].role)).join("|");
  if (key === looksKey) return looksVal;
  const ini = {};
  ids.forEach((i) => (ini[i] = baseIni(P[i].name, 1)));
  const dupes = (m) => { const c = {}; Object.values(m).forEach((v) => (c[v] = (c[v] || 0) + 1)); return c; };
  let c = dupes(ini);
  ids.forEach((i) => { if (c[ini[i]] > 1) ini[i] = baseIni(P[i].name, 2); });
  c = dupes(ini); const seen = {};
  ids.forEach((i) => { if (c[ini[i]] > 1) { seen[ini[i]] = (seen[ini[i]] || 0) + 1; ini[i] = ini[i].slice(0, 2) + seen[ini[i]]; } });
  // i colori seguono l'ordine dei nascosti iniziali, così restano gli stessi per tutta la partita
  const hid = ids.filter((i) => (P[i].origRole || P[i].role) === "hider"), rest = ids.filter((i) => !hid.includes(i));
  const out = {};
  [...hid, ...rest].forEach((i, n) => (out[i] = { ini: ini[i], color: PALETTE[n % PALETTE.length] }));
  looksKey = key; looksVal = out;
  return out;
}
const look = (id) => looks()[id] || { ini: "?", color: COL.hide };
const iniBadge = (id, extra = "") => { const l = look(id); return `<span class="ini ${extra}" style="--c:${l.color}">${esc(l.ini)}</span>`; };

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 20);
const vib = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
function fmt(ms) {
  ms = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(ms / 3600), m = Math.floor((ms % 3600) / 60), s = ms % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function ago(t) {
  const s = Math.round((now() - t) / 1000);
  if (s < 10) return "adesso"; if (s < 60) return s + " s fa";
  const m = Math.floor(s / 60); return m < 60 ? m + " min fa" : Math.floor(m / 60) + " h fa";
}
const secLabel = (s) => (s < 60 ? s + " s" : s % 60 ? (s / 60).toFixed(1).replace(".", ",") + " min" : s / 60 + " min");
function dist(a, b) {
  const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const CARD = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const fmtDist = (m) => (m < 1000 ? Math.round(m / 5) * 5 + " m" : (m / 1000).toFixed(1).replace(".", ",") + " km");

/* orologio allineato al server */
let offset = store.get("mh_offset", 0) || 0;
const now = () => Date.now() + offset;

/* ============ stato ============ */
let uid = null, code = null, game = null;
let pings = [], byHider = {}, mates = {};
let subKey = "";
let myPos = null, gps = "off", watchId = null, lastLocWrite = 0, lastLocWriteServer = 0, lastMateWrite = 0, lastAutoTry = 0;
let pushState = "unknown";
let pendingRespond = false;
let armed = null, picking = false, seekCount = null, screen = null;
let seenEvents = null, prevPingK = null;
const params = new URLSearchParams(location.search);

/* ============ chiamate al server (Edge Function "manhunt") ============ */
async function call(op, data = {}) {
  const sent = Date.now();
  const { data: res, error } = await sb.functions.invoke("manhunt", { body: { op, ...data } });
  const recv = Date.now();
  if (error && !res) throw new Error("Server non raggiungibile. Controlla la connessione.");
  if (res && typeof res.serverNow === "number" && recv - sent < 5000) {
    offset = Math.round(res.serverNow - (sent + recv) / 2); store.set("mh_offset", offset);
  }
  if (res && res.error) throw new Error(res.error.message || "Qualcosa è andato storto, riprova.");
  return res;
}
async function act(op, extra = {}) {
  try { await call(op, { code, ...extra }); await refetchGame(); }
  catch (e) { toast(e.message); }
}

/* ============ avvio ============ */
(async function boot() {
  try {
    let { data: { session } } = await sb.auth.getSession();
    if (!session) {
      const r = await sb.auth.signInAnonymously();
      if (r.error) throw r.error;
      session = r.data.session;
    }
    uid = session.user.id;
  } catch (e) {
    const m = String((e && (e.message || e.msg || e.error_description)) || e || "");
    let hint = "Controlla la connessione e config.js.";
    if (/anonymous/i.test(m)) hint = "L'accesso anonimo è disattivato: Supabase → Authentication → Sign In / Providers → attiva \"Allow anonymous sign-ins\" e salva.";
    else if (/api key|apikey|jwt|invalid.*key|unauthorized|401/i.test(m)) hint = "La chiave in config.js (supabaseKey) non è valida: copia la chiave publishable (o anon public) da Project Settings → API Keys.";
    else if (/failed to fetch|networkerror|load failed|fetch/i.test(m)) hint = "Non raggiungo l'indirizzo in config.js (supabaseUrl). Controlla che sia https://ID-PROGETTO.supabase.co e che il progetto non sia in pausa.";
    else if (/rate limit|too many/i.test(m)) hint = "Troppi accessi nuovi dalla stessa rete: aspetta un po' o alza il limite in Authentication → Rate Limits.";
    else if (/captcha/i.test(m)) hint = "In Supabase è attivo il CAPTCHA: disattivalo in Authentication → Attack Protection.";
    $("#boot-msg").textContent = `Non riesco a collegarmi al server. ${hint} (Dettaglio: ${m || "sconosciuto"})`;
    return;
  }
  await initPush();
  if (params.get("r") === "ping" || params.get("r") === "zone") pendingRespond = true;
  const q = (params.get("g") || "").toUpperCase().slice(0, 5);
  const saved = store.get("mh_code", null);
  $("#in-name").value = store.get("mh_name", "") || "";
  if (q) $("#in-code").value = q;
  if (saved && (!q || q === saved)) enter(saved);
  else render();
})();

/* ============ notifiche push (Web Push standard) ============ */
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
let swReg = null;

async function initPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    pushState = isIOS && !standalone ? "needs-install" : "unsupported";
    return;
  }
  try { swReg = await navigator.serviceWorker.register("sw.js"); }
  catch (e) { pushState = "unsupported"; return; }
  navigator.serviceWorker.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "open" && (m.r === "ping" || m.r === "zone")) respondPing();
    if (m.type === "push" && m.data && (m.data.r === "ping" || m.data.r === "zone")) respondPing();
  });
  pushState = Notification.permission; // default | denied | granted
  if (pushState === "granted") subscribePush().catch(() => { pushState = "error"; render(); });
}
async function enablePush() {
  if (!swReg) return;
  try {
    const p = await Notification.requestPermission();
    pushState = p;
    if (p === "granted") await subscribePush();
  } catch (e) { pushState = "error"; toast("Non riesco ad attivare le notifiche: " + (e.message || e)); }
  render();
}
function keyBytes(b64) {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(CFG.vapidPublicKey) });
  const j = sub.toJSON();
  const { error } = await sb.from("push_subs").upsert({ endpoint: j.endpoint, uid, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (error) throw error;
  pushState = "ready";
  if (screen === "lobby") render();
}

/* ============ entra / esci ============ */
let chan = null, pollT = null;
function enter(c) {
  code = c; store.set("mh_code", c);
  history.replaceState(null, "", location.pathname + "?g=" + c);
  game = null; seenEvents = null; prevPingK = null; subKey = ""; seekCount = null; fitted = false;
  if (chan) sb.removeChannel(chan);
  chan = sb.channel("mh-" + c)
    .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `code=eq.${c}` }, (p) => {
      if (p.new && p.new.state) setGame(p.new.state); else refetchGame();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "pings", filter: `code=eq.${c}` }, () => refetchPingsSoon())
    .on("postgres_changes", { event: "*", schema: "public", table: "seeker_pos", filter: `code=eq.${c}` }, (p) => {
      const v = p.new; if (v && v.uid && v.uid !== uid && game && v.gid === game.gid) { mates[v.uid] = v; scheduleMap(); }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") { $("#conn").hidden = true; refetchGame(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") $("#conn").hidden = false;
    });
  clearInterval(pollT);
  pollT = setInterval(refetchGame, 15000); // riserva, se un aggiornamento in tempo reale va perso
  refetchGame();
  startGps();
  render();
}
async function refetchGame() {
  if (!code) return;
  const c = code;
  const { data, error } = await sb.from("games").select("state").eq("code", c).maybeSingle();
  if (c !== code) return;
  if (error) { $("#conn").hidden = false; return; }
  $("#conn").hidden = true;
  if (!data) { leaveLocal(`La partita ${c} è stata chiusa o non ne fai più parte.`); return; }
  setGame(data.state);
}
function setGame(g) {
  if (!g || !g.players) return;
  if (game && g.updatedAt && game.updatedAt && g.updatedAt < game.updatedAt && g.gid === game.gid) return; // aggiornamento vecchio
  if (!g.players[uid] && g.status !== "ended") { leaveLocal("Non fai più parte di questa partita."); return; }
  game = g; onGame();
}
function leaveLocal(msg) {
  if (chan) sb.removeChannel(chan);
  chan = null; clearInterval(pollT); subKey = "";
  code = null; game = null; pings = []; byHider = {}; mates = {};
  store.del("mh_code");
  history.replaceState(null, "", location.pathname);
  showHomeErr(msg || "");
  render();
}
async function leave() {
  const c = code;
  leaveLocal("");
  if (c) call("leave", { code: c }).catch(() => {});
}

/* ============ reazioni allo stato della partita ============ */
const myRole = () => (game && game.players[uid] ? game.players[uid].role : null);

function onGame() {
  // eventi → avvisi
  const evs = game.events || [];
  let personal = false;
  if (!seenEvents) seenEvents = new Set(evs.map((e) => e.t + ":" + e.who));
  else for (const e of evs) {
    const k = e.t + ":" + e.who;
    if (seenEvents.has(k)) continue;
    seenEvents.add(k);
    if (e.type === "end") continue;
    if ((e.type === "found" || e.type === "dq" || e.type === "zone") && e.who === uid) {
      toast(e.type === "dq" ? "Squalificato: troppi ping saltati. Ora sei un cercatore." : e.type === "zone" ? "Squalificato: troppo tempo fuori dalla zona. Ora sei un cercatore." : "Sei stato trovato! Ora sei un cercatore.");
      vib([200, 100, 200]); personal = true;
    } else if (!personal) { toast(eventText(e)); vib(120); }
  }
  // nuovo ping
  const lk = game.status === "running" ? game.lastPingK : null;
  if (prevPingK !== null && lk !== null && lk > prevPingK && !personal) {
    if (myRole() === "seeker") { toast("Nuovo ping: posizioni aggiornate."); vib([80, 60, 80]); }
  }
  prevPingK = lk;
  // sottoscrizioni che dipendono dal ruolo
  const key = `${game.gid}|${myRole()}|${game.status}`;
  if (key !== subKey) { subKey = key; resubscribe(); }
  if (pendingRespond && game.status === "running") { pendingRespond = false; respondPing(); }
  render();
}

function resubscribe() {
  pings = []; byHider = {}; mates = {};
  refetchPings(); refetchMates();
}
let pingsT = null;
function refetchPingsSoon() { clearTimeout(pingsT); pingsT = setTimeout(refetchPings, 300); }
async function refetchPings() {
  if (!game || !game.gid || game.status === "lobby" || !myRole()) { pings = []; byHider = {}; return; }
  const gid = game.gid;
  const { data } = await sb.from("pings").select("*").eq("code", code).eq("gid", gid);
  if (!game || game.gid !== gid) return;
  pings = data || [];
  byHider = {};
  for (const p of pings) (byHider[p.uid] = byHider[p.uid] || []).push(p);
  for (const id in byHider) byHider[id].sort((a, b) => a.k - b.k);
  renderSoon(); scheduleMap();
}
async function refetchMates() {
  mates = {};
  if (!game || myRole() !== "seeker" || game.status !== "running") return;
  const gid = game.gid;
  const { data } = await sb.from("seeker_pos").select("*").eq("code", code);
  (data || []).forEach((v) => { if (v.gid === gid && v.uid !== uid) mates[v.uid] = v; });
  scheduleMap();
}

function eventText(e) {
  const P = game ? game.players : {};
  const n = (id) => (P[id] && P[id].name) || "Qualcuno";
  if (e.type === "found") return e.by ? `${n(e.by)} ha trovato ${n(e.who)}` : `${n(e.who)} è stato trovato`;
  if (e.type === "late") return `${n(e.who)} si è unito ai cercatori`;
  if (e.type === "dq") return `${n(e.who)} è squalificato: troppi ping saltati`;
  if (e.type === "zone") return `${n(e.who)} è squalificato: troppo tempo fuori zona`;
  if (e.type === "shrink") return "La zona si è ristretta";
  if (e.type === "nozone") return "Zona disattivata: nessuna posizione GPS all'avvio";
  if (e.type === "end") return e.who === "seekers" ? "Tutti trovati!" : "Tempo scaduto!";
  return "";
}

/* ============ GPS ============ */
function startGps() {
  if (watchId !== null) return;
  if (!("geolocation" in navigator)) { gps = "unsupported"; return; }
  gps = "wait";
  watchId = navigator.geolocation.watchPosition((p) => {
    myPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
    if (gps !== "ok") { gps = "ok"; render(); }
    writeLoc(false); scheduleMap(); renderSoon();
  }, (err) => {
    gps = err.code === 1 ? "denied" : "wait";
    if (err.code === 1) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    render();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 });
}
async function writeLoc(force) {
  if (!code || !myPos || !game || !game.players[uid] || document.visibilityState !== "visible") return false;
  if (!force && Date.now() - lastLocWrite < 10000) return false;
  lastLocWrite = Date.now();
  const { error } = await sb.from("locs").upsert({
    code, uid, lat: myPos.lat, lng: myPos.lng, acc: Math.round(myPos.acc || 0), t: Date.now(),
  });
  if (error) return false;
  lastLocWriteServer = now();
  return true;
}
// anche da fermi (il GPS manda aggiornamenti solo quando ci si muove) la posizione resta aggiornata:
// serve al server per il centro della zona all'avvio e per il controllo della zona
setInterval(() => { writeLoc(false); }, 5000);

// i cercatori condividono la loro posizione con la squadra
async function writeMate() {
  if (!game || game.status !== "running" || myRole() !== "seeker" || !myPos) return;
  if (Date.now() - lastMateWrite < 10000) return;
  lastMateWrite = Date.now();
  sb.from("seeker_pos").upsert({ code, uid, lat: myPos.lat, lng: myPos.lng, t: now(), gid: game.gid }).then(() => {}, () => {});
}

/* ============ risposta al ping ============ */
const pingMs = () => game.settings.pingSec * 1000;
const leadMs = () => Math.min(45000, Math.floor(pingMs() / 2));
function nextPingAt(t) {
  if (t < game.hideEnd) return game.hideEnd;
  return game.hideEnd + (Math.floor((t - game.hideEnd) / pingMs()) + 1) * pingMs();
}
function inWarnWindow() {
  if (!game || game.status !== "running") return false;
  const t = now(), nx = nextPingAt(t);
  return nx < game.endAt && nx - t <= leadMs();
}
const respondedThisPing = () => inWarnWindow() && lastLocWriteServer >= nextPingAt(now()) - leadMs() - 15000;

function respondPing() {
  if (!game || game.status !== "running" || myRole() !== "hider") return;
  if (!("geolocation" in navigator)) return;
  navigator.geolocation.getCurrentPosition(async (p) => {
    myPos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
    gps = "ok";
    const ok = await writeLoc(true);
    if (ok) { toast("Posizione inviata. Ora puoi bloccare il telefono."); vib(150); }
    renderSheet(); scheduleMap();
  }, async (err) => {
    if (err.code === 1) { toast("Posizione negata: abilitala nelle impostazioni del browser."); return; }
    // niente posizione nuova in tempo (telefono fermo o al chiuso): vale l'ultima nota
    if (myPos && (await writeLoc(true))) { toast("Posizione inviata (ultima rilevata). Ora puoi bloccare il telefono."); vib(150); renderSheet(); }
    else toast("GPS senza segnale, riprovo tra poco.");
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}

/* presenza: mentre la pagina è in primo piano il server non manda notifiche push (ci pensa l'app) */
let lastSeen = 0;
async function markSeen(active) {
  if (!uid) return;
  lastSeen = Date.now();
  await sb.from("push_subs").update({ seen_at: active ? new Date(now()).toISOString() : null }).eq("uid", uid).then(() => {}, () => {});
}
setInterval(() => { if (document.visibilityState === "visible" && Date.now() - lastSeen > 8000) markSeen(true); }, 2000);
window.addEventListener("pagehide", () => markSeen(false));

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") { markSeen(false); return; }
  markSeen(true);
  if (game && game.status === "running" && myRole() === "hider") respondPing();
  render();
});

/* ciclo: timer a schermo, invio automatico quando l'app è aperta nella finestra del ping */
setInterval(() => {
  if (!game || game.status !== "running") return;
  if (myRole() === "hider" && inWarnWindow() && !respondedThisPing() && document.visibilityState === "visible" && Date.now() - lastAutoTry > 8000) {
    lastAutoTry = Date.now(); respondPing();
  }
  writeMate();
  if (screen === "game") { renderHud(); renderOverlay(); }
  if (screen === "game" && now() > game.endAt + 4000) render();
}, 500);
setInterval(() => { if (screen === "game") renderSheet(); }, 2000);

/* ============ azioni dell'interfaccia ============ */
function showHomeErr(t) { const e = $("#home-err"); e.textContent = t; e.hidden = !t; }
function readName() {
  const n = clip($("#in-name").value);
  if (!n) { showHomeErr("Scrivi il tuo nome per giocare."); $("#in-name").focus(); return null; }
  store.set("mh_name", n); showHomeErr(""); return n;
}
function arm(key) { armed = { key, until: Date.now() + 4000 }; renderSheet(); setTimeout(() => { if (armed && armed.until <= Date.now()) { armed = null; renderSheet(); } }, 4100); }
const isArmed = (key) => armed && armed.key === key && armed.until > Date.now();
let busy = false;

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  switch (a) {
    case "create": {
      const n = readName(); if (!n || busy) return;
      busy = true; b.textContent = "Creo…";
      try { const r = await call("create", { name: n }); enter(r.code); }
      catch (err) { showHomeErr(err.message); }
      busy = false; b.textContent = "Crea partita"; break;
    }
    case "join": {
      const n = readName(); if (!n || busy) return;
      const c = $("#in-code").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (c.length !== 5) { showHomeErr("Il codice ha 5 caratteri."); return; }
      busy = true; b.textContent = "…";
      try { await call("join", { code: c, name: n }); enter(c); }
      catch (err) { showHomeErr(err.message); }
      busy = false; b.textContent = "Entra"; break;
    }
    case "gps": if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } startGps(); render(); break;
    case "push": enablePush(); break;
    case "copy": {
      const url = location.origin + location.pathname + "?g=" + code;
      if (navigator.share) navigator.share({ title: "Manhunt", text: "Entra nella partita " + code, url }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast("Link copiato."), () => toast(url));
      else toast(url);
      break;
    }
    case "role": { const p = game.players[id]; if (p) act("setRole", { target: id, role: p.role === "seeker" ? "hider" : "seeker" }); break; }
    case "kick": act("kick", { target: id }); break;
    case "seek-": act("settings", { settings: { seekers: Math.max(1, (game.settings.seekers || 1) - 1) } }); break;
    case "seek+": act("settings", { settings: { seekers: Math.min(Math.max(1, Object.keys(game.players).length - 1), (game.settings.seekers || 1) + 1) } }); break;
    case "shuffle": act("shuffle", { seekers: seekCount }); break;
    case "start": b.disabled = true; await writeLoc(true); await act("start"); break;
    case "leave": leave(); break;
    case "found": {
      const key = "found:" + id;
      if (!isArmed(key)) { arm(key); return; }
      armed = null; renderSheet(); act("catch", { hider: id, by: uid }); vib(80); break;
    }
    case "caught": picking = !picking; renderSheet(); break;
    case "caughtby": picking = false; renderSheet(); act("catch", { hider: uid, by: id === "?" ? null : id }); break;
    case "respond": respondPing(); break;
    case "center": fitted = false; scheduleMap(); break;
    case "view": view = b.dataset.v === "radar" ? "radar" : "map"; store.set("mh_view", view); applyView(); break;
    case "compass": toggleCompass(); break;
    case "pre-skip": preSkipped = game && game.gid; render(); break;
    case "rematch": act("rematch"); break;
  }
});
document.addEventListener("change", (e) => {
  const t = e.target; if (!t.dataset.set) return;
  act("settings", { settings: { [t.dataset.set]: Number(t.value) } });
});
$("#in-code").addEventListener("keydown", (e) => { if (e.key === "Enter") document.querySelector('[data-act="join"]').click(); });

/* ============ toast ============ */
let toastT = null;
function toast(t) { if (!t) return; const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 4000); }

/* ============ avvisi permessi ============ */
function gpsNotice() {
  const m = {
    off: ["", "Attiva la posizione per giocare.", "Attiva GPS"],
    wait: ["", "Sto cercando il segnale GPS… all'aperto è più veloce.", ""],
    ok: ["good", `GPS attivo · precisione ±${myPos ? Math.round(myPos.acc) : "?"} m`, ""],
    denied: ["bad", "Hai negato la posizione. Abilitala nelle impostazioni del browser per questo sito, poi ricarica.", "Riprova"],
    unsupported: ["bad", "Questo browser non supporta la posizione.", ""],
  }[gps];
  return `<div class="notice ${m[0]}"><span>${esc(m[1])}</span>${m[2] ? `<button class="btn small" data-act="gps">${m[2]}</button>` : ""}</div>`;
}
function installSteps() {
  return `<div class="card"><b>Su iPhone installa prima l'app</b>
    <ol class="steps">
      <li>In Safari tocca <b>Condividi</b> (il quadrato con la freccia).</li>
      <li>Scegli <b>Aggiungi alla schermata Home</b>.</li>
      <li>Apri <b>Manhunt</b> dalla Home e gioca da lì.</li>
    </ol>
    <span class="muted small">Solo così arrivano le notifiche dei ping. Entra nella partita dall'app installata, non da Safari.</span></div>`;
}
function pushNotice() {
  switch (pushState) {
    case "needs-install": return installSteps();
    case "unsupported": return `<div class="notice bad"><span>Questo browser non riceve notifiche: durante i ping dovrai tenere l'app aperta. Su Android usa Chrome.</span></div>`;
    case "default": return `<div class="notice"><span>Attiva le notifiche: ti avvisano prima di ogni ping, anche a telefono bloccato.</span><button class="btn small" data-act="push">Attiva notifiche</button></div>`;
    case "denied": return `<div class="notice bad"><span>Notifiche bloccate. Riattivale dalle impostazioni del browser per questo sito, altrimenti salterai i ping.</span></div>`;
    case "granted": return `<div class="notice"><span>Collego le notifiche…</span></div>`;
    case "ready": return `<div class="notice good"><span>Notifiche attive</span></div>`;
    case "error": return `<div class="notice bad"><span>Notifiche non collegate. Controlla vapidPublicKey in config.js e ricarica.</span><button class="btn small" data-act="push">Riprova</button></div>`;
    default: return "";
  }
}

/* ============ render ============ */
function show(name) {
  if (screen === name) return;
  screen = name;
  for (const s of ["boot", "home", "lobby", "pre", "game", "end"]) $("#s-" + s).hidden = s !== name;
  if (name === "game") { initMap(); applyView(); setTimeout(() => { map && map.invalidateSize(); fitted = false; scheduleMap(); }, 60); }
}
function render() {
  if (!uid) { show("boot"); return; }
  if (!code) {
    show("home");
    $("#home-install").innerHTML = pushState === "needs-install" ? installSteps() : "";
    return;
  }
  if (!game) { show("lobby"); $("#lobby").innerHTML = `<p class="waiting">Mi collego alla partita <b>${esc(code)}</b>…</p><button class="btn ghost" data-act="leave">Annulla</button>`; return; }
  if (game.status === "lobby") { show("lobby"); renderLobby(); }
  else if (inPre()) { show("pre"); renderPre(); }
  else if (game.status === "running" && now() < game.endAt + 4000) { show("game"); renderHud(); renderOverlay(); renderSheet(); scheduleMap(); }
  else if (game.status === "running") { show("lobby"); $("#lobby").innerHTML = `<div class="boot"><div class="spin"></div><span>Tempo scaduto, calcolo il risultato…</span></div>`; }
  else { show("end"); renderEnd(); }
}
let renderQueued = false;
function renderSoon() { if (renderQueued) return; renderQueued = true; setTimeout(() => { renderQueued = false; if (screen === "game") renderSheet(); }, 250); }

const ZONE_START_OPTS = [0, 500, 1000, 1500, 2000, 3000];
const ZONE_EVERY_OPTS = [120, 180, 300, 600];
const ZONE_OUT_OPTS = [30, 60, 120, 180];
function renderLobby() {
  const P = game.players, ids = Object.keys(P).sort((a, b) => P[a].joinedAt - P[b].joinedAt);
  const s = game.settings, n = ids.length, isHost = game.hostId === uid;
  const nSeek = Math.min(Math.max(1, s.seekers || 1), Math.max(1, n - 1)), nHide = Math.max(0, n - nSeek);
  const sel = (key, opts, val, lab) => isHost
    ? `<select id="set-${key}" data-set="${key}">${opts.map((o) => `<option value="${o}" ${o === val ? "selected" : ""}>${lab(o)}</option>`).join("")}</select>`
    : `<div class="val">${lab(val)}</div>`;
  const canStart = n >= 2;
  const missLab = (v) => (v ? `dopo ${v} saltat${v === 1 ? "o" : "i"}` : "mai");
  const zoneOn = (s.zoneStart ?? 0) > 0;
  $("#lobby").innerHTML = `
    <header class="lobby-top">
      <div class="eyebrow">Codice partita</div>
      <div class="bigcode">${esc(code)}</div>
      <div class="lobby-actions"><button class="btn small" data-act="copy">Invita amici</button><a class="btn small ghost" href="tutorial.html">Come si gioca</a></div>
    </header>
    ${gpsNotice()}
    ${pushNotice()}
    <div class="sec-h"><h2>Giocatori</h2><span class="muted small num">${n} in partita</span></div>
    <ul class="players">
      ${ids.map((id) => {
        const p = P[id], tag = [id === uid ? "tu" : "", id === game.hostId ? "host" : ""].filter(Boolean).join(" · ");
        return `<li><span class="nm">${esc(p.name)}${tag ? `<small>${tag}</small>` : ""}</span><span class="chip unknown">?</span>${isHost && id !== uid ? `<button class="x" data-act="kick" data-id="${esc(id)}" aria-label="Rimuovi ${esc(p.name)}">×</button>` : ""}</li>`;
      }).join("")}
    </ul>
    <div class="card">
      <label>Squadre</label>
      <div class="row" style="align-items:center;justify-content:space-between;flex-wrap:wrap">
        ${isHost
          ? `<div class="stepper"><button class="btn" data-act="seek-" aria-label="Meno cercatori" ${nSeek <= 1 ? "disabled" : ""}>−</button><output class="num">${nSeek}</output><button class="btn" data-act="seek+" aria-label="Più cercatori" ${nSeek >= n - 1 ? "disabled" : ""}>+</button><span class="muted small">cercator${nSeek === 1 ? "e" : "i"}</span></div>`
          : `<div class="val">${nSeek} cercator${nSeek === 1 ? "e" : "i"}</div>`}
        <span class="muted small num">${nHide} nascost${nHide === 1 ? "o" : "i"}</span>
      </div>
      <span class="muted small">I ruoli vengono pescati a caso quando parte la partita.</span>
    </div>
    <div class="sec-h"><h2>Regole</h2>${isHost ? "" : `<span class="muted small">decide l'host</span>`}</div>
    <div class="settings">
      <div class="fld"><label for="set-pingSec">Ping ogni</label>${sel("pingSec", PING_OPTS, s.pingSec, secLabel)}</div>
      <div class="fld"><label for="set-hideSec">Per nascondersi</label>${sel("hideSec", HIDE_OPTS, s.hideSec, secLabel)}</div>
      <div class="fld"><label for="set-durationMin">Durata</label>${sel("durationMin", DUR_OPTS, s.durationMin, (v) => v + " min")}</div>
      <div class="fld"><label for="set-maxMissed">Squalifica ping</label>${sel("maxMissed", MISS_OPTS, s.maxMissed ?? 2, missLab)}</div>
    </div>
    <div class="sec-h"><h2>Zona</h2></div>
    <div class="settings">
      <div class="fld full"><label for="set-zoneStart">Raggio iniziale</label>${sel("zoneStart", ZONE_START_OPTS, s.zoneStart ?? 0, (v) => (v ? fmtDist(v) : "Nessuna zona"))}</div>
      ${zoneOn ? `
      <div class="fld"><label for="set-zoneEvery">Si restringe ogni</label>${sel("zoneEvery", ZONE_EVERY_OPTS, s.zoneEvery ?? 300, secLabel)}</div>
      <div class="fld"><label for="set-zoneOut">Fuori zona max</label>${sel("zoneOut", ZONE_OUT_OPTS, s.zoneOut ?? 60, secLabel)}</div>` : ""}
    </div>
    ${zoneOn ? `<p class="muted small" style="margin:0">La zona parte dalla posizione media dei giocatori e si restringe fino a 100 m. Avviate la partita tutti insieme nel punto di ritrovo, con il GPS attivo. Chi si nasconde e resta fuori zona troppo a lungo diventa cercatore.</p>` : ""}
    ${isHost
      ? `<button class="btn primary block" data-act="start" ${canStart ? "" : "disabled"}>Inizia la caccia</button>${canStart ? "" : `<p class="muted small" style="margin:0;text-align:center">Servono almeno 2 giocatori.</p>`}`
      : `<p class="waiting">In attesa che l'host avvii la partita…</p>`}
    <button class="btn ghost" data-act="leave">Esci dalla partita</button>`;
}

function counts() {
  const v = Object.values(game.players);
  return { s: v.filter((p) => p.role === "seeker").length, h: v.filter((p) => p.role === "hider").length };
}
function renderHud() {
  if (screen !== "game" || !game) return;
  const t = now(), role = myRole(), c = counts(), hiding = t < game.hideEnd;
  let bar = "";
  if (!hiding) {
    const rem = nextPingAt(t) - t, pct = 100 - (rem / pingMs()) * 100;
    bar = `<div class="pingbar ${role} ${rem <= 10000 ? "soon" : ""}"><span>Prossimo ping</span><div class="track"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div><b>${fmt(rem)}</b></div>`;
  }
  $("#hud").innerHTML = `
    <span class="phase ${role}">${role === "seeker" ? "Cercatore" : "Nascosto"}</span>
    <div class="clock"><b>${fmt(hiding ? game.hideEnd - t : game.endAt - t)}</b><span>${hiding ? "per nascondersi" : "alla fine"}</span></div>
    <div class="counts num"><span class="s" title="Cercatori">${c.s} C</span><span class="h" title="Nascosti">${c.h} N</span></div>
    ${bar}${zoneBar(t)}`;
}
function zoneBar(t) {
  if (!zoneOn()) return "";
  const z = curZone(t), nAt = nextShrinkAt(t), mz = myZone();
  if (mz && mz.enforced && mz.out) return `<div class="zonebar out"><span>FUORI ZONA</span><span>rientra entro <b>${fmt(mz.left)}</b></span></div>`;
  return `<div class="zonebar"><span>Zona <b>${fmtDist(z.r)}</b>${mz ? ` · bordo a <b>${fmtDist(mz.edge)}</b>` : ""}</span><span>${nAt ? `si restringe tra <b>${fmt(nAt - t)}</b>` : "zona finale"}</span></div>`;
}
function renderOverlay() {
  if (screen !== "game" || !game) return;
  const t = now(), el = $("#overlay"), seeker = myRole() === "seeker";
  if (t >= game.hideEnd) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = seeker
    ? `<div class="eyebrow">Fermi tutti</div><h2>Occhi chiusi</h2><div class="big">${fmt(game.hideEnd - t)}</div><p>I nascosti stanno scappando. Al termine arriva il primo ping con la loro posizione.</p>`
    : `<div class="eyebrow" style="color:var(--hide)">Vai, vai, vai</div><h2>Nasconditi</h2><div class="big" style="color:var(--hide)">${fmt(game.hideEnd - t)}</div><p>Puoi bloccare il telefono: prima di ogni ping ti arriva una notifica da toccare.</p>`;
}

function renderSheet() {
  if (screen !== "game" || !game) return;
  const P = game.players, role = myRole(), t = now();
  const hiders = Object.keys(P).filter((i) => P[i].role === "hider");
  const seekers = Object.keys(P).filter((i) => P[i].role === "seeker");
  const caught = Object.keys(P).filter((i) => P[i].caughtAt).sort((a, b) => P[b].caughtAt - P[a].caughtAt);
  const feed = (game.events || []).filter((e) => e.type !== "end").slice(-5).reverse().map((e) => `<li>${esc(eventText(e))} · ${ago(e.t)}</li>`).join("");
  const max = game.settings.maxMissed || 0;
  let html = "";
  if (role === "seeker") {
    html += `<h3>In fuga · ${hiders.length}</h3>`;
    html += hiders.length ? `<ul class="targets">${hiders.map((id) => {
      const all = byHider[id] || [], latest = all[all.length - 1];
      const fixes = all.filter((p) => !p.nofix), last = fixes[fixes.length - 1];
      let info = t < game.hideEnd ? "ancora nessun ping" : "in attesa del ping…";
      if (last) {
        info = latest && latest.stale ? `<span class="stale">non ha risposto</span> · posizione ${ago(last.fix_at || last.t)}` : `ping ${ago(last.t)}`;
        if (myPos) { const d = dist(myPos, last), br = bearing(myPos, last); info += ` · ${fmtDist(d)} <span class="arrow" style="transform:rotate(${br.toFixed(0)}deg)">↑</span> ${CARD[Math.round(br / 45) % 8]}`; }
        if (last.acc > 40) info += ` · ±${last.acc} m`;
      } else if (latest) info = `<span class="stale">non ha mai inviato la posizione</span>`;
      const missed = P[id].missed ? `<span class="badge ${max && P[id].missed >= max - 1 ? "bad" : ""}">${P[id].missed} saltat${P[id].missed === 1 ? "o" : "i"}</span>` : "";
      const key = "found:" + id, on = isArmed(key);
      return `<li>${iniBadge(id, latest && latest.stale ? "stale" : "")}<span class="t"><b>${esc(P[id].name)}${missed}</b><span>${info}</span></span>
        <button class="btn small ${on ? "armed" : ""}" data-act="found" data-id="${esc(id)}" ${t < game.hideEnd ? "disabled" : ""}>${on ? "Conferma" : "Preso!"}</button></li>`;
    }).join("")}</ul>` : `<p class="muted">Nessuno in fuga.</p>`;
    html += `<h3>Squadra cercatori</h3><div class="team">${seekers.map((id) => `<span class="${id === uid ? "me" : ""}">${esc(P[id].name)}${id === uid ? " (tu)" : ""}</span>`).join("")}</div>`;
  } else {
    const nx = nextPingAt(t), rem = nx - t;
    const mz = myZone();
    if (mz && mz.enforced && mz.out) {
      html += `<div class="alert warn">Sei fuori dalla zona! Rientra entro ${fmt(mz.left)} o diventi cercatore.<span class="zoneline">Bordo a ${fmtDist(mz.edge)} · ${arrowTo(mz.br)}</span></div>`;
    } else if (mz && mz.nextOut && mz.nAt && mz.nAt - t < 120000) {
      html += `<div class="alert warn">Tra ${fmt(mz.nAt - t)} la zona si restringe e resterai fuori.<span class="zoneline">Spostati di ${fmtDist(mz.nextEdge)} · ${arrowTo(mz.nextBr)}</span></div>`;
    } else if (zoneOn() && !myPos) {
      html += `<div class="notice bad"><span>Senza GPS non sai se sei dentro la zona.</span></div>`;
    }
    if (inWarnWindow()) {
      html += respondedThisPing()
        ? `<div class="alert sent">Posizione inviata per questo ping. Puoi bloccare il telefono.</div>`
        : `<div class="alert warn">Ping tra ${fmt(rem)}: invia la tua posizione<button class="btn small" data-act="respond">Invia posizione ora</button></div>`;
    }
    const own = (byHider[uid] || []).filter((p) => !p.nofix), last = own[own.length - 1];
    const me = P[uid] || {};
    html += `<div class="hidecard">
      <span class="eyebrow">${t < game.hideEnd ? "Primo ping tra" : "Prossimo ping tra"}</span>
      <div class="big ${rem <= 10000 ? "soon" : ""}">${fmt(rem)}</div>
      <span class="muted small">${last ? `Ultimo ping ${ago(last.t)}: è l'ultima posizione che vedono i cercatori.` : "I cercatori non hanno ancora la tua posizione."}</span>
      <span class="muted small" style="display:flex;align-items:center;gap:8px">Sulla mappa dei cercatori sei ${iniBadge(uid, "sm")}</span>
      ${mz && !mz.out ? `<span class="muted small zoneline">Sei nella zona · bordo a ${fmtDist(mz.edge)}</span>` : ""}
      ${max ? `<span class="muted small">Ping saltati: <b>${me.missed || 0}</b> su ${max} prima della squalifica.</span>` : ""}
      ${gps !== "ok" ? gpsNotice() : ""}
      ${pushState !== "ready" ? pushNotice() : ""}
    </div>`;
    html += picking
      ? `<div class="card"><label>Chi ti ha preso?</label><div class="who">${seekers.map((id) => `<button class="btn small" data-act="caughtby" data-id="${esc(id)}">${esc(P[id].name)}</button>`).join("")}<button class="btn small ghost" data-act="caughtby" data-id="?">Non so</button></div><button class="btn small ghost" data-act="caught">Annulla</button></div>`
      : `<button class="btn block" data-act="caught" ${t < game.hideEnd ? "disabled" : ""}>Mi hanno preso</button>`;
    html += `<h3>Compagni nascosti</h3><div class="team">${hiders.filter((i) => i !== uid).map((id) => `<span>${esc(P[id].name)}</span>`).join("") || `<span>Sei l'ultimo rimasto</span>`}</div>`;
  }
  if (caught.length) html += `<h3>Presi · ${caught.length}</h3><div class="team">${caught.map((id) => `<span>${esc(P[id].name)}${P[id].dq ? " (squalificato)" : ""}</span>`).join("")}</div>`;
  if (feed) html += `<ul class="feed">${feed}</ul>`;
  html += `<button class="btn small ghost" data-act="leave">Esci dalla partita</button>`;
  const sh = $("#sheet"), top = sh.scrollTop;
  sh.innerHTML = html; sh.scrollTop = top;
}

function renderEnd() {
  const P = game.players;
  const endedAt = game.endedAt || game.endAt, huntMs = Math.max(0, endedAt - game.hideEnd);
  const left = Object.keys(P).filter((i) => P[i].role === "hider");
  const seekersWon = game.winner === "seekers";
  const rows = Object.keys(P).filter((i) => P[i].origRole === "hider")
    .map((id) => ({ id, p: P[id], surv: P[id].caughtAt ? P[id].caughtAt - game.hideEnd : huntMs }))
    .sort((a, b) => b.surv - a.surv);
  const catches = {};
  for (const p of Object.values(P)) if (p.caughtBy) catches[p.caughtBy] = (catches[p.caughtBy] || 0) + 1;
  const best = Object.entries(catches).sort((a, b) => b[1] - a[1])[0];
  $("#end").innerHTML = `
    <div class="eyebrow">Partita ${esc(code)} · ${fmt(huntMs)} di caccia</div>
    <h1 class="winner ${seekersWon ? "seeker" : "hider"}">${seekersWon ? "Vincono i cercatori" : "Vincono i nascosti"}</h1>
    <p class="muted" style="margin:0">${seekersWon ? "Nessun nascosto rimasto in gioco." : `${left.length} ${left.length === 1 ? "è rimasto nascosto" : "sono rimasti nascosti"} fino alla fine.`}
    ${best ? ` Miglior cacciatore: <b>${esc((P[best[0]] || {}).name || "?")}</b> con ${best[1]} ${best[1] === 1 ? "cattura" : "catture"}.` : ""}</p>
    <div class="sec-h"><h2>Classifica</h2><span class="muted small">tempo resistito</span></div>
    <ul class="results">${rows.map((r, i) => `<li><span class="pos num">${i + 1}</span><span class="t"><b>${esc(r.p.name)}${r.id === uid ? " (tu)" : ""}</b><span>${!r.p.caughtAt ? "mai trovato" : r.p.dq ? (r.p.dqReason === "zone" ? "squalificato (fuori zona)" : "squalificato (ping saltati)") : r.p.caughtBy ? "preso da " + esc((P[r.p.caughtBy] || {}).name || "?") : "preso"}</span></span><span class="tm">${fmt(Math.max(0, r.surv))}</span></li>`).join("")}</ul>
    ${game.hostId === uid ? `<button class="btn primary block" data-act="rematch">Rivincita</button>` : `<p class="waiting">L'host può avviare una rivincita.</p>`}
    <button class="btn ghost" data-act="leave">Torna alla home</button>`;
}

/* ============ mappa ============ */
let map = null, layer = null, fitted = false, mapQueued = false, fitSig = "";
function initMap() {
  if (map) return;
  const el = $("#map");
  if (typeof L === "undefined") {
    el.innerHTML = `<div class="mapmsg">Mappa non disponibile: ricarica la pagina. Distanze e direzioni restano nella lista qui sotto.</div>`;
    return;
  }
  map = L.map(el, { zoomControl: false }).setView(myPos ? [myPos.lat, myPos.lng] : [41.9, 12.5], myPos ? 17 : 6);
  // OpenStreetMap: gratuita e senza chiave API
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  layer = L.layerGroup().addTo(map);
  // la mappa nasce nascosta e il pannello sotto cambia altezza: ricalcolo le dimensioni
  if ("ResizeObserver" in window) new ResizeObserver(() => map.invalidateSize()).observe(el);
  setInterval(scheduleMap, 5000);
}
function scheduleMap() { if (mapQueued) return; mapQueued = true; requestAnimationFrame(() => { mapQueued = false; drawMap(); }); }
const icon = (html) => L.divIcon({ className: "mk-wrap", html, iconSize: [0, 0] });
function circleRing(z, n = 72) {
  const out = [], cosLat = Math.cos((z.lat * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([z.lat + (z.r * Math.cos(a)) / 111320, z.lng + (z.r * Math.sin(a)) / (111320 * cosLat)]);
  }
  return out;
}
function drawZone(t) {
  const z = curZone(t); if (!z) return null;
  const box = [[z.lat - 1, z.lng - 1.5], [z.lat - 1, z.lng + 1.5], [z.lat + 1, z.lng + 1.5], [z.lat + 1, z.lng - 1.5]];
  L.polygon([box, circleRing(z)], { stroke: false, fillColor: COL.danger, fillOpacity: 0.16, interactive: false }).addTo(layer);
  L.circle([z.lat, z.lng], { radius: z.r, color: "#ffffff", weight: 2.5, opacity: 0.9, fill: false, interactive: false }).addTo(layer);
  const nz = nextZone(t);
  if (nz) L.circle([nz.lat, nz.lng], { radius: nz.r, color: "#ffffff", weight: 1.5, opacity: 0.8, dashArray: "8 8", fill: false, interactive: false }).addTo(layer);
  return L.latLng(z.lat, z.lng).toBounds(z.r * 2);
}
function drawMap() {
  if (!map || screen !== "game" || !game) return;
  layer.clearLayers();
  const pts = [], P = game.players, role = myRole(), t = now();
  const zoneBounds = drawZone(t);
  const ids = role === "seeker" ? Object.keys(P).filter((i) => P[i].role === "hider") : [uid];
  for (const id of ids) {
    const all = byHider[id] || [], arr = all.filter((p) => !p.nofix);
    if (!arr.length) continue;
    const latest = all[all.length - 1], stale = latest && latest.stale;
    const lk = look(id), cs = `--c:${lk.color}`;
    const ll = arr.map((e) => [e.lat, e.lng]);
    if (ll.length > 1) L.polyline(ll, { color: lk.color, weight: 3, opacity: 0.75, dashArray: "6 8" }).addTo(layer);
    arr.slice(0, -1).forEach((e) => L.marker([e.lat, e.lng], { icon: icon(`<div class="mk ping old" style="${cs}"><div class="pin"></div></div>`), interactive: false }).addTo(layer));
    const last = arr[arr.length - 1];
    if (last.acc && last.acc > 15) L.circle([last.lat, last.lng], { radius: last.acc, color: stale ? COL.danger : lk.color, weight: 1, fillOpacity: 0.08, interactive: false }).addTo(layer);
    const fresh = t - last.t < 12000;
    const nm = id === uid ? "Tu (come ti vedono)" : P[id].name;
    const lbl = stale ? `posizione ${ago(last.fix_at || last.t)}` : ago(last.t);
    L.marker([last.lat, last.lng], { icon: icon(`<div class="mk ping ${fresh ? "fresh" : ""} ${stale ? "stale" : ""}" style="${cs}"><div class="pin">${esc(lk.ini)}</div><div class="lb">${esc(nm)}<i>${esc(lbl)}</i></div></div>`), interactive: false, zIndexOffset: 500 }).addTo(layer);
    pts.push([last.lat, last.lng]);
  }
  if (role === "seeker") {
    for (const [id, m] of Object.entries(mates)) {
      if (!P[id] || P[id].role !== "seeker" || t - m.t > 60000) continue;
      L.marker([m.lat, m.lng], { icon: icon(`<div class="mk mate">${esc(look(id).ini)}</div>`), interactive: false }).addTo(layer);
      pts.push([m.lat, m.lng]);
    }
  }
  if (myPos) {
    L.marker([myPos.lat, myPos.lng], { icon: icon(`<div class="mk me"></div>`), interactive: false, zIndexOffset: 1000 }).addTo(layer);
    pts.push([myPos.lat, myPos.lng]);
  }
  // nuovi ping (o un nuovo nascosto in lista): riadatto la vista per mostrarli tutti
  const mzOut = role === "hider" && myZone() && myZone().out ? "fuori" : "dentro";
  const sig = zoneIdx(t) + mzOut + "#" + ids.map((id) => { const a = byHider[id] || []; return id + ":" + (a.length ? a[a.length - 1].k : "-"); }).join("|");
  if (sig !== fitSig) { fitSig = sig; fitted = false; }
  if (!fitted && (pts.length || zoneBounds)) {
    fitted = true;
    if (zoneBounds) { pts.forEach((p) => zoneBounds.extend(p)); map.fitBounds(zoneBounds, { padding: [30, 30], maxZoom: 18 }); }
    else if (pts.length === 1) map.setView(pts[0], 17); else map.fitBounds(pts, { padding: [50, 50], maxZoom: 18 });
  }
}


/* ============ pre-partita: 3, 2, 1 e ruolo ============ */
const COUNTDOWN_MS = 3000, REVEAL_MS = 4500;
let preSkipped = null;
const inPre = () => !!(game && game.status === "running" && game.revealAt && game.players[uid] && preSkipped !== game.gid && now() < game.revealAt + REVEAL_MS);
function renderPre() {
  const el = $("#pre"), t = now();
  if (t < game.revealAt) {
    const n = Math.max(1, Math.ceil((game.revealAt - t) / 1000));
    if (el.dataset.n === String(n)) return;
    el.dataset.n = String(n); el.className = "pre";
    el.innerHTML = `<div class="eyebrow">I ruoli stanno per essere svelati</div><div class="count">${n}</div><p>Tieni il telefono in mano e non far vedere lo schermo.</p>`;
    vib(60); return;
  }
  const role = myRole(), key = "role-" + role;
  if (el.dataset.n === key) return;
  el.dataset.n = key; el.className = "pre reveal " + role;
  const P = game.players, mins = secLabel(game.settings.hideSec);
  const mates = Object.keys(P).filter((i) => i !== uid && P[i].role === role).map((i) => `<span>${esc(P[i].name)}</span>`).join("");
  el.innerHTML = role === "seeker"
    ? `<div class="eyebrow">Il tuo ruolo</div><div class="role">Cercatore</div>
       <p>Chiudi gli occhi e conta: i nascosti hanno ${mins} per sparire. Poi segui i ping.</p>
       ${mates ? `<div class="eyebrow">Cerchi insieme a</div><div class="team">${mates}</div>` : `<p><b>Cerchi da solo.</b></p>`}
       <button class="btn go" data-act="pre-skip">Vai alla partita</button>`
    : `<div class="eyebrow">Il tuo ruolo</div><div class="role">Nascosto</div>
       <p>Scappa! Hai ${mins} per nasconderti${zoneOn() ? " dentro la zona" : ""}.</p>
       <p class="zoneline" style="justify-content:center">Sulla mappa dei cercatori sei ${iniBadge(uid)}</p>
       ${mates ? `<div class="eyebrow">Nascosti con te</div><div class="team">${mates}</div>` : ""}
       <button class="btn go" data-act="pre-skip">Vai alla partita</button>`;
  vib([200, 100, 400]);
}
setInterval(() => { if (game && (screen === "pre" || inPre())) render(); }, 100);

/* ============ zona ============ */
const zoneOn = () => !!(game && game.zone && game.zone.zones && game.zone.zones.length);
function zoneIdx(t) {
  if (!zoneOn()) return -1;
  if (t < game.hideEnd) return 0;
  return Math.min(game.zone.zones.length - 1, Math.floor((t - game.hideEnd) / game.zone.everyMs));
}
const curZone = (t) => (zoneOn() ? game.zone.zones[zoneIdx(t)] : null);
const nextZone = (t) => (zoneOn() ? game.zone.zones[zoneIdx(t) + 1] || null : null);
const nextShrinkAt = (t) => (nextZone(t) ? game.hideEnd + (zoneIdx(t) + 1) * game.zone.everyMs : null);
const isOutside = (pos, z) => dist(pos, z) - Math.min(pos.acc || 0, 50) > z.r;
let localOutSince = null;
/** Stato della zona per me: fuori? da quando? quanto manca alla squalifica? */
function myZone() {
  const t = now();
  if (!zoneOn() || !game || game.status !== "running" || myRole() !== "hider" || !myPos) return null;
  const z = curZone(t), out = isOutside(myPos, z);
  const d = dist(myPos, z), edge = Math.abs(d - z.r), br = bearing(myPos, z);
  const enforced = t >= game.hideEnd;
  const since = Math.min(...[game.players[uid].outSince, localOutSince].filter(Boolean), Infinity);
  const left = since === Infinity ? game.zone.outMs : game.zone.outMs - (t - since);
  const nz = nextZone(t), nAt = nextShrinkAt(t);
  const nextOut = !!(nz && isOutside(myPos, nz));
  return { z, out, enforced, edge, br, left, nz, nAt, nextOut, nextEdge: nz ? Math.max(0, dist(myPos, nz) - nz.r) : 0, nextBr: nz ? bearing(myPos, nz) : 0 };
}
// controllo locale continuo: avviso immediato quando esci dalla zona
setInterval(() => {
  const mz = myZone();
  if (!mz || !mz.enforced) { localOutSince = null; return; }
  if (mz.out && !localOutSince) { localOutSince = now(); toast(`Sei fuori dalla zona! Rientra entro ${secLabel(Math.round(game.zone.outMs / 1000))}.`); vib([300, 100, 300, 100, 300]); }
  if (!mz.out && localOutSince) { localOutSince = null; toast("Sei di nuovo nella zona."); vib(80); }
}, 1000);
const arrowTo = (br) => `<span class="arrow" style="transform:rotate(${br.toFixed(0)}deg)">↑</span> ${CARD[Math.round(br / 45) % 8]}`;

/* ============ vista: mappa normale o radar ============ */
let view = store.get("mh_view", "map") === "radar" ? "radar" : "map";
function applyView() {
  $("#map").hidden = view !== "map";
  $("#radar").hidden = view !== "radar";
  document.querySelectorAll('[data-act="view"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === view)));
  $("#btn-center").hidden = view !== "map";
  $("#btn-compass").hidden = view !== "radar";
  $("#btn-compass").setAttribute("aria-pressed", String(compassOn));
  $("#btn-compass").textContent = compassOn ? "Bussola attiva" : "Bussola";
  if (view === "map") { if (map) { map.invalidateSize(); scheduleMap(); } }
  else startRadar();
}

/* ---------- bussola (orientamento del telefono) ---------- */
let compassOn = false, heading = null, lastHeadingAt = 0;
function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === "number" && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading; // iPhone
  else if (e.absolute && typeof e.alpha === "number") h = 360 - e.alpha;                                         // Android
  if (h == null) return;
  const so = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
  h = (((h + so) % 360) + 360) % 360;
  if (heading == null) heading = h;
  else { const d = ((h - heading + 540) % 360) - 180; heading = (heading + d * 0.25 + 360) % 360; } // attenua i tremolii
  lastHeadingAt = Date.now();
}
async function toggleCompass() {
  if (compassOn) {
    compassOn = false; heading = null;
    window.removeEventListener("deviceorientationabsolute", onOrientation, true);
    window.removeEventListener("deviceorientation", onOrientation, true);
    applyView(); return;
  }
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== "granted") { toast("Bussola non consentita: il radar resta con il nord in alto."); return; }
    }
  } catch (e) { toast("Bussola non disponibile su questo telefono."); return; }
  compassOn = true; heading = null; lastHeadingAt = 0;
  window.addEventListener("deviceorientationabsolute", onOrientation, true);
  window.addEventListener("deviceorientation", onOrientation, true);
  applyView();
  setTimeout(() => { if (compassOn && !lastHeadingAt) { toast("Bussola non disponibile su questo telefono: il radar resta con il nord in alto."); toggleCompass(); } }, 3000);
}

/* ---------- radar ---------- */
let radarRunning = false, radarLast = 0;
const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const RADAR_STEPS = [40, 80, 100, 200, 400, 600, 800, 1000, 1200, 2000, 3000, 4000, 6000, 8000, 10000, 20000, 40000]; // ogni cerchio = un quarto
function cssVar(n, d) { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || d; }
function startRadar() {
  if (radarRunning) return;
  radarRunning = true;
  const loop = (ts) => {
    if (screen !== "game" || view !== "radar") { radarRunning = false; return; }
    if (ts - radarLast > (reduceMotion ? 1000 : 50) && document.visibilityState === "visible") { radarLast = ts; drawRadar(ts); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function radarBlips() {
  const P = game.players, role = myRole(), t = now(), out = [];
  const ids = role === "seeker" ? Object.keys(P).filter((i) => P[i].role === "hider") : [uid];
  for (const id of ids) {
    const all = byHider[id] || [], fixes = all.filter((p) => !p.nofix), last = fixes[fixes.length - 1];
    if (!last) continue;
    const latest = all[all.length - 1];
    out.push({ id, kind: "hider", lat: last.lat, lng: last.lng, stale: !!(latest && latest.stale), fresh: t - last.t < 12000, ...look(id) });
  }
  if (role === "seeker") for (const [id, m] of Object.entries(mates)) {
    if (!P[id] || P[id].role !== "seeker" || t - m.t > 60000) continue;
    out.push({ id, kind: "mate", lat: m.lat, lng: m.lng, ini: look(id).ini, color: COL.blaze });
  }
  return out;
}
function drawRadar(ts) {
  const cv = $("#radar"); if (!cv || cv.hidden || !game) return;
  const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = cssVar("--surface", "#1b2117"), line = cssVar("--line", "#343e2d"), muted = cssVar("--muted", "#9ba68e"), fg = cssVar("--fg", "#eef1e4"), ink = "#0b1410";
  const font = (w, px) => `${w} ${px}px "Atkinson Hyperlegible", system-ui, sans-serif`;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // spazio libero: sopra la legenda e il Nord, sotto i pulsanti Mappa/Radar e Bussola
  const top = 36, bottom = 64;
  const R = Math.max(40, Math.min((W - 64) / 2, (H - top - bottom) / 2)), cx = W / 2, cy = top + Math.max(R, (H - top - bottom) / 2);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (!myPos) { ctx.fillStyle = muted; ctx.font = font(400, 14); ctx.fillText("Aspetto il GPS per mostrare il radar…", cx, cy); return; }

  const blips = radarBlips().map((b) => ({ ...b, d: dist(myPos, b), br: bearing(myPos, b) }));
  let maxD = blips.reduce((m, b) => Math.max(m, b.d), 0);
  const zc = curZone(now()), zn = nextZone(now());
  if (zc) maxD = Math.max(maxD, dist(myPos, zc) - zc.r + 40, 60); // il bordo più vicino della zona resta visibile
  const scale = RADAR_STEPS.find((v) => v >= maxD * 1.12) || RADAR_STEPS[RADAR_STEPS.length - 1];
  const live = compassOn && heading != null;
  const rot = live ? heading : 0;
  const at = (brg, r) => { const a = ((brg - rot) * Math.PI) / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };

  // cerchi di distanza e assi
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    ctx.strokeStyle = line; ctx.globalAlpha = i === 4 ? 1 : 0.7;
    ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 0.5;
  for (const b of [0, 90]) { const [x1, y1] = at(b, R), [x2, y2] = at(b + 180, R); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = muted; ctx.font = font(400, 11); ctx.textAlign = "left";
  for (let i = 1; i <= 4; i++) { const [x, y] = at(rot + 135, (R * i) / 4); ctx.fillText(fmtDist((scale * i) / 4), x + 4, y); }
  ctx.textAlign = "center";

  // zona: fuori ombreggiato in rosso, prossima zona tratteggiata
  if (zc) {
    const zp = (z) => { const d = dist(myPos, z), [x, y] = at(bearing(myPos, z), (d / scale) * R); return [x, y, (z.r / scale) * R]; };
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    const [zx, zy, zr] = zp(zc);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.arc(zx, zy, zr, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,92,92,0.16)"; ctx.fill("evenodd");
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(zx, zy, zr, 0, Math.PI * 2); ctx.stroke();
    if (zn) { const [nx, ny, nr] = zp(zn); ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.beginPath(); ctx.arc(nx, ny, nr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    ctx.restore();
  }

  // fascio che ruota
  if (!reduceMotion && ctx.createConicGradient) {
    const a = ((ts / 3500) % 1) * Math.PI * 2;
    const g = ctx.createConicGradient(a - Math.PI / 2 - 0.9, cx, cy);
    g.addColorStop(0, "rgba(255,107,26,0)"); g.addColorStop(0.14, "rgba(255,107,26,0.16)"); g.addColorStop(0.145, "rgba(255,107,26,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  }

  // punti cardinali
  ctx.font = font(700, 13);
  [["N", 0], ["E", 90], ["S", 180], ["O", 270]].forEach(([k, b]) => {
    const [x, y] = at(b, R + 15);
    ctx.fillStyle = k === "N" ? COL.blaze : muted; ctx.fillText(k, x, y);
  });

  // io al centro (con il cono della direzione se la bussola è attiva)
  if (live) {
    ctx.fillStyle = "rgba(61,139,255,0.22)"; ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, Math.min(70, R * 0.45), -Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "#3d8bff"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // giocatori: prima i compagni, sopra i nascosti
  blips.sort((a, b) => (a.kind === b.kind ? b.d - a.d : a.kind === "mate" ? -1 : 1));
  for (const b of blips) {
    const r = Math.min(R, (b.d / scale) * R);
    const [x, y] = at(b.br, r);
    const big = b.kind === "hider", rad = big ? 16 : 12;
    if (big && b.fresh && !reduceMotion) {
      const p = (ts % 1600) / 1600;
      ctx.strokeStyle = b.color; ctx.globalAlpha = 1 - p; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, rad + p * 22, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = b.stale ? 0.6 : 1;
    ctx.fillStyle = b.color; ctx.strokeStyle = b.stale ? COL.danger : ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = ink; ctx.font = font(800, big ? 12 : 10);
    ctx.fillText(b.ini, x, y + 0.5);
    ctx.globalAlpha = 1;
    if (big) {
      const txt = (b.id === uid ? "tu · " : "") + fmtDist(b.d);
      ctx.font = font(700, 11);
      const w = ctx.measureText(txt).width + 10, ly = y + rad + 11;
      ctx.fillStyle = "rgba(11,20,16,0.85)"; ctx.fillRect(x - w / 2, ly - 8, w, 16);
      ctx.fillStyle = b.stale ? COL.danger : fg; ctx.fillText(txt, x, ly);
    }
  }

  // legenda
  ctx.textAlign = "left"; ctx.font = font(400, 11); ctx.fillStyle = muted;
  ctx.fillText(live ? "Ruota con il telefono" : "Nord in alto", 10, 16);
  if (!blips.some((b) => b.kind === "hider")) { ctx.textAlign = "center"; ctx.font = font(400, 13); ctx.fillText(game && now() < game.hideEnd ? "I nascosti compaiono al primo ping" : "Nessuna posizione da mostrare", cx, cy + R * 0.55); }
}

render();
