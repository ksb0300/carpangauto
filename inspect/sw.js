// 검수지 앱을 인터넷 없이도 열리게 — 앱 파일을 기기에 담아 두고, 연결되면 새 버전으로 바꿔 둔다.
// 2026-10-20: 껐다 켜도 예전 화면이 남던 것 — ① 새 버전을 담을 때 브라우저 HTTP 캐시(10분)를 건너뛰고 서버에서 새로 받고
//             ② 화면(index.html)은 인터넷이 되면 늘 서버 것을 먼저, 안 되면(3초) 담아 둔 것.
const CACHE = "tierone-sheet-v20";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png", "./diag.jpg"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(u => new Request(u, { cache: "reload" })))));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  const page = e.request.mode === "navigate";
  e.respondWith(caches.open(CACHE).then(async c => {
    if (page) {
      try {
        const r = await Promise.race([fetch(e.request, { cache: "no-cache" }), new Promise((_, no) => setTimeout(no, 3000))]);
        if (r.ok) c.put("./index.html", r.clone());
        return r;
      } catch { return (await c.match(e.request, { ignoreSearch: true })) || (await c.match("./index.html")); }
    }
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request, { cache: "no-cache" }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
