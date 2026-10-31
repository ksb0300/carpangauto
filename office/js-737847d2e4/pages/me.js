// 내 정보 — 프로필 사진(올리기·바꾸기·지우기) + 비밀번호 변경. 위쪽 내 이름을 누르면 온다.
//   사진은 가운데를 정사각형으로 잘라 512px JPEG 로 줄여 'avatars/<내 id>/<시각>.jpg' 에 올린다 (예전 사진 파일은 지움).
import { html, useState, run, toast, ask } from "../ui.js";
import { Avatar, 사진기억, 구성원 } from "../people.js";
import { ChangePassword, 시작소리 } from "../app.js";

/** 사진 파일 → 가운데 정사각형 512px JPEG Blob */
async function 정사각형(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error("사진을 열 수 없습니다. JPG·PNG 사진으로 해 주세요.");
  const s = Math.min(bmp.width, bmp.height), N = Math.min(512, s);
  const c = Object.assign(document.createElement("canvas"), { width: N, height: N });
  c.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, N, N);
  return await new Promise(r => c.toBlob(r, "image/jpeg", 0.88));
}

export function MyPage({ app }) {
  const p = app.profile, [busy, setBusy] = useState(false);
  const 바꾸기 = async file => {
    if (!file) return;
    setBusy(true);
    await run(async () => {
      const blob = await 정사각형(file), path = `${app.user.id}/${Date.now()}.jpg`, 옛 = p.avatar_path;
      const up = await app.db.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw new Error(up.error.message);
      const { error } = await app.db.rpc("set_my_avatar", { p_path: path });
      if (error) throw new Error(error.message);
      if (옛) await app.db.storage.from("avatars").remove([옛]);
      p.avatar_path = path; 사진기억(app.user.id, p.name, path); 구성원(app, true);
    }, "프로필 사진을 바꿨습니다");
    setBusy(false);
  };
  const 지우기 = () => ask("프로필 사진을 지울까요? (이니셜 동그라미로 돌아갑니다)") && run(async () => {
    const { error } = await app.db.rpc("set_my_avatar", { p_path: "" });
    if (error) throw new Error(error.message);
    if (p.avatar_path) await app.db.storage.from("avatars").remove([p.avatar_path]);
    p.avatar_path = null; 사진기억(app.user.id, p.name, null); 구성원(app, true);
  }, "프로필 사진을 지웠습니다");
  return html`<div class="card" style="max-width:420px">
      <h2>내 정보</h2>
      <div class="row" style="gap:18px;align-items:center;margin:8px 0 4px">
        <${Avatar} name=${p.name} id=${app.user.id} size=${96} />
        <div><b style="font-size:18px">${p.name}</b><div class="muted small">${{ admin: "공동대표", staff: "사무장" }[p.role] || ""} · ${app.user.email}</div></div>
      </div>
      <p class="muted small">사진은 게시판·댓글·할 일·일정·근태에서 이름 옆 동그라미에 보입니다.</p>
      <div class="row" style="gap:8px">
        <label class=${"btn primary" + (busy ? " disabled" : "")}>${busy ? "올리는 중…" : p.avatar_path ? "📷 사진 바꾸기" : "📷 사진 올리기"}
          <input type="file" accept="image/*" hidden disabled=${busy} onChange=${e => { 바꾸기(e.target.files[0]); e.target.value = ""; }} /></label>
        ${p.avatar_path && html`<button class="btn ghost" onClick=${지우기}>사진 지우기</button>`}
      </div>
    </div>
    <${인트로설정} />
    <div style="margin-top:14px"><${ChangePassword} db=${app.db} onDone=${() => (location.hash = "/")} /></div>`;
}

/** 시작 화면·소리 (하루 한 번 '띵·띵·띵 두둥') — 이 기기에서만 끄고 켠다 */
function 인트로설정() {
  const 읽기 = () => { try { return localStorage.getItem("tierone-intro-off") !== "1"; } catch { return true; } };
  const [on, setOn] = useState(읽기);
  const 바꾸기 = v => { try { localStorage.setItem("tierone-intro-off", v ? "0" : "1"); } catch {} setOn(v); };
  return html`<div class="card" style="max-width:420px;margin-top:14px">
    <h3>시작 화면·소리</h3>
    <p class="muted small">하루 한 번 앱을 열 때 TierONE 아이콘이 빛나며 '띵·띵·띵 두둥'이 나옵니다. 이 기기에서만 적용됩니다.</p>
    <div class="row" style="gap:8px;align-items:center">
      <label class="check"><input type="checkbox" checked=${on} onChange=${e => 바꾸기(e.target.checked)} /> 켜기</label>
      <button class="btn sm" onClick=${() => 시작소리().catch(() => toast("소리를 낼 수 없습니다 — 기기 소리를 켜 주세요", "err"))}>🔊 들어보기</button>
    </div></div>`;
}
