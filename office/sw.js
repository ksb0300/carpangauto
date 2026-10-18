// 업무관리 서비스워커 — 지금은 폰 알림(웹푸시)만 받는다. 화면 파일은 캐시하지 않는다
// (캐시하면 배포한 새 화면 대신 옛 화면이 뜰 수 있어서 — 로딩 개선용 캐시는 따로 신중히).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data ? e.data.text() : "업무관리" }; }
  e.waitUntil(self.registration.showNotification(d.title || "업무관리", {
    body: d.body || "",
    icon: "/office/icon-192.png",
    badge: "/office/badge-96.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || "/office/" },
  }));
});

// 알림을 누르면 업무관리를 열어 그 화면으로 (이미 열려 있으면 그 창으로)
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/office/", self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin + "/office/")) { await c.focus(); return c.navigate(url).catch(() => {}); }
    }
    return self.clients.openWindow(url);
  })());
});
