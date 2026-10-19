// 사무실 사람들 — 구성원 목록(담당자 고르기·누가 읽었나), 이니셜 동그라미 프로필, '1시간전' 같은 때 표시.
// 게시판·할 일·일정이 함께 쓴다. 직원은 남의 profiles 를 못 읽으므로 DB 함수 office_members() 로 이름만 받는다.
import { html } from "./ui.js";

let 캐시 = null;
/** [{ user_id, name, role }] — 한 번 받아 두고 계속 쓴다 */
export async function 구성원(app) {
  if (!캐시) { const { data } = await app.db.rpc("office_members"); 캐시 = data || []; }
  return 캐시;
}
export const 이름표 = (list, id) => (list || []).find(m => m.user_id === id)?.name || "";

const 색들 = ["#5b8def", "#e8833a", "#3fb27f", "#a35dd6", "#e05a6b", "#2bb5c4", "#c29b2e", "#64748b"];
export const 색 = name => { let h = 0; for (const c of String(name || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 색들[h % 색들.length]; };

/** 이니셜 동그라미 (웍스처럼 성 한 글자) */
export const Avatar = ({ name, size = 32 }) =>
  html`<span class="av" title=${name || ""} style=${`width:${size}px;height:${size}px;font-size:${Math.round(size * 0.44)}px;background:${색(name)}`}>${String(name || "?").trim().slice(0, 1)}</span>`;

const 한국 = t => new Date(new Date(t).getTime() + 9 * 3600e3);
/** '방금' '12분전' '3시간전' '10. 16.' '2025. 10. 16.' */
export function 언제(t) {
  if (!t) return "";
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return Math.floor(s / 60) + "분전";
  if (s < 86400) return Math.floor(s / 3600) + "시간전";
  const k = 한국(t), n = 한국(Date.now());
  const md = `${k.getUTCMonth() + 1}. ${k.getUTCDate()}.`;
  return k.getUTCFullYear() === n.getUTCFullYear() ? md : `${k.getUTCFullYear()}. ${md}`;
}
/** '2026. 10. 16. 14:56' */
export const 날짜시각 = t => { if (!t) return ""; const k = 한국(t).toISOString(); return `${k.slice(0, 4)}. ${+k.slice(5, 7)}. ${+k.slice(8, 10)}. ${k.slice(11, 16)}`; };
