// 계정 관리 — 대표만. 메일 없이 대표가 임시 비밀번호로 계정을 만들고, 첫 로그인 때 본인이 바꾸게 한다.
// (Supabase 무료 기본 메일은 조직 구성원에게만 가므로 초대 메일에 기대지 않는다)
//   ctx.admin  관리자 권한 클라이언트 (서버: service role / 데모: 흉내) — auth.admin.* 만 쓴다
//   ctx.db     호출한 대표의 권한으로 만든 클라이언트 (profiles 수정은 RLS 로 대표만 가능)
//   ctx.uid    호출한 사람

async function q(p) { const { data, error } = await p; if (error) throw new Error(error.message); return data; }
const FOREVER = "876000h";   // 100년 = 사실상 영구 정지

function checkPw(pw) {
  if (!pw || String(pw).length < 8) throw new Error("비밀번호는 8자 이상이어야 합니다.");
}

export const ACCOUNT_ACTIONS = {
  /** 로그인 계정 목록 (이메일·정지 여부·마지막 로그인) */
  async list({ admin }) {
    const { users } = await q(admin.auth.admin.listUsers({ page: 1, perPage: 1000 }));
    return users.map(u => ({
      id: u.id, email: u.email, last_sign_in_at: u.last_sign_in_at || null,
      disabled: !!u.banned_until && new Date(u.banned_until) > new Date(),
      must_change: !!u.user_metadata?.must_change_password,
    }));
  },

  async create({ admin, db }, { email, password, name, role, dealer_id }) {
    if (!/^\S+@\S+\.\S+$/.test(email || "")) throw new Error("이메일 형식이 아닙니다.");
    checkPw(password);
    if (!["admin", "staff", "dealer"].includes(role)) throw new Error("역할을 고르세요.");
    if (role === "dealer" && !dealer_id) throw new Error("딜러 계정은 연결할 딜러를 골라야 합니다.");
    const { user } = await q(admin.auth.admin.createUser({
      email: email.trim().toLowerCase(), password, email_confirm: true,
      user_metadata: { name, must_change_password: true },
    }));
    // 가입 트리거가 만든 profiles 행에 역할을 정한다
    await q(db.from("profiles").update({ name: name || email, role, dealer_id: role === "dealer" ? dealer_id : null }).eq("user_id", user.id));
    return { id: user.id };
  },

  /** 임시 비밀번호로 초기화 → 다음 로그인 때 본인이 바꿔야 한다 */
  async reset({ admin }, { user_id, password }) {
    checkPw(password);
    const { user } = await q(admin.auth.admin.getUserById(user_id));
    await q(admin.auth.admin.updateUserById(user_id, { password, user_metadata: { ...(user.user_metadata || {}), must_change_password: true } }));
    return { ok: true };
  },

  /** 사용 중지 / 다시 사용 (퇴사자) */
  async disable({ admin, uid }, { user_id, on }) {
    if (user_id === uid) throw new Error("본인 계정은 중지할 수 없습니다.");
    await q(admin.auth.admin.updateUserById(user_id, { ban_duration: on ? FOREVER : "none" }));
    return { ok: true };
  },
};

export async function handleAccount(action, args, ctx) {
  const fn = ACCOUNT_ACTIONS[action];
  if (!fn) throw new Error("알 수 없는 작업: " + action);
  if (ctx.role !== "admin") throw new Error("계정 관리는 대표만 할 수 있습니다.");
  return fn(ctx, args || {});
}
