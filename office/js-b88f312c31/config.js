// Supabase 연결 정보. 주소와 공개키(publishable)는 원래 공개용이다 — 데이터 보호는 DB 의 RLS 가 한다.
// 주소 끝에 ?demo 를 붙이면 서버 대신 브라우저 안의 데모 DB(PGlite)로 돈다.
export const SUPABASE_URL = "https://fwqtyyjhfewpxihpaasu.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_op7s3siOFMjUk99QfFbVZw_mmRBmZl1";

export const DEMO = !SUPABASE_URL || new URLSearchParams(location.search).has("demo");
