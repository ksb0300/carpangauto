// 데모 모드: 브라우저 안의 진짜 Postgres(PGlite)에 운영과 같은 스키마를 올리고,
// supabase-js 와 같은 모양의 호출(from().select().eq()…, rpc, auth)을 흉내 낸다.
// 그래서 화면 코드는 데모와 운영에서 똑같다. 트리거·잠금·RLS 도 운영과 같게 동작한다.

const PGLITE = "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/index.js";
const PGCRYPTO = "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/contrib/pgcrypto.js";
const STORE = "idb://carpang-office-demo";
const DEMO_V = "2";   // 데모 전용 준비 SQL(아래 install)이 바뀌면 올린다

export const DEMO_USERS = {
  admin:  { id: "00000000-0000-0000-0000-00000000000a", email: "admin@demo", name: "대표(데모)", role: "admin" },
  staff:  { id: "00000000-0000-0000-0000-00000000000b", email: "staff@demo", name: "직원(데모)", role: "staff" },
  dealer: { id: "00000000-0000-0000-0000-00000000000d", email: "dealer@demo", name: "김딜러(데모)", role: "dealer" },
};

let pg;

async function boot() {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([import(PGLITE), import(PGCRYPTO)]);
  // Supabase(PostgREST)처럼: 날짜·시각은 문자열, numeric 은 숫자로 받는다
  const asText = s => s;
  pg = await PGlite.create(STORE, { extensions: { pgcrypto },
    parsers: { 1082: asText, 1114: asText, 1184: asText, 1700: Number } });
  // 스키마가 바뀌면(빌드가 version.txt 를 갱신) 데모 DB 를 지우고 새로 만든다
  const want = (await (await fetch(new URL("../sql/version.txt", import.meta.url), { cache: "no-store" })).text()).trim() + "-" + DEMO_V;
  const have = await pg.query(`select to_regclass('public._demo_meta') is not null as ok`);
  const cur = have.rows[0].ok ? (await pg.query(`select v from _demo_meta`)).rows[0]?.v : null;
  if (cur === want) return;
  if (cur !== null || (await pg.query(`select to_regclass('public.cars') is not null as ok`)).rows[0].ok) {
    await pg.close();
    await new Promise(r => { const q = indexedDB.deleteDatabase("/pglite/carpang-office-demo"); q.onsuccess = q.onerror = q.onblocked = r; });
    pg = await PGlite.create(STORE, { extensions: { pgcrypto }, parsers: { 1082: asText, 1114: asText, 1184: asText, 1700: Number } });
    sessionStorage.setItem("carpang-demo-upgraded", "1");
  }
  await install();
  await pg.query(`create table _demo_meta (v text)`);
  await pg.query(`insert into _demo_meta values ($1)`, [want]);
}

