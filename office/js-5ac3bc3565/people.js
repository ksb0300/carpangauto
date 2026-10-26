// 사무실 사람들 — 구성원 목록(담당자 고르기·누가 읽었나), 이니셜 동그라미 프로필, '1시간전' 같은 때 표시.
// 게시판·할 일·일정이 함께 쓴다. 직원은 남의 profiles 를 못 읽으므로 DB 함수 office_members() 로 이름만 받는다.
import { html, useState, useEffect } from "./ui.js";
import { SUPABASE_URL } from "./config.js";

let 캐시 = null;
/** [{ user_id, name, role, avatar_path }] — 한 번 받아 두고 계속 쓴다 (사진도 여기서 기억) */
export async function 구성원(app, 새로 = false) {
  if (!캐시 || 새로) {
    const { data } = await app.db.rpc("office_members"); 캐시 = data || [];
    캐시.forEach(m => 사진기억(m.user_id, m.name, m.avatar_path));
    바뀜();
  }
  return 캐시;
}

/* 프로필 사진: user_id·이름으로 찾아 동그라미에 넣는다 (없으면 이니셜). 공개 버킷 avatars */
export const 사진주소 = p => p ? `${SUPABASE_URL}/storage/v1/object/public/avatars/${p}` : null;
const 사진 = new Map(), 듣는이 = new Set();
const 바뀜 = () => 듣는이.forEach(f => f());
export function 사진기억(id, name, path) {
  const u = 사진주소(path);
  for (const k of [id, name]) if (k) { if (u) 사진.set(k, u); else 사진.delete(k); }
  바뀜();
}
export const 이름표 = (list, id) => (list || []).find(m => m.user_id === id)?.name || "";

const 색들 = ["#5b8def", "#e8833a", "#3fb27f", "#a35dd6", "#e05a6b", "#2bb5c4", "#c29b2e", "#64748b"];
export const 색 = name => { let h = 0; for (const c of String(name || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 색들[h % 색들.length]; };

/** 프로필 동그라미 — 사진이 있으면 사진, 없으면 이니셜(웍스처럼 성 한 글자). id 를 주면 이름보다 먼저 찾는다 */
export function Avatar({ name, size = 32, id }) {
  const [, 다시] = useState(0);
  useEffect(() => { const f = () => 다시(x => x + 1); 듣는이.add(f); return () => 듣는이.delete(f); }, []);
  const u = (id && 사진.get(id)) || 사진.get(name);
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.44)}px;background:${색(name)}`;
  return u ? html`<img class="av" src=${u} alt=${name || ""} title=${name || ""} style=${st + ";object-fit:cover"} />`
    : html`<span class="av" title=${name || ""} style=${st}>${String(name || "?").trim().slice(0, 1)}</span>`;
}

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
