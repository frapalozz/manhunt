// Test della logica di gioco: node dev/game.test.js
const assert = require("assert");
const G = require("./game");

// numeri casuali ripetibili
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const roleOf = (g, r) => Object.keys(g.players).filter((id) => g.players[id].role === r);
const C = { lat: 45.0, lng: 9.0 };

/* ---------- lobby, impostazioni, ruoli casuali ---------- */
let t = 1_000_000;
const g = G.newGame("ABCDE", "host", "Anna", t);
G.join(g, "b", "Bruno", t); G.join(g, "c", "Carla", t);
assert.equal(Object.keys(g.players).length, 3);
assert.throws(() => G.setSettings(g, "b", { pingSec: 60 }), /Solo l'host/);
assert.throws(() => G.setSettings(g, "host", { pingSec: 7 }), /non valido/);
assert.throws(() => G.setSettings(g, "host", { seekers: 0 }), /non valido/);
assert.throws(() => G.setSettings(g, "host", { zoneStart: 1234 }), /non valido/);
G.setSettings(g, "host", { pingSec: 60, hideSec: 60, durationMin: 10, seekers: 1, zoneStart: 0 });

G.start(g, "host", t, { rng: seeded(1) });
assert.equal(g.status, "running");
assert.equal(roleOf(g, "seeker").length, 1); assert.equal(roleOf(g, "hider").length, 2);
assert.equal(g.revealAt, t + G.COUNTDOWN_MS);
assert.equal(g.hideEnd, t + G.COUNTDOWN_MS + 60000);          // il tempo per nascondersi parte dalla rivelazione
assert.equal(g.endAt, g.hideEnd + 600000);
assert.equal(g.zone, null);                                    // zona disattivata
for (const p of Object.values(g.players)) assert.equal(p.origRole, p.role);

// ruoli davvero casuali: in 200 avvii ognuno fa il cercatore almeno una volta
{
  const count = { host: 0, b: 0, c: 0 };
  const rng = seeded(7);
  for (let i = 0; i < 200; i++) {
    const h = G.newGame("RNDXX", "host", "Anna", 0); G.join(h, "b", "Bruno", 0); G.join(h, "c", "Carla", 0);
    G.start(h, "host", 0, { rng });
    count[roleOf(h, "seeker")[0]]++;
  }
  assert.ok(Object.values(count).every((n) => n > 30), JSON.stringify(count));
}
// più cercatori di quanti possibile: resta sempre almeno un nascosto
{
  const h = G.newGame("MANYX", "host", "A", 0); G.join(h, "b", "B", 0); G.join(h, "c", "C", 0);
  G.setSettings(h, "host", { seekers: 25 }); G.start(h, "host", 0, { rng: seeded(3) });
  assert.equal(roleOf(h, "hider").length, 1);
  const solo = G.newGame("SOLOX", "host", "A", 0);
  assert.throws(() => G.start(solo, "host", 0), /almeno 2/);
}

/* ---------- catture, ping, fine partita (sulla partita g) ---------- */
const seeker = roleOf(g, "seeker")[0];
const [h1, h2] = roleOf(g, "hider");
assert.throws(() => G.reportCatch(g, seeker, h1, null, g.hideEnd - 1), /non è ancora finito/);
assert.equal(G.duePingIndex(g, g.hideEnd - 1), -1);
assert.equal(G.duePingIndex(g, g.hideEnd), 0);
assert.equal(G.duePingIndex(g, g.hideEnd + 125000), 2);
G.join(g, "d", "Dario", g.hideEnd + 1000);
assert.equal(g.players.d.role, "seeker");                      // chi entra a partita iniziata cerca
assert.throws(() => G.reportCatch(g, h2, h1, null, g.hideEnd + 2000), /Solo un cercatore/);
G.reportCatch(g, seeker, h1, null, g.hideEnd + 3000);
assert.equal(g.players[h1].role, "seeker"); assert.equal(g.players[h1].caughtBy, seeker);
G.reportCatch(g, h2, h2, h1, g.hideEnd + 4000);
assert.equal(g.status, "ended"); assert.equal(g.winner, "seekers");
G.rematch(g, "host");
assert.equal(g.status, "lobby"); assert.equal(g.zone, null); assert.equal(g.revealAt, null);
assert.ok(!g.players[h1].origRole && !g.players[h1].dq);

/* ---------- avvisi prima del ping e squalifica per ping saltati ---------- */
{
  const h = G.newGame("WARNX", "s", "Sara", 0);
  G.join(h, "a", "Aldo", 0); G.join(h, "b", "Bea", 0);
  G.setSettings(h, "s", { pingSec: 120, hideSec: 60, durationMin: 10, maxMissed: 2, zoneStart: 0 });
  G.start(h, "s", 0, { rng: seeded(11) });
  const [a, b] = roleOf(h, "hider");
  const H = h.hideEnd;
  assert.equal(G.warnLeadMs(h), 45000);
  assert.equal(G.dueWarnIndex(h, H - 45001), -1);
  assert.equal(G.dueWarnIndex(h, H - 45000), 0);
  assert.equal(G.lastPingIndex(h), 4);
  assert.deepEqual(G.applyMisses(h, 0, [a], H + 1000), []);
  assert.deepEqual(G.applyMisses(h, 0, [a], H + 1000), []);   // stesso ping: non conta due volte
  assert.deepEqual(G.applyMisses(h, 1, [a, b], H + 121000), [a]);
  assert.equal(h.players[a].dqReason, "ping");
  assert.deepEqual(G.applyMisses(h, 2, [b], H + 241000), [b]);
  assert.equal(h.status, "ended"); assert.equal(h.winner, "seekers");
}

/* ---------- zona ---------- */
{
  // cerchi: dal raggio iniziale a 100 m, ognuno dentro il precedente
  const zs = G.makeZones(C, 1500, 5, seeded(5));
  assert.equal(zs.length, 6); assert.equal(zs[0].r, 1500); assert.equal(zs[5].r, 100);
  for (let k = 1; k < zs.length; k++) {
    assert.ok(zs[k].r < zs[k - 1].r);
    assert.ok(G.distM(zs[k], zs[k - 1]) + zs[k].r <= zs[k - 1].r + 1, `zona ${k} esce dalla precedente`);
  }

  const h = G.newGame("ZONEX", "s", "Sara", 0);
  G.join(h, "a", "Aldo", 0); G.join(h, "b", "Bea", 0);
  G.setSettings(h, "s", { hideSec: 60, durationMin: 30, zoneStart: 1000, zoneEvery: 300, zoneOut: 60, maxMissed: 0 });
  G.start(h, "s", 0, { rng: seeded(9), center: C });
  const [a, b] = roleOf(h, "hider");
  const H = h.hideEnd, Z = h.zone.zones;
  assert.equal(Z.length, 6);                                   // 30 min / 5 min → 5 restringimenti
  assert.equal(G.zoneIndex(h, H - 1), 0);
  assert.equal(G.zoneIndex(h, H + 299999), 0);
  assert.equal(G.zoneIndex(h, H + 300000), 1);
  assert.equal(G.zoneIndex(h, h.endAt - 1), 5);

  const inside = { lat: Z[0].lat, lng: Z[0].lng, acc: 5 };
  const far = { lat: C.lat + 0.05, lng: C.lng, acc: 5 };           // ~5,5 km: fuori
  // durante il tempo per nascondersi nessun controllo
  assert.equal(G.applyZone(h, { [a]: far }, H - 1000).nowOut.length, 0);
  // fuori: parte il conteggio, poi squalifica dopo 60 s
  let r = G.applyZone(h, { [a]: far, [b]: inside }, H + 1000);
  assert.deepEqual(r.nowOut, [a]); assert.equal(h.players[a].outSince, H + 1000);
  r = G.applyZone(h, { [a]: far, [b]: inside }, H + 30000);
  assert.deepEqual(r.dq, []); assert.equal(r.nowOut.length, 0);
  // rientra: conteggio azzerato
  r = G.applyZone(h, { [a]: inside, [b]: inside }, H + 40000);
  assert.ok(r.changed); assert.equal(h.players[a].outSince, undefined);
  // riesce, resta fuori 60 s → squalificato e passa ai cercatori
  G.applyZone(h, { [a]: far, [b]: inside }, H + 50000);
  r = G.applyZone(h, { [a]: far, [b]: inside }, H + 110000);
  assert.deepEqual(r.dq, [a]); assert.equal(h.players[a].role, "seeker"); assert.equal(h.players[a].dqReason, "zone");
  assert.equal(h.status, "running");
  // posizione sconosciuta: nessuna penalità
  assert.equal(G.applyZone(h, {}, H + 120000).nowOut.length, 0);
  // avviso prima del restringimento (60 s prima) per chi resterebbe fuori, poi restringimento
  const nextZ = Z[1];
  const outNext = { lat: Z[0].lat, lng: Z[0].lng, acc: 5 };
  const willBeOut = G.distM(outNext, nextZ) > nextZ.r;
  r = G.applyZone(h, { [b]: outNext }, H + 240000);
  assert.ok(r.warn && r.warn.k === 1);
  assert.deepEqual(r.warn.ids, willBeOut ? [b] : []);
  assert.equal(G.applyZone(h, { [b]: outNext }, H + 241000).warn, null); // una volta sola
  r = G.applyZone(h, { [b]: { lat: nextZ.lat, lng: nextZ.lng, acc: 5 } }, H + 300000);
  assert.equal(r.shrunk, 1); assert.equal(h.zoneK, 1);
  // il margine per l'imprecisione del GPS vale al massimo 50 m
  const edge = { lat: nextZ.lat + (nextZ.r + 40) / 111320, lng: nextZ.lng };
  assert.equal(G.outsideZone({ ...edge, acc: 60 }, nextZ), false);
  assert.equal(G.outsideZone({ ...edge, acc: 10 }, nextZ), true);
  // ultimo nascosto fuori troppo a lungo → vincono i cercatori
  G.applyZone(h, { [b]: far }, H + 310000);
  G.applyZone(h, { [b]: far }, H + 371000);
  assert.equal(h.status, "ended"); assert.equal(h.winner, "seekers");

  // zona richiesta ma nessuna posizione GPS all'avvio: partita senza zona, con avviso
  const n = G.newGame("NOPOS", "s", "S", 0); G.join(n, "a", "A", 0);
  G.start(n, "s", 0, { rng: seeded(2) });
  assert.equal(n.zone, null); assert.equal(n.events[0].type, "nozone");
}

/* ---------- host esce dalla lobby ---------- */
{
  const h = G.newGame("LEAVE", "host", "Anna", 0); G.join(h, "b", "Bruno", 1);
  G.leave(h, "host"); assert.equal(h.hostId, "b");
}

console.log("Tutti i test della logica di gioco sono passati.");