async function install() {
  const schema = await (await fetch(new URL("../sql/schema.sql", import.meta.url))).text();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb,
      banned_until timestamptz, last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema extensions;
    create schema vault; create table vault.secrets_raw (name text, secret text);
    create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets_raw;
    insert into vault.secrets_raw values ('ssn_key', 'demo-only-key');
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);
  await pg.exec(schema);
  await pg.exec(`create table _demo_files (path text primary key, mime text, data bytea not null)`);   // 첨부 저장소 대용
  const U = DEMO_USERS;
  for (const u of [U.admin, U.staff, U.dealer]) await pg.query(`insert into auth.users (id, email) values ($1, $2)`, [u.id, u.email]);
  // 공동대표 3명 + (나중에 뽑을) 딜러 1명
  const d1 = (await pg.query(`insert into dealers (name, kind, phone, partner) values ('김상혁', '사업자', '010-0000-0000', true) returning id`)).rows[0].id;
  const d3 = (await pg.query(`insert into dealers (name, kind, partner) values ('이동관', '사업자', true) returning id`)).rows[0].id;
  await pg.query(`insert into dealers (name, kind, partner) values ('김기택', '사업자', true)`);
  const d2 = (await pg.query(`insert into dealers (name, kind) values ('김딜러', '개인') returning id`)).rows[0].id;
  // 계정 트리거가 만든 행에 역할·딜러를 지정 (운영에서 대표가 계정 화면에서 하는 일)
  for (const [u, dealer] of [[U.admin, d1], [U.staff, null], [U.dealer, d2]])
    await pg.query(`update profiles set name = $2, role = $3, dealer_id = $4 where user_id = $1`, [u.id, u.name, u.role, dealer]);
  // 예시 차량 몇 대 (대표로 넣어야 created_by·이력이 자연스럽다)
  await asUser(U.admin.id, async tx => {
    const today = new Date().toISOString().slice(0, 10);
    const cars = [
      ["BMW 530e M 스포츠", "121라9496", 37_400_000, d1, 392_700],
      ["기아 EV6 롱레인지", "33머7081", 28_900_000, d3, 303_450],
      ["벤츠 C200d", "19조0174", 23_000_000, d2, 0],
    ];
    const ids = [];
    for (const [name, plate, amt, dealer, tax] of cars)
      ids.push((await tx.query(`insert into cars (car_name, plate, plate_before, purchase_amount, purchase_fee, acq_tax, dealer_id, purchase_date, seller_name)
                      values ($1,$2,$2,$3,600000,$4,$5,$6,'예시 매도자') returning id`, [name, plate, amt, tax, dealer, today])).rows[0].id);
    // 예시 성능점검 (KAIWA 연동 결과 모양) — 하나는 90일 넘겨 대시보드 알림이 보이게
    const ago = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    for (const [car, no, d, price, res] of [
      [ids[0], "9800066713", 95, 127380, { 사고이력: "없음", 단순수리: "없음", "침수·화재": "없음", "렌트·영업용": "없음", 튜닝: "없음" }],
      [ids[2], "9800068333", 10, 420420, { 사고이력: "없음", 단순수리: "있음", "침수·화재": "없음", "렌트·영업용": "없음", 튜닝: "없음" }]])
      await tx.query(`insert into car_inspections (car_id, reserve_id, check_no, recept_date, expire_date, place, insurer, check_price, insur_price, result)
                      values ($1, $2, $3, $4::date, $4::date + 119, '예시 점검장', '흥국화재', 44000, $5, $6)`, [car, Number(no), no, ago(d), price, JSON.stringify(res)]);
  });
}

async function asUser(uid, fn) {
  return pg.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid || ""]);
    await tx.exec(`set local role ${uid ? "authenticated" : "anon"}`);
    return fn(tx);
  });
}

