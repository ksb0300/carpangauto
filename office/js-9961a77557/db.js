import { DEMO, SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";
let client;

/** 운영이면 Supabase, 설정이 비어 있으면 데모(PGlite) 클라이언트. 호출 모양은 같다. */
export async function getDb() {
  if (client) return client;
  if (DEMO) {
    const { createDemoClient } = await import("./demo-db.js");
    client = await createDemoClient();
  } else {
    const { createClient } = await import(SUPABASE_JS);
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}

/** { data, error } 를 풀어서 에러면 던진다. */
export async function q(p) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}
