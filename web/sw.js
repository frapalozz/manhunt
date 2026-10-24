/* Service worker: mostra le notifiche dei ping anche con il sito chiuso o il telefono in standby. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: "Manhunt", body: event.data ? event.data.text() : "" }; }
  event.waitUntil((async () => {
    // avvisa anche le pagine aperte (per inviare subito la posizione se è un ping)
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: "push", data: d }));
    await self.registration.showNotification(d.title || "Manhunt", {
      body: d.body || "",
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: d.tag || "manhunt",
      renotify: true,
      requireInteraction: d.r === "ping",
      vibrate: d.r === "ping" ? [200, 100, 200, 100, 200] : [120],
      data: { url: d.url || "./", r: d.r || "" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = new URL(data.url || "./", self.registration.scope);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === url.origin) {
        await w.focus();
        w.postMessage({ type: "open", r: data.r, g: url.searchParams.get("g") });
        return;
      }
    }
    await self.clients.openWindow(url.href);
  })());
});
