// 팝빌 작업 호출 — 운영은 Supabase Edge Function 'popbill', 데모는 같은 처리 코드를 브라우저에서 모의로 돌린다.
import { DEMO } from "./config.js";

export const popbill = (db, action, args = {}) => callFn(db, "popbill", action, args);
export const accounts = (db, action, args = {}) => callFn(db, "accounts", action, args);

/** 서버 함수 호출 — 실패 이유를 그대로 던진다 */
export async function callFn(db, name, action, args = {}) {
  const { data, error } = await db.functions.invoke(name, { body: { action, ...args } });
  if (error) {
    let msg = error.message;
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch {}
    throw new Error(msg.includes("Failed to send") ? `서버 함수(${name})에 연결하지 못했습니다. 배포 여부를 확인하세요.` : msg);
  }
  if (data?.error) throw new Error(data.error);
  return data?.data;
}

export const PB_NOTE = DEMO
  ? "데모 모드: 발행은 모의로 처리되며 국세청·은행으로 아무것도 나가지 않습니다."
  : "";
