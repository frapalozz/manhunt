// Test della logica di gioco: node test/game.test.js
const assert = require("assert");
const G = require("./game");

let t = 1_000_000;
const g = G.newGame("ABCDE", "host", "Anna", t);
G.join(g, "b", "Bruno", t); G.join(g, "c", "Carla", t);
assert.equal(Object.keys(g.players).length, 3);
assert.throws(() => G.setRole(g, "b", "host", "seeker"), /Solo l'host/);
G.setRole(g, "host", "host", "seeker");
assert.throws(() => G.setSettings(g, "host", { pingSec: 7 }), /non valido/);
G.setSettings(g, "host", { pingSec: 60, hideSec: 60, durationMin: 10 });

const gid = G.start(g, "host", t);
assert.equal(g.status, "running"); assert.equal(g.hideEnd, t + 60000); assert.equal(g.endAt, t + 60000 + 600000);
assert.throws(() => G.reportCatch(g, "host", "b", null, t + 1000), /non è ancora finito/);

// ping
assert.equal(G.duePingIndex(g, t + 59999), -1);
assert.equal(G.duePingIndex(g, t + 60000), 0);
assert.equal(G.duePingIndex(g, t + 60000 + 125000), 2);
assert.equal(G.pingTime(g, 3), t + 60000 + 180000);

// ingresso a partita in corso: diventa cercatore
G.join(g, "d", "Dario", t + 70000);
assert.equal(g.players.d.role, "seeker");

// un nascosto non può segnalare un altro nascosto
assert.throws(() => G.reportCatch(g, "c", "b", null, t + 80000), /Solo un cercatore/);
G.reportCatch(g, "host", "b", null, t + 90000);
assert.equal(g.players.b.role, "seeker"); assert.equal(g.players.b.caughtBy, "host");
assert.equal(g.status, "running");
// auto-segnalazione con catturatore indicato
G.reportCatch(g, "c", "c", "b", t + 95000);
assert.equal(g.players.c.caughtBy, "b");
assert.equal(g.status, "ended"); assert.equal(g.winner, "seekers");

// rivincita: ruoli originali
G.rematch(g, "host");
assert.equal(g.status, "lobby"); assert.equal(g.players.b.role, "hider"); assert.equal(g.players.host.role, "seeker");
assert.ok(!g.players.d.origRole);

// scadenza tempo → vincono i nascosti
t += 1e7; G.start(g, "host", t);
assert.equal(G.checkEnd(g, g.endAt - 1), false);
assert.equal(G.checkEnd(g, g.endAt), true); assert.equal(g.winner, "hiders");
assert.equal(G.duePingIndex(g, g.endAt + 5000), -1); // finita: niente ping

// shuffle: sempre almeno un nascosto
G.rematch(g, "host");
G.shuffle(g, "host", 99);
const roles = Object.values(g.players).map((p) => p.role);
assert.equal(roles.filter((r) => r === "hider").length, 1);

// avvisi prima del ping e squalifica per ping saltati
{
  const h = G.newGame("WARNX", "s", "Sara", 0);
  G.join(h, "a", "Aldo", 0); G.join(h, "b", "Bea", 0);
  G.setRole(h, "s", "s", "seeker");
  G.setSettings(h, "s", { pingSec: 120, hideSec: 60, durationMin: 10, maxMissed: 2 });
  G.start(h, "s", 0);                       // hideEnd = 60000, endAt = 660000
  assert.equal(G.warnLeadMs(h), 45000);
  assert.equal(G.dueWarnIndex(h, 14999), -1);
  assert.equal(G.dueWarnIndex(h, 15000), 0);  // avviso del primo ping 45 s prima di hideEnd
  assert.equal(G.dueWarnIndex(h, 135000), 1);
  assert.equal(G.lastPingIndex(h), 4);         // ping a 60,180,300,420,540 s
  assert.equal(G.dueWarnIndex(h, 659000), 4);  // mai oltre l'ultimo ping
  assert.equal(G.nextWakeTime(h), 15000);
  h.lastWarnK = 0; assert.equal(G.nextWakeTime(h), 60000);
  h.lastPingK = 0; assert.equal(G.nextWakeTime(h), 135000);
  assert.deepEqual(G.applyMisses(h, 0, ["a"], 61000), []);
  assert.deepEqual(G.applyMisses(h, 0, ["a"], 61000), []);      // stesso ping: non conta due volte
  assert.equal(h.players.a.missed, 1);
  assert.deepEqual(G.applyMisses(h, 1, ["a", "b"], 181000), ["a"]);
  assert.equal(h.players.a.role, "seeker"); assert.ok(h.players.a.dq);
  assert.equal(h.players.b.missed, 1); assert.equal(h.status, "running");
  assert.deepEqual(G.applyMisses(h, 2, ["b"], 301000), ["b"]);
  assert.equal(h.status, "ended"); assert.equal(h.winner, "seekers");
  // pochi secondi tra i ping: avviso a metà intervallo
  const f = G.newGame("FASTX", "s", "Sara", 0); f.settings.pingSec = 30; assert.equal(G.warnLeadMs(f), 15000);
  // 0 = nessuna squalifica
  const z = G.newGame("ZEROX", "s", "S", 0); G.join(z, "a", "A", 0); G.setRole(z, "s", "s", "seeker");
  G.setSettings(z, "s", { maxMissed: 0 }); G.start(z, "s", 0);
  for (let k = 0; k < 5; k++) G.applyMisses(z, k, ["a"], 70000 + k);
  assert.equal(z.players.a.role, "hider"); assert.equal(z.players.a.missed, 5);
}

// host esce dalla lobby: passa al giocatore successivo
G.leave(g, "host"); assert.ok(g.hostId && g.hostId !== "host");

console.log("Tutti i test della logica di gioco sono passati.");
