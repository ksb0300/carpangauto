// 차량 검수 — 와이파이 전용 태블릿을 위해 먼저 기기(IndexedDB)에 저장하고, 인터넷이 되면 서버로 올린다.
//   drafts: 검수 한 건 통째로 { id, row, dirty, at }   photos: 아직 못 올린 사진 { path, blob, checkId }
// 화면을 연 채로 고객 차 앞에 가면 인터넷이 끊겨도 입력·사진이 남는다. 연결되면(online 이벤트·15초마다) 알아서 올린다.
// 검수 화면은 사무실 와이파이에서 미리 열어 둬야 한다 (끊긴 상태에서 새로 열 수는 없다).
import { q } from "./db.js";

const DB_NAME = "tierone-checks", VER = 1;
let dbp;
function idb() {
  if (!dbp) dbp = new Promise((ok, bad) => {
    const r = indexedDB.open(DB_NAME, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("drafts")) d.createObjectStore("drafts", { keyPath: "id" });
      if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos", { keyPath: "path" });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await idb();
  return new Promise((ok, bad) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    let out; const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => ok(out);
    t.onerror = () => bad(t.error);
    t.onabort = () => bad(t.error || new Error("기기 저장 실패"));
  });
}

// ── 상태 알림 (화면 위 '기기에만 저장됨 n건' 표시용) ──
const subs = new Set();
let state = { pending: 0, photos: 0, syncing: false, error: "", online: navigator.onLine };
export const syncState = () => state;
export function onSync(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); }
const emit = p => { state = { ...state, ...p }; subs.forEach(f => f(state)); };

/** 검수 한 건을 기기에 저장 (dirty = 서버에 아직 안 올림) */
export async function saveLocal(row) {
  await tx("drafts", "readwrite", s => s.put({ id: row.id, row, dirty: true, at: Date.now() }));
  await count();
}
/** 서버에서 받은 검수를 기기에도 둔다 (열어 둔 채 인터넷이 끊겨도 이어서 쓰게). 아직 못 올린 수정이 있으면 건드리지 않는다 */
export async function keepLocal(row) {
  const cur = await getLocal(row.id);
  if (cur?.dirty) return;
  await tx("drafts", "readwrite", s => s.put({ id: row.id, row, dirty: false, at: Date.now() }));
}
/** 이 검수에 아직 서버로 못 올린 게 있는지 */
export async function pendingFor(id) {
  const [d, ps] = await Promise.all([getLocal(id), tx("photos", "readonly", s => s.getAll())]);
  return !!d?.dirty || ps.some(p => p.checkId === id);
}
export const getLocal = id => tx("drafts", "readonly", s => s.get(id));
export const listLocal = () => tx("drafts", "readonly", s => s.getAll());
export async function dropLocal(id) {
  await tx("drafts", "readwrite", s => s.delete(id));
  const ps = (await tx("photos", "readonly", s => s.getAll())).filter(p => p.checkId === id);
  for (const p of ps) await tx("photos", "readwrite", s => s.delete(p.path));
  await count();
}

export async function queuePhoto(path, blob, checkId) {
  await tx("photos", "readwrite", s => s.put({ path, blob, checkId }));
  await count();
}
export const localPhoto = path => tx("photos", "readonly", s => s.get(path));
export async function dropPhoto(path) { await tx("photos", "readwrite", s => s.delete(path)); await count(); }

async function count() {
  const [ds, ps] = await Promise.all([listLocal(), tx("photos", "readonly", s => s.getAllKeys())]);
  emit({ pending: ds.filter(d => d.dirty).length, photos: ps.length });
}

// 기기가 쓰는 칸만 올린다 — 고객 링크(token·shared_at)와 작성자는 서버 값을 그대로 둔다. car_id 가 비면 DB 가 번호판으로 잇는다
const 서버칸 = r => {
  const o = {};
  for (const k of ["id", "plate", "car_name", "kind", "status", "data", "completed_at", "created_at", "updated_at"]) o[k] = r[k] ?? null;
  o.plate = o.plate || ""; o.car_name = o.car_name || "";
  if (r.car_id) o.car_id = r.car_id;
  return o;
};

/** 기기에 쌓인 것을 서버로. 사진 먼저(검수 기록이 가리키는 파일이 먼저 있어야 고객 링크가 안 깨진다) → 검수 기록. */
let running = null, app = null;
export function sync() {
  if (!app) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    emit({ syncing: true, online: navigator.onLine });
    let error = "";
    try {
      const bucket = app.db.storage.from("car-files");
      for (const p of await tx("photos", "readonly", s => s.getAll())) {
        const { error: e } = await bucket.upload(p.path, p.blob, { contentType: p.blob.type || "image/jpeg", upsert: true });
        if (e) throw new Error(e.message);
        await tx("photos", "readwrite", s => s.delete(p.path));
      }
      for (const d of (await listLocal()).filter(d => d.dirty)) {
        await q(app.db.from("car_checks").upsert(서버칸(d.row)).select("id"));
        // 올리는 사이에 또 고쳤으면 dirty 를 그대로 둔다 (다음 번에 새 내용으로)
        await tx("drafts", "readwrite", s => {
          const g = s.get(d.id);
          g.onsuccess = () => { const cur = g.result; if (cur && cur.at === d.at) s.put({ ...cur, dirty: false }); };
          return null;
        });
      }
    } catch (e) {
      error = navigator.onLine ? (e.message || String(e)) : "인터넷 연결 없음";
    }
    await count();
    emit({ syncing: false, error, online: navigator.onLine });
  })().finally(() => { running = null; });
  return running;
}

/** 앱이 로그인한 뒤 한 번: 연결되면 올리기 + 쌓인 게 있으면 15초마다 다시 */
export function startSync(a) {
  if (app) { app = a; return; }
  app = a;
  addEventListener("online", () => { emit({ online: true }); sync(); });
  addEventListener("offline", () => emit({ online: false }));
  setInterval(() => { if (state.pending || state.photos) sync(); }, 15000);
  count().then(() => { if (state.pending || state.photos) sync(); });
}

/** 사진을 올리기 좋게 줄인다 (긴 변 1600px JPEG). 실패하면 원본 */
export async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const sc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok, bad) => c.toBlob(b => b ? ok(b) : bad(new Error("사진 변환 실패")), "image/jpeg", 0.82));
  } catch { return file; }
  finally { URL.revokeObjectURL(url); }
}
