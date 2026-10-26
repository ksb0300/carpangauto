// 폰 알림(웹푸시) — 이 기기 알림 켜기·끄기, 알림 보내기 (Edge Function 'push').
// 갤럭시(크롬): 🔔 누르고 허용하면 끝. 아이폰: 공유 → '홈 화면에 추가'로 설치한 앱에서만 알림이 온다 (애플 정책).
import { VAPID_PUBLIC_KEY } from "./config.js";

export const 지원 = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const 아이폰 = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
export const 설치됨 = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

const 키 = s => { const r = atob((s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, c => c.charCodeAt(0)); };
const 등록 = () => navigator.serviceWorker.getRegistration("./");

/** "켜짐" | "꺼짐" | "차단" | "설치필요"(아이폰 사파리) | "안됨"(이 브라우저는 알림 못 받음) */
export async function 상태() {
  if (아이폰() && !설치됨()) return "설치필요";
  if (!지원()) return "안됨";
  if (Notification.permission === "denied") return "차단";
  const r = await 등록();
  const s = r && await r.pushManager.getSubscription();
  return s && Notification.permission === "granted" ? "켜짐" : "꺼짐";
}

export async function 켜기(app) {
  if (await Notification.requestPermission() !== "granted") throw new Error("알림이 허용되지 않았습니다. 주소창 왼쪽 자물쇠 → 알림 → 허용으로 바꿔 주세요.");
  const r = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  await navigator.serviceWorker.ready;
  const s = await r.pushManager.getSubscription() || await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: 키(VAPID_PUBLIC_KEY) });
  const j = s.toJSON();
  const { error } = await app.db.from("push_subs").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200) }, { onConflict: "endpoint" });
  if (error) throw new Error(error.message);
  await 보내기(app, { title: "🔔 알림이 켜졌습니다", body: "이제 이 폰으로 업무관리 알림이 옵니다.", only_self: true });
}

export async function 끄기(app) {
  const r = await 등록();
  const s = r && await r.pushManager.getSubscription();
  if (s) { await app.db.from("push_subs").delete().eq("endpoint", s.endpoint); await s.unsubscribe(); }
}

/** 알림 보내기 — 실패해도 본 작업(글 올리기 등)은 막지 않는다 (콘솔에만 남김) */
export async function 보내기(app, msg) {
  try {
    const { data, error } = await app.db.functions.invoke("push", { body: msg });
    if (error) console.warn("알림 보내기 실패", error); return data;
  } catch (e) { console.warn("알림 보내기 실패", e); }
}
