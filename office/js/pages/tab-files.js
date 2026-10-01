// 차량 상세 → 첨부서류: 관인계약서·이전서류·영수증 사진 등. 저장소는 비공개 버킷 'car-files' (사무실만 접근).
import { html, useState, useEffect, Select, run, toast, ask } from "../ui.js";
import { q } from "../db.js";

const KINDS = ["제시", "매도", "정산", "기타"];
const MAX = 20 * 1024 * 1024;
const safe = s => s.replace(/[^\w.\-가-힣]/g, "_").slice(-80);

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
    const arr = [...list];
    if (arr.some(f => f.size > MAX)) return toast("20MB 넘는 파일은 올릴 수 없습니다.", "err");
    setBusy(true);
    await run(async () => {
      for (const f of arr) {
        const path = `${car.id}/${Date.now()}_${safe(f.name)}`;
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
    ${office && html`<div class="row" style="margin-bottom:8px"><span class="muted small">구분</span><${Select} value=${kind} onChange=${setKind} options=${KINDS} /></div>
      <label class=${"dropzone" + (drag ? " on" : "")} onDragOver=${e => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)}
        onDrop=${e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
        ${busy ? "올리는 중…" : "여기로 끌어다 놓거나 눌러서 고르세요 (사진·PDF, 20MB 이하)"}
        <input type="file" hidden multiple accept="image/*,.pdf,.hwp,.xlsx,.xls,.doc,.docx" onChange=${e => { upload(e.target.files); e.target.value = ""; }} /></label>`}
    ${!files.length ? html`<p class="muted">첨부된 서류가 없습니다.</p>` : html`<div class="files">${files.map(f => html`<div class="file">
      ${urls[f.id] ? html`<img src=${urls[f.id]} alt=${f.name} onClick=${() => open(f)} />` : html`<div class="muted small">${(f.mime || "").split("/")[1] || "파일"}</div>`}
      <b class="small ellipsis" title=${f.name}>${f.name}</b>
      <span class="muted small">${f.kind} · ${f.created_at.slice(0, 10)} · ${Math.ceil((f.size || 0) / 1024)}KB</span>
      <div class="row"><button class="btn sm" onClick=${() => open(f)}>열기</button>${office && html`<button class="btn sm ghost" onClick=${() => remove(f)}>삭제</button>`}</div>
    </div>`)}</div>`}
  </div>`;
}
