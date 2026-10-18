// 게시판 — 웍스 게시판 대체. 공지 / 매입 등록증 / 매도 등록증 / 자유. 사진·파일 첨부, 댓글. 사무실(대표·직원)만.
// 등록증 글은 차량번호로 차를 찾아, 올린 사진을 그 차의 첨부서류(등록증 / 매도 등록증)에도 붙인다
// (예전 웍스 매입·매도 게시판 → works_reg_sync 가 하던 일).
// 파일은 비공개 버킷 car-files 의 board/<글id>/ 아래. 작성자 이름은 글에 같이 저장 (직원은 남의 profiles 를 못 읽는다).
import { html, useState, useEffect, Loading, Empty, Badge, Seg, Field, Select, run, toast, ask, go } from "../ui.js";
import { q } from "../db.js";
import { 보내기 as 알림 } from "../push.js";

// 자료·송금요청·매도정보·말소서류는 웍스 게시판에서 옮겨 온 분류 (송금요청·매도정보는 나중에 업무관리 기능으로 만들 예정)
const CATS = [["공지", "공지"], ["매입등록증", "매입 등록증"], ["매도등록증", "매도 등록증"], ["송금요청", "송금요청"], ["매도정보", "매도정보"],
  ["말소서류", "말소서류"], ["자료", "자료"], ["자유", "자유"]];
