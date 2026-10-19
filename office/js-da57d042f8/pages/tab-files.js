// 차량 상세 → 첨부서류: 관인계약서·이전서류·영수증 사진 등. 저장소는 비공개 버킷 'car-files' (사무실만 접근).
import { html, useState, useEffect, Select, run, toast, ask } from "../ui.js";
import { q } from "../db.js";
import { 모두줄이기 } from "../img.js";

const KINDS = [["제시", "매입"], ["등록증", "매입 등록증"], ["매도", "매도"], ["매도등록증", "매도 등록증"], ["정산", "정산"], ["성능", "성능"], ["기타", "기타"]];   // 값은 그대로(DB), 화면엔 매입
const MAX = 20 * 1024 * 1024;
// 저장소 경로는 영문·숫자만 된다 (한글 파일 이름이면 'Invalid key'로 올라가지 않음) — 원래 이름은 car_files.name 에 그대로
const 저장이름 = name => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${((name.match(/\.[A-Za-z0-9]{1,5}$/) || [""])[0]).toLowerCase()}`;

export function FilesTab({ app, car, office }) {
  const [files, setFiles] = useState(null);
  const [urls, setUrls] = useState({});
  const [kind, setKind] = useState("제시");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const bucket = () => app.db.storage.from("car-files");

  const load = () => run(async () => {
    const f = await q(app.db.from("car_files").select("*").eq("car_id", car.id).order("created_at"));
    setFiles(f);
    const u = {};
    for (const x of f.filter(x => /^image\//.test(x.mime || ""))) {
      const { data } = await bucket().createSignedUrl(x.path, 600);
      if (data) u[x.id] = data.signedUrl;
    }
    setUrls(u);
  });
  useEffect(() => { load(); }, [car.id]);

  const upload = async list => {
    if (!office) return;
    setBusy(true);
    const arr = await 모두줄이기(list);       // 폰 사진은 긴 변 2000px 로 (3~5MB → 수백 KB), PDF 등은 그대로
    if (arr.some(f => f.size > MAX)) { setBusy(false); return toast("20MB 넘는 파일은 올릴 수 없습니다.", "err"); }
    await run(async () => {
      for (const f of arr) {
        const path = `${car.id}/${저장이름(f.name)}`;
        const { error } = await bucket().upload(path, f, { contentType: f.type, upsert: false });
        if (error) throw new Error(error.message);
        await q(app.db.from("car_files").insert({ car_id: car.id, kind, name: f.name, path, size: f.size, mime: f.type || null }));
      }
    }, `${arr.length}개 올렸습니다`);
    setBusy(false); load();
  };
  const open = async f => {
    const { data, error } = await bucket().createSignedUrl(f.path, 120);
    if (error) return toast(error.message, "err");
    window.open(data.signedUrl, "_blank", "noopener");
  };
  const remove = async f => {
    if (!ask(`${f.name} 을(를) 지울까요?`)) return;
    await run(async () => { await bucket().remove([f.path]); await q(app.db.from("car_files").delete().eq("id", f.id)); }, "지웠습니다");
    load();
  };

  if (!files) return null;
  return html`<div class="card">
    <div class="bar"><h3>첨부서류</h3><span class="muted small">${files.length}개</span></div>
    ${office && html`<div class="row" style="margin-bottom:8px; max-width:320px"><span class="muted small">구분</span><${Select} value=${kind} onChange=${setKind} options=${KINDS} /></div>
      <label class=${"dropzone" + (drag ? " on" : "")} onDragOver=${e => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)}
        onDrop=${e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
        ${busy ? "올리는 중…" : "여기로 끌어다 놓거나 눌러서 고르세요 (사진·PDF, 20MB 이하)"}
        <input type="file" hidden multiple accept="image/*,.pdf,.hwp,.xlsx,.xls,.doc,.docx" onChange=${e => { upload(e.target.files); e.target.value = ""; }} /></label>`}
    ${!files.length ? html`<p class="muted">첨부된 서류가 없습니다.</p>` : html`<div class="files">${files.map(f => html`<div class="file">
      ${urls[f.id] ? html`<img src=${urls[f.id]} alt=${f.name} onClick=${() => open(f)} />` : html`<div class="muted small">${(f.mime || "").split("/")[1] || "파일"}</div>`}
      <b class="small ellipsis" title=${f.name}>${f.name}</b>
      <span class="muted small">${f.kind === "제시" ? "매입" : f.kind} · ${f.created_at.slice(0, 10)} · ${Math.ceil((f.size || 0) / 1024)}KB</span>
      <div class="row"><button class="btn sm" onClick=${() => open(f)}>열기</button>${office && html`<button class="btn sm ghost" onClick=${() => remove(f)}>삭제</button>`}</div>
    </div>`)}</div>`}
  </div>`;
}
