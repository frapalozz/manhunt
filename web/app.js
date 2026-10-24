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
const COL = { hide: "#9ad8c6", danger: "#ff5c5c" };

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
  if (params.get("r") === "ping") pendingRespond = true;
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
    if (m.type === "open" && m.r === "ping") respondPing();
    if (m.type === "push" && m.data && m.data.r === "ping") respondPing();
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
    if ((e.type === "found" || e.type === "dq") && e.who === uid) {
      toast(e.type === "dq" ? "Squalificato: troppi ping saltati. Ora sei un cercatore." : "Sei stato trovato! Ora sei un cercatore.");
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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
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
    case "seek-": seekCount = Math.max(1, (seekCount || 1) - 1); render(); break;
    case "seek+": seekCount = Math.min(Math.max(1, Object.keys(game.players).length - 1), (seekCount || 1) + 1); render(); break;
    case "shuffle": act("shuffle", { seekers: seekCount }); break;
    case "start": b.disabled = true; await act("start"); break;
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
  for (const s of ["boot", "home", "lobby", "game", "end"]) $("#s-" + s).hidden = s !== name;
  if (name === "game") { initMap(); setTimeout(() => { map && map.invalidateSize(); fitted = false; scheduleMap(); }, 60); }
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
  else if (game.status === "running" && now() < game.endAt + 4000) { show("game"); renderHud(); renderOverlay(); renderSheet(); scheduleMap(); }
  else if (game.status === "running") { show("lobby"); $("#lobby").innerHTML = `<div class="boot"><div class="spin"></div><span>Tempo scaduto, calcolo il risultato…</span></div>`; }
  else { show("end"); renderEnd(); }
}
let renderQueued = false;
function renderSoon() { if (renderQueued) return; renderQueued = true; setTimeout(() => { renderQueued = false; if (screen === "game") renderSheet(); }, 250); }

