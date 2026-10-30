/* 수출 매물 사진 — 사무장이 현장에서 찍어 바로 올리는 칸.
 *
 * 왜 따로 만들었나: 지금까지는 카톡방에 올렸는데 카톡이 사진을 압축한다
 * (아슬란 사진이 750x1000 으로 왔다). 비포워드는 고해상도 32컷을 요구하고,
 * 카톡으로는 어느 차 사진인지도 사람이 다시 가려야 해서 자동화가 안 된다.
 * 여기 올리면 차량(번호판)에 바로 묶이고, 수출 자동화가 그대로 가져간다.
 *
 * 올릴 때 긴 변 2560px / JPEG 85% 로 줄인다. 폰 원본은 장당 3~5MB 라
 * 32장이면 150MB 가 넘어 현장에서 올리기 버겁다. 비포워드도 어차피
 * 1440px 로 줄여서 보여주므로 2560 이면 충분히 여유 있다.
 *
 * 선택한 순서가 곧 노출 순서다. 파일명 앞에 번호를 박아 순서를 지킨다.
 */
import { html, useState, useEffect, run, toast } from "../ui.js";
import { q } from "../db.js";

const KIND = "수출사진";
const 긴변 = 2560;
const 품질 = 0.85;

/** 캔버스로 줄인다. 원본이 이미 작으면 그대로 둔다. */
async function 줄이기(file) {
  if (!/^image\//.test(file.type)) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const { width: w, height: h } = bitmap;
  const scale = Math.min(1, 긴변 / Math.max(w, h));
  if (scale === 1 && file.size < 1.5e6) return file;      // 이미 작으면 손대지 않는다
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise(ok => canvas.toBlob(ok, "image/jpeg", 품질));
  if (!blob || blob.size >= file.size) return file;        // 되레 커지면 원본
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

export function ExportPhotos({ app, car }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState("");

  const load = () => run(async () => {
    setList(await q(app.db.from("car_files")
      .select("id,path,name,size,created_at")
      .eq("car_id", car.id).eq("kind", KIND)
      .order("name")));
  });
  useEffect(() => { load(); }, [car.id]);

  const upload = async files => {
    const picked = [...(files || [])].filter(f => /^image\//.test(f.type));
    if (!picked.length) return;
    const start = (list?.length || 0) + 1;
    await run(async () => {
      for (let i = 0; i < picked.length; i++) {
        setBusy(`${i + 1} / ${picked.length}`);
        const small = await 줄이기(picked[i]);
        const seq = String(start + i).padStart(3, "0");
        const path = `${car.id}/export/${seq}_${Date.now()}.jpg`;
        const { error } = await app.db.storage.from("car-files")
          .upload(path, small, { contentType: small.type, upsert: false });
        if (error) throw new Error(error.message);
        await q(app.db.from("car_files").insert({
          car_id: car.id, kind: KIND, name: `${seq}_${small.name}`,
          path, size: small.size, mime: small.type || null,
        }));
      }
      setBusy("");
    }, `사진 ${picked.length}장을 올렸습니다`);
    load();
  };

  const remove = async row => {
    if (!confirm(`${row.name} 을 지울까요?`)) return;
    await run(async () => {
      await app.db.storage.from("car-files").remove([row.path]);
      await q(app.db.from("car_files").delete().eq("id", row.id));
    }, "지웠습니다");
    load();
  };

  const 총크기 = (list || []).reduce((s, f) => s + (f.size || 0), 0);

  return html`<div class="card">
    <div class="bar"><h2>수출 사진</h2><span class="grow"></span>
      <span class="muted">${list ? `${list.length}장` : "불러오는 중"}${
        총크기 ? ` · ${(총크기 / 1048576).toFixed(1)}MB` : ""}</span></div>
    <p class="note">카톡으로 보내지 마세요 — 화질이 깎입니다. 여기서 바로 올리면 원본 화질로
      들어갑니다. 고른 순서가 그대로 노출 순서가 됩니다.</p>
    <label class="btn primary" style="cursor:pointer;display:inline-block">
      ${busy ? `올리는 중 ${busy}` : "사진 고르기 (여러 장)"}
      <input type="file" accept="image/*" multiple hidden
             onChange=${e => { upload(e.target.files); e.target.value = ""; }}>
    </label>
    ${list && list.length > 0 && html`<ul class="plain" style="margin:12px 0 0">
      ${list.map(f => html`<li class="bar" style="padding:4px 0">
        <span>${f.name}</span><span class="grow"></span>
        <span class="muted" style="margin-right:10px">${((f.size || 0) / 1024).toFixed(0)}KB</span>
        <button class="btn danger sm" onClick=${() => remove(f)}>삭제</button>
      </li>`)}
    </ul>`}
  </div>`;
}