const qi = s => '"' + String(s).replace(/"/g, '""') + '"';
const val = v => (v !== null && typeof v === "object" && !(v instanceof Date)) ? JSON.stringify(v) : v;

class Query {
  constructor(client, table) {
    Object.assign(this, { client, table, op: "select", cols: "*", filters: [], orders: [], lim: null,
      one: null, returning: null, values: null, conflict: null });
  }
  select(cols = "*") { if (this.op === "select") this.cols = cols; else this.returning = cols; return this; }
  insert(v) { this.op = "insert"; this.values = v; return this; }
  update(v) { this.op = "update"; this.values = v; return this; }
  upsert(v, o = {}) { this.op = "upsert"; this.values = v; this.conflict = o.onConflict || "id"; this.ignoreDup = !!o.ignoreDuplicates; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.filters.push([c, "=", v]); return this; }
  neq(c, v) { this.filters.push([c, "<>", v]); return this; }
  gte(c, v) { this.filters.push([c, ">=", v]); return this; }
  lte(c, v) { this.filters.push([c, "<=", v]); return this; }
  ilike(c, v) { this.filters.push([c, "ilike", v]); return this; }
  lt(c, v) { this.filters.push([c, "<", v]); return this; }
  gt(c, v) { this.filters.push([c, ">", v]); return this; }
  is(c, v) { this.filters.push([c, v === null ? "is null" : "is not null", undefined]); return this; }
  in(c, arr) { this.filters.push([c, "in", arr]); return this; }
  order(c, o = {}) { this.orders.push(`${qi(c)} ${o.ascending === false ? "desc" : "asc"}${o.nullsFirst ? " nulls first" : ""}`); return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "one"; return this; }
  then(ok, bad) { return this.run().then(ok, bad); }

  where(params) {
    if (!this.filters.length) return "";
    return " where " + this.filters.map(([c, op, v]) => {
      if (op.startsWith("is ")) return `${qi(c)} ${op}`;
      if (op === "in") { if (!v.length) return "false"; return `${qi(c)} in (${v.map(x => (params.push(x), "$" + params.length)).join(",")})`; }
      params.push(v); return `${qi(c)} ${op} $${params.length}`;
    }).join(" and ");
  }
  cols_(c) { return c === "*" ? "*" : c.split(",").map(s => qi(s.trim())).join(","); }

  async run() {
    const p = [];
    let sql;
    const rows = Array.isArray(this.values) ? this.values : this.values ? [this.values] : [];
    if (this.op === "select") {
      sql = `select ${this.cols_(this.cols)} from ${qi(this.table)}${this.where(p)}`
          + (this.orders.length ? " order by " + this.orders.join(",") : "") + (this.lim ? ` limit ${Number(this.lim)}` : "");
    } else if (this.op === "insert" || this.op === "upsert") {
      if (!rows.length) return { data: [], error: null };
      const keys = [...new Set(rows.flatMap(Object.keys))];
      // 행마다 없는 키는 컬럼 기본값(default)을 쓴다
      const tuples = rows.map(r => "(" + keys.map(k => r[k] === undefined ? "default" : (p.push(val(r[k])), "$" + p.length)).join(",") + ")");
      sql = `insert into ${qi(this.table)} (${keys.map(qi).join(",")}) values ${tuples.join(",")}`;
      if (this.op === "upsert") {
        const upd = keys.filter(k => !this.conflict.split(",").includes(k)).map(k => `${qi(k)} = excluded.${qi(k)}`);
        sql += ` on conflict (${this.conflict.split(",").map(qi).join(",")}) do ${upd.length && !this.ignoreDup ? "update set " + upd.join(",") : "nothing"}`;
      }
      sql += ` returning ${this.cols_(this.returning || "*")}`;
    } else if (this.op === "update") {
      const keys = Object.keys(this.values);
      const set = keys.map(k => (p.push(val(this.values[k])), `${qi(k)} = $${p.length}`)).join(",");
      sql = `update ${qi(this.table)} set ${set}${this.where(p)} returning ${this.cols_(this.returning || "*")}`;
    } else if (this.op === "delete") {
      sql = `delete from ${qi(this.table)}${this.where(p)} returning ${this.cols_(this.returning || "*")}`;
    }
    try {
      const res = await asUser(this.client.uid, tx => tx.query(sql, p));
      // supabase-js 와 같게: 쓰기(insert/update/upsert/delete)는 .select() 를 붙였을 때만 행을 돌려준다
      let data = this.op !== "select" && this.returning === null ? null : res.rows;
      if (this.one && data !== null) {
        if (data.length > 1 || (this.one === "one" && !data.length)) return { data: null, error: { message: this.one === "one" ? "행을 찾지 못했습니다" : "여러 행" } };
        data = data[0] ?? null;
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: cleanError(e.message) } };
    }
  }
}

function cleanError(m) {
  if (/duplicate key.*cars_one_stock_per_plate/.test(m)) return "같은 번호판의 재고 차량이 이미 있습니다.";
  if (/row-level security|permission denied/.test(m)) return "권한이 없습니다.";
  return m;
}