function renderLobby() {
  const P = game.players, ids = Object.keys(P).sort((a, b) => P[a].joinedAt - P[b].joinedAt);
  const s = game.settings, n = ids.length, isHost = game.hostId === uid;
  const nSeek = ids.filter((i) => P[i].role === "seeker").length, nHide = n - nSeek;
  if (seekCount === null) seekCount = Math.max(1, Math.round(n / 4));
  seekCount = Math.min(seekCount, Math.max(1, n - 1));
  const sel = (key, opts, val, lab) => isHost
    ? `<select id="set-${key}" data-set="${key}">${opts.map((o) => `<option value="${o}" ${o === val ? "selected" : ""}>${lab(o)}</option>`).join("")}</select>`
    : `<div class="val">${lab(val)}</div>`;
  const canStart = nSeek > 0 && nHide > 0;
  const missLab = (v) => (v ? `dopo ${v} saltat${v === 1 ? "o" : "i"}` : "mai");
  $("#lobby").innerHTML = `
    <header class="lobby-top">
      <div class="eyebrow">Codice partita</div>
      <div class="bigcode">${esc(code)}</div>
      <button class="btn small" data-act="copy">Invita amici</button>
    </header>
    ${gpsNotice()}
    ${pushNotice()}
    <div class="sec-h"><h2>Giocatori</h2><span class="muted small num">${nSeek} cercator${nSeek === 1 ? "e" : "i"} · ${nHide} nascost${nHide === 1 ? "o" : "i"}</span></div>
    <ul class="players">
      ${ids.map((id) => {
        const p = P[id], tag = [id === uid ? "tu" : "", id === game.hostId ? "host" : ""].filter(Boolean).join(" · ");
        const chip = isHost
          ? `<button class="chip ${p.role}" data-act="role" data-id="${esc(id)}" aria-label="Cambia squadra di ${esc(p.name)}">${p.role === "seeker" ? "Cercatore" : "Nascosto"}</button>`
          : `<span class="chip ${p.role}">${p.role === "seeker" ? "Cercatore" : "Nascosto"}</span>`;
        return `<li><span class="nm">${esc(p.name)}${tag ? `<small>${tag}</small>` : ""}</span>${chip}${isHost && id !== uid ? `<button class="x" data-act="kick" data-id="${esc(id)}" aria-label="Rimuovi ${esc(p.name)}">×</button>` : ""}</li>`;
      }).join("")}
    </ul>
    ${isHost && n > 1 ? `<div class="card"><label>Squadre casuali</label><div class="row" style="align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div class="stepper"><button class="btn" data-act="seek-" aria-label="Meno cercatori">−</button><output class="num">${seekCount}</output><button class="btn" data-act="seek+" aria-label="Più cercatori">+</button><span class="muted small">cercator${seekCount === 1 ? "e" : "i"}</span></div>
      <button class="btn small" data-act="shuffle">Mescola</button></div>
      <span class="muted small">Oppure tocca la squadra di un giocatore per cambiarla.</span></div>` : ""}
    <div class="sec-h"><h2>Regole</h2>${isHost ? "" : `<span class="muted small">decide l'host</span>`}</div>
    <div class="settings">
      <div class="fld"><label for="set-pingSec">Ping ogni</label>${sel("pingSec", PING_OPTS, s.pingSec, secLabel)}</div>
      <div class="fld"><label for="set-hideSec">Per nascondersi</label>${sel("hideSec", HIDE_OPTS, s.hideSec, secLabel)}</div>
      <div class="fld"><label for="set-durationMin">Durata</label>${sel("durationMin", DUR_OPTS, s.durationMin, (v) => v + " min")}</div>
      <div class="fld"><label for="set-maxMissed">Squalifica</label>${sel("maxMissed", MISS_OPTS, s.maxMissed ?? 2, missLab)}</div>
    </div>
    ${isHost
      ? `<button class="btn primary block" data-act="start" ${canStart ? "" : "disabled"}>Inizia la caccia</button>${canStart ? "" : `<p class="muted small" style="margin:0;text-align:center">Serve almeno un cercatore e un nascosto.</p>`}`
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
    ${bar}`;
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
      return `<li><span class="dot"></span><span class="t"><b>${esc(P[id].name)}${missed}</b><span>${info}</span></span>
        <button class="btn small ${on ? "armed" : ""}" data-act="found" data-id="${esc(id)}" ${t < game.hideEnd ? "disabled" : ""}>${on ? "Conferma" : "Preso!"}</button></li>`;
    }).join("")}</ul>` : `<p class="muted">Nessuno in fuga.</p>`;
    html += `<h3>Squadra cercatori</h3><div class="team">${seekers.map((id) => `<span class="${id === uid ? "me" : ""}">${esc(P[id].name)}${id === uid ? " (tu)" : ""}</span>`).join("")}</div>`;
  } else {
    const nx = nextPingAt(t), rem = nx - t;
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
    <ul class="results">${rows.map((r, i) => `<li><span class="pos num">${i + 1}</span><span class="t"><b>${esc(r.p.name)}${r.id === uid ? " (tu)" : ""}</b><span>${!r.p.caughtAt ? "mai trovato" : r.p.dq ? "squalificato (ping saltati)" : r.p.caughtBy ? "preso da " + esc((P[r.p.caughtBy] || {}).name || "?") : "preso"}</span></span><span class="tm">${fmt(Math.max(0, r.surv))}</span></li>`).join("")}</ul>
    ${game.hostId === uid ? `<button class="btn primary block" data-act="rematch">Rivincita</button>` : `<p class="waiting">L'host può avviare una rivincita.</p>`}
    <button class="btn ghost" data-act="leave">Torna alla home</button>`;
}

/* ============ mappa ============ */
let map = null, layer = null, fitted = false, mapQueued = false;
function initMap() {
  if (map || typeof L === "undefined") return;
  map = L.map("map", { zoomControl: false }).setView([41.9, 12.5], 15);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { maxZoom: 20, subdomains: "abcd", attribution: "© OpenStreetMap © CARTO" }).addTo(map);
  layer = L.layerGroup().addTo(map);
  setInterval(scheduleMap, 5000);
}
function scheduleMap() { if (mapQueued) return; mapQueued = true; requestAnimationFrame(() => { mapQueued = false; drawMap(); }); }
const icon = (html) => L.divIcon({ className: "mk-wrap", html, iconSize: [0, 0] });
function drawMap() {
  if (!map || screen !== "game" || !game) return;
  layer.clearLayers();
  const pts = [], P = game.players, role = myRole(), t = now();
  const ids = role === "seeker" ? Object.keys(P).filter((i) => P[i].role === "hider") : [uid];
  for (const id of ids) {
    const all = byHider[id] || [], arr = all.filter((p) => !p.nofix);
    if (!arr.length) continue;
    const latest = all[all.length - 1], stale = latest && latest.stale;
    const ll = arr.map((e) => [e.lat, e.lng]);
    if (ll.length > 1) L.polyline(ll, { color: COL.hide, weight: 3, opacity: 0.7, dashArray: "6 8" }).addTo(layer);
    arr.slice(0, -1).forEach((e) => L.marker([e.lat, e.lng], { icon: icon(`<div class="mk ping old"><div class="pin"></div></div>`), interactive: false }).addTo(layer));
    const last = arr[arr.length - 1];
    if (last.acc && last.acc > 15) L.circle([last.lat, last.lng], { radius: last.acc, color: stale ? COL.danger : COL.hide, weight: 1, fillOpacity: 0.08, interactive: false }).addTo(layer);
    const fresh = t - last.t < 12000;
    const nm = id === uid ? "Tu (come ti vedono)" : P[id].name;
    const lbl = stale ? `posizione ${ago(last.fix_at || last.t)}` : ago(last.t);
    L.marker([last.lat, last.lng], { icon: icon(`<div class="mk ping ${fresh ? "fresh" : ""}"><div class="pin"></div><div class="lb">${esc(nm)}<i>${esc(lbl)}</i></div></div>`), interactive: false, zIndexOffset: 500 }).addTo(layer);
    pts.push([last.lat, last.lng]);
  }
  if (role === "seeker") {
    for (const [id, m] of Object.entries(mates)) {
      if (!P[id] || P[id].role !== "seeker" || t - m.t > 60000) continue;
      L.marker([m.lat, m.lng], { icon: icon(`<div class="mk mate">${esc((P[id].name || "?").slice(0, 1).toUpperCase())}</div>`), interactive: false }).addTo(layer);
      pts.push([m.lat, m.lng]);
    }
  }
  if (myPos) {
    L.marker([myPos.lat, myPos.lng], { icon: icon(`<div class="mk me"></div>`), interactive: false, zIndexOffset: 1000 }).addTo(layer);
    pts.push([myPos.lat, myPos.lng]);
  }
  if (!fitted && pts.length) {
    fitted = true;
    if (pts.length === 1) map.setView(pts[0], 17); else map.fitBounds(pts, { padding: [50, 50], maxZoom: 18 });
  }
}

render();