const 이름 = Object.fromEntries(CATS);
const TONE = { 공지: "red", 매입등록증: "blue", 매도등록증: "green", 송금요청: "amber", 매도정보: "green", 말소서류: "gray", 자료: "blue", 자유: "gray" };
const CAR_KIND = { 매입등록증: "등록증", 매도등록증: "매도등록증" };      // car_files.kind 값
const MAX = 20 * 1024 * 1024;
// 저장소 경로는 영문·숫자만 된다 (한글 파일 이름이면 'Invalid key') — 원래 이름은 board_files.name 에 그대로
const 저장이름 = name => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${((name.match(/\.[A-Za-z0-9]{1,5}$/) || [""])[0]).toLowerCase()}`;
const 번호 = s => String(s || "").replace(/\s/g, "");
const 때 = t => { const d = new Date(new Date(t).getTime() + 9 * 3600e3).toISOString(); return d.slice(5, 10).replace("-", "/") + " " + d.slice(11, 16); };
const bucket = app => app.db.storage.from("car-files");

/** 차량번호로 차 찾기 (띄어쓰기 무시, 바뀌기 전 번호도) — 없으면 null */
async function 차찾기(app, plate) {
  const p = 번호(plate), tail = p.slice(-4);
  if (!/^\d{4}$/.test(tail)) return null;
  const rows = await q(app.db.from("cars").select("id, plate, plate_before, car_name").is("deleted_at", null)
    .or(`plate.ilike.%${tail}%,plate_before.ilike.%${tail}%`));
  return rows.find(c => 번호(c.plate) === p || 번호(c.plate_before) === p) || null;
}

export function BoardPage({ app, id }) {
  return id ? html`<${Post} app=${app} id=${id} />` : html`<${List} app=${app} />`;
}

function List({ app }) {
  const [posts, setPosts] = useState(null);
  const [cat, setCat] = useState("전체");
  const [writing, setWriting] = useState(false);
  const load = () => run(async () => {
    const [p, c] = await Promise.all([
      q(app.db.from("board_posts").select("id, category, title, author_name, created_at, pinned, plate, car_id").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(200)),
      q(app.db.from("board_comments").select("post_id")),
    ]);
    const n = {}; c.forEach(x => { n[x.post_id] = (n[x.post_id] || 0) + 1; });
    setPosts(p.map(x => ({ ...x, 댓글: n[x.id] || 0 })));
  });
  useEffect(() => { load(); }, []);
  const shown = (posts || []).filter(p => cat === "전체" || p.category === cat);

  return html`<div class="bar"><h2>게시판</h2><span class="grow"></span>
      <button class="btn primary" onClick=${() => setWriting(!writing)}>${writing ? "닫기" : "✏️ 새 글"}</button></div>
    ${writing && html`<${NewPost} app=${app} onDone=${id => { setWriting(false); go("/board/" + id); }} />`}
    <div class="bar" style="margin:6px 0 10px"><${Seg} value=${cat} onChange=${setCat} options=${[["전체", "전체"], ...CATS]} /></div>
    ${!posts ? html`<${Loading} />` : !shown.length ? html`<${Empty}>글이 없습니다.<//>` : html`<div class="card" style="padding:0">
      <table class="grid click"><tbody>${shown.map(p => html`<tr key=${p.id} onClick=${() => go("/board/" + p.id)}>
        <td style="width:1%"><${Badge} tone=${TONE[p.category]}>${p.pinned ? "📌 " : ""}${이름[p.category]}<//></td>
        <td style="white-space:normal"><b>${p.title}</b>${p.댓글 ? html` <span class="muted small">[${p.댓글}]</span>` : ""}
          ${p.plate && html` <span class="muted small">· ${p.plate}${p.car_id ? " ✓" : ""}</span>`}</td>
        <td class="muted small" style="width:1%">${p.author_name}</td>
        <td class="muted small r" style="width:1%">${때(p.created_at)}</td></tr>`)}</tbody></table></div>`}`;
}

function NewPost({ app, onDone }) {
  const [f, setF] = useState({ category: "자유", title: "", body: "", plate: "", pinned: false });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const 등록증 = !!CAR_KIND[f.category];
  const save = async () => {
    if (busy) return;
    if (!f.title.trim()) return toast("제목을 입력하세요", "err");
    if (등록증 && !번호(f.plate)) return toast("등록증은 차량번호를 입력하세요", "err");
    if (files.some(x => x.size > MAX)) return toast("20MB 넘는 파일은 올릴 수 없습니다.", "err");
    setBusy(true);
    await run(async () => {
      const car = 등록증 ? await 차찾기(app, f.plate) : null;
      const [p] = await q(app.db.from("board_posts").insert({ category: f.category, title: f.title.trim(), body: f.body,
        plate: 등록증 ? 번호(f.plate) : null, car_id: car?.id || null, pinned: f.category === "공지" && f.pinned,
        author_name: app.profile.name }).select("id"));
      for (const x of files) {
        const path = `board/${p.id}/${저장이름(x.name)}`;
        const { error } = await bucket(app).upload(path, x, { contentType: x.type, upsert: false });
        if (error) throw new Error(error.message);
        await q(app.db.from("board_files").insert({ post_id: p.id, name: x.name, path, size: x.size, mime: x.type || null }));
        if (car) await q(app.db.from("car_files").insert({ car_id: car.id, kind: CAR_KIND[f.category], name: x.name, path, size: x.size, mime: x.type || null }));
      }
      // 올린 사람 빼고 전원 폰으로 (실패해도 글은 올라감)
      await 알림(app, { title: `[${이름[f.category]}] ${f.title.trim()}`, body: `${app.profile.name}${f.body ? " · " + f.body.trim().slice(0, 80) : ""}`,
        url: "/office/#/board/" + p.id, tag: "board-" + p.id, exclude_self: true });
      if (등록증 && !car) toast(`${번호(f.plate)} 차를 업무관리에서 못 찾아, 게시판에만 올렸습니다.`, "err");
      else if (car && files.length) toast(`${car.plate} 차 첨부서류에도 붙였습니다.`);
      onDone(p.id);
    });
    setBusy(false);
  };
  return html`<div class="card">
    <div class="fgrid">
      <${Field} label="분류"><${Select} value=${f.category} onChange=${v => set("category", v)} options=${CATS} /><//>
      ${등록증 && html`<${Field} label="차량번호" req hint="이 차의 첨부서류에도 사진이 붙습니다"><input value=${f.plate} placeholder="예: 54다8079" onInput=${e => set("plate", e.target.value)} /><//>`}
      ${f.category === "공지" && html`<${Field} label="맨 위에 고정"><input type="checkbox" style="width:auto" checked=${f.pinned} onChange=${e => set("pinned", e.target.checked)} /><//>`}
    </div>
    <${Field} label="제목" req wide><input value=${f.title} onInput=${e => set("title", e.target.value)} /><//>
    <${Field} label="내용" wide><textarea rows="5" value=${f.body} onInput=${e => set("body", e.target.value)}></textarea><//>
    <${Field} label="사진·파일" wide hint=${files.length ? files.map(x => x.name).join(", ") : "여러 개 한 번에 고를 수 있습니다 (파일당 20MB까지)"}>
      <input type="file" multiple onChange=${e => setFiles([...e.target.files])} /><//>
    <div class="bar"><span class="grow"></span><button class="btn primary" disabled=${busy} onClick=${save}>${busy ? "올리는 중…" : "올리기"}</button></div>
  </div>`;
}

function Post({ app, id }) {
  const [p, setP] = useState(undefined);
  const [files, setFiles] = useState([]);
  const [urls, setUrls] = useState({});
  const [cs, setCs] = useState([]);
  const [c, setC] = useState("");
  const [edit, setEdit] = useState(null);
  const load = () => run(async () => {
    const [[post], fl, cm] = await Promise.all([
      q(app.db.from("board_posts").select("*").eq("id", id)),
      q(app.db.from("board_files").select("*").eq("post_id", id).order("created_at")),
      q(app.db.from("board_comments").select("*").eq("post_id", id).order("created_at")),
    ]);
    setP(post || null); setFiles(fl); setCs(cm);
    const u = {};
    for (const x of fl) { const { data } = await bucket(app).createSignedUrl(x.path, 600); if (data) u[x.id] = data.signedUrl; }
    setUrls(u);
  });
  useEffect(() => { load(); }, [id]);
  if (p === undefined) return html`<${Loading} />`;
  if (!p) return html`<${Empty}>지워졌거나 없는 글입니다. <a href="#/board">목록으로</a><//>`;

  const addC = () => run(async () => {
    if (!c.trim()) return;
    await q(app.db.from("board_comments").insert({ post_id: id, body: c.trim(), author_name: app.profile.name }));
    setC(""); load();
  });
  const delC = x => ask("이 댓글을 지울까요?") && run(async () => { await q(app.db.from("board_comments").delete().eq("id", x.id)); load(); });
  const saveEdit = () => run(async () => {
    await q(app.db.from("board_posts").update({ title: edit.title.trim() || p.title, body: edit.body, updated_at: new Date().toISOString() }).eq("id", id));
    setEdit(null); load();
  }, "고쳤습니다");
  const del = () => ask("이 글을 지울까요? 첨부도 함께 지워집니다. (차에 붙인 등록증은 그대로 남습니다)") && run(async () => {
    const paths = files.map(x => x.path);
    const keep = paths.length ? (await q(app.db.from("car_files").select("path").in("path", paths))).map(x => x.path) : [];
    const gone = paths.filter(x => !keep.includes(x));
    if (gone.length) await bucket(app).remove(gone);
    await q(app.db.from("board_posts").delete().eq("id", id));
    go("/board");
  }, "지웠습니다");
  const imgs = files.filter(x => /^image\//.test(x.mime || "") && urls[x.id]), etc = files.filter(x => !imgs.includes(x));

  return html`<div class="bar"><a href="#/board">← 게시판</a><span class="grow"></span>
      ${!edit && html`<button class="btn sm ghost" onClick=${() => setEdit({ title: p.title, body: p.body })}>수정</button>`}
      <button class="btn sm danger" onClick=${del}>삭제</button></div>
    <div class="card">
      <div class="bar"><${Badge} tone=${TONE[p.category]}>${p.pinned ? "📌 " : ""}${이름[p.category]}<//>
        <span class="muted small">${p.author_name} · ${때(p.created_at)}${p.updated_at !== p.created_at ? " (수정됨)" : ""}</span></div>
      ${edit ? html`<${Field} label="제목" wide><input value=${edit.title} onInput=${e => setEdit({ ...edit, title: e.target.value })} /><//>
          <${Field} label="내용" wide><textarea rows="6" value=${edit.body} onInput=${e => setEdit({ ...edit, body: e.target.value })}></textarea><//>
          <div class="bar"><span class="grow"></span><button class="btn ghost" onClick=${() => setEdit(null)}>취소</button><button class="btn primary" onClick=${saveEdit}>저장</button></div>`
        : html`<h3 style="margin:8px 0">${p.title}</h3>${p.body && html`<div style="white-space:pre-wrap;line-height:1.6">${p.body}</div>`}`}
      ${p.plate && html`<p class="small" style="margin-top:10px">차량번호 <b>${p.plate}</b> ${p.car_id
        ? html`· <a href=${"#/car/" + p.car_id + "/files"}>차 첨부서류 보기 →</a>` : html`<span class="muted">· 업무관리에 없는 차</span>`}</p>`}
      ${imgs.length > 0 && html`<div class="files" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:12px">
        ${imgs.map(x => html`<a href=${urls[x.id]} target="_blank" rel="noopener"><img src=${urls[x.id]} alt=${x.name} style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px" /></a>`)}</div>`}
      ${etc.length > 0 && html`<ul class="todo" style="margin-top:10px">${etc.map(x => html`<li>📎 ${urls[x.id] ? html`<a href=${urls[x.id]} target="_blank" rel="noopener">${x.name}</a>` : x.name}</li>`)}</ul>`}
    </div>
    <div class="card"><h3>댓글 ${cs.length || ""}</h3>
      ${cs.length > 0 && html`<ul class="todo">${cs.map(x => html`<li key=${x.id}><div class="grow" style="flex:1"><b class="small">${x.author_name}</b> <span class="muted small">${때(x.created_at)}</span>
        <div style="white-space:pre-wrap">${x.body}</div></div><button class="btn sm ghost" onClick=${() => delC(x)}>✕</button></li>`)}</ul>`}
      <div class="row" style="margin-top:8px"><input value=${c} placeholder="댓글 쓰기" onInput=${e => setC(e.target.value)}
        onKeyDown=${e => { if (e.key === "Enter" && !e.isComposing) addC(); }} /><button class="btn" onClick=${addC}>등록</button></div>
    </div>`;
}