// 서버 함수의 관리자 클라이언트(auth.admin.*) 흉내 — 데모 auth.users 표를 직접 고친다
const userOut = r => ({ id: r.id, email: r.email, user_metadata: r.raw_user_meta_data || {}, banned_until: r.banned_until, last_sign_in_at: r.last_sign_in_at });
const demoAdmin = { auth: { admin: {
  async listUsers() { const r = await pg.query(`select * from auth.users order by email`); return { data: { users: r.rows.map(userOut) }, error: null }; },
  async getUserById(id) { const r = await pg.query(`select * from auth.users where id = $1`, [id]); return r.rows[0] ? { data: { user: userOut(r.rows[0]) }, error: null } : { data: null, error: { message: "없는 계정" } }; },
  async createUser({ email, user_metadata }) {
    try { const r = await pg.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning *`, [email, JSON.stringify(user_metadata || {})]);
          return { data: { user: userOut(r.rows[0]) }, error: null }; }
    catch (e) { return { data: null, error: { message: /unique|duplicate/.test(e.message) ? "이미 있는 이메일입니다" : e.message } }; }
  },
  async updateUserById(id, { ban_duration, user_metadata }) {
    if (ban_duration) await pg.query(`update auth.users set banned_until = case when $2 = 'none' then null else now() + interval '100 years' end where id = $1`, [id, ban_duration]);
    if (user_metadata) await pg.query(`update auth.users set raw_user_meta_data = $2 where id = $1`, [id, JSON.stringify(user_metadata)]);
    return { data: { user: { id } }, error: null };
  },
} } };

export async function createDemoClient() {
  await boot();
  const session = () => { try { return JSON.parse(localStorage.getItem("carpang-demo-user") || "null"); } catch { return null; } };
  const client = {
    get uid() { return session()?.id; },
    from: table => new Query(client, table),
    async rpc(fn, args = {}) {
      const keys = Object.keys(args);
      const sql = `select ${qi(fn)}(${keys.map((k, i) => `${qi(k)} => $${i + 1}`).join(",")}) as r`;
      try {
        const res = await asUser(client.uid, tx => tx.query(sql, keys.map(k => val(args[k]))));
        return { data: res.rows[0]?.r ?? null, error: null };
      } catch (e) { return { data: null, error: { message: cleanError(e.message) } }; }
    },
    auth: {
      async getSession() { const u = session(); return { data: { session: u ? { user: { id: u.id, email: u.email } } : null } }; },
      async signInDemo(role) { localStorage.setItem("carpang-demo-user", JSON.stringify(DEMO_USERS[role])); return { error: null }; },
      async signInWithPassword() { return { error: { message: "데모 모드에서는 역할을 골라 들어갑니다." } }; },
      async signOut() { localStorage.removeItem("carpang-demo-user"); return { error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },
    functions: {
      // 운영에서는 Supabase Edge Function 'popbill' 이 하는 일을, 같은 처리 코드 + 모의 팝빌로 돌린다
      async invoke(name, { body } = {}) {
        try {
          const role = (await client.from("profiles").select("role").eq("user_id", client.uid).maybeSingle()).data?.role;
          if (name === "popbill") {
            const [{ handle }, { makeDemoPopbill }] = await Promise.all([import("./shared/office-actions.js"), import("./demo-popbill.js")]);
            const settings = (await client.from("settings").select("*").eq("id", 1).single()).data;
            return { data: { data: await handle(body.action, body, { db: client, pb: makeDemoPopbill(client), settings, role }) }, error: null };
          }
          if (name === "accounts") {
            const { handleAccount } = await import("./shared/account-actions.js");
            return { data: { data: await handleAccount(body.action, body, { admin: demoAdmin, db: client, role, uid: client.uid }) }, error: null };
          }
          return { data: null, error: { message: "없는 함수: " + name } };
        } catch (e) { return { data: { error: e.message }, error: null }; }
      },
    },
    storage: {
      from: () => ({
        async upload(path, file, o = {}) {
          try {
            const data = new Uint8Array(await file.arrayBuffer());
            await pg.query(`insert into _demo_files (path, mime, data) values ($1, $2, $3)` + (o.upsert ? ` on conflict (path) do update set data = excluded.data` : ""),
              [path, file.type || "application/octet-stream", data]);
            return { data: { path }, error: null };
          } catch (e) { return { data: null, error: { message: /duplicate/.test(e.message) ? "같은 이름의 파일이 있습니다" : e.message } }; }
        },
        async createSignedUrl(path) {
          const r = (await pg.query(`select mime, data from _demo_files where path = $1`, [path])).rows[0];
          if (!r) return { data: null, error: { message: "파일이 없습니다" } };
          return { data: { signedUrl: URL.createObjectURL(new Blob([r.data], { type: r.mime })) }, error: null };
        },
        async remove(paths) { for (const p of paths) await pg.query(`delete from _demo_files where path = $1`, [p]); return { data: paths, error: null }; },
      }),
    },
    async resetDemo() {
      await pg.close();
      await new Promise(r => { const q = indexedDB.deleteDatabase("/pglite/carpang-office-demo"); q.onsuccess = q.onerror = q.onblocked = r; });
      location.reload();
    },
  };
  return client;
}
