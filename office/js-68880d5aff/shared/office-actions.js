// 팝빌이 필요한 작업의 처리 순서 — 서버 함수(Edge Function)와 브라우저 데모가 같은 코드를 쓴다.
//   ctx.db  supabase-js 모양 클라이언트 (서버: 호출한 사용자 JWT 로 만든 것 → RLS·변경이력 그대로)
//   ctx.pb  popbill-core 의 makePopbill() 결과 (데모: 모의 객체)
//   ctx.settings  settings 행 (상사정보)
// 돌려주는 값은 화면에 그대로 쓰는 일반 객체. 실패는 throw.

async function q(p) { const { data, error } = await p; if (error) throw new Error(error.message); return data; }
const rand4 = () => Math.random().toString(16).slice(2, 6).padEnd(4, "0");

async function loadDoc(db, id) {
  const d = await q(db.from("issue_docs").select("*").eq("id", id).single());
  if (d.car_id) {
    const c = await q(db.from("cars").select("plate").eq("id", d.car_id).maybeSingle());
    d.car_plate = c?.plate;
  }
  return d;
}

export const ACTIONS = {
  async status({ pb }) { return pb.status(); },

  async "member.join"({ pb, role }, a) {
    if (role !== "admin") throw new Error("연동회원 가입은 대표만 할 수 있습니다.");
    return pb.joinMember(a.form);
  },

  /** 발행대기(또는 실패) 문서를 팝빌로 즉시발행 */
  async "doc.issue"({ db, pb, settings }, { id }) {
    const d = await loadDoc(db, id);
    if (!["대기", "실패"].includes(d.status)) throw new Error(`이미 ${d.status} 상태입니다.`);
    if (d.doc_type === "현금영수증" && !d.identity) throw new Error("현금영수증 식별번호(휴대폰·사업자번호)가 없습니다.");
    if (d.doc_type === "세금계산서" && !d.biz_no) throw new Error("세금계산서 공급받는자 사업자번호가 없습니다.");
    try {
      const r = d.doc_type === "현금영수증" ? await pb.issueCashbill(d, settings) : await pb.issueTaxinvoice(d, settings);
      return await q(db.from("issue_docs").update({
        status: "발행", issued_via: pb.demo ? "데모" : "팝빌", confirm_num: r.confirmNum || r.ntsConfirmNum,
        result: r.raw || r, error: null,
      }).eq("id", id).select("*").single());
    } catch (e) {
      // 같은 문서번호로 재시도하면 팝빌이 중복으로 막을 수 있어 꼬리를 바꿔 둔다
      await q(db.from("issue_docs").update({ status: "실패", error: e.message, mgt_key: d.mgt_key.slice(0, 16) + rand4() }).eq("id", id));
      throw e;
    }
  },

  /** 팝빌로 발행한 문서 취소. 현금영수증은 취소거래 발행, 세금계산서는 국세청 전송 전 발행취소. */
  async "doc.cancel"({ db, pb }, { id, reason }) {
    const d = await loadDoc(db, id);
    if (d.status !== "발행") throw new Error("발행된 문서만 취소할 수 있습니다.");
    if (d.issued_via === "수기") throw new Error("홈택스에서 직접 발행한 문서는 홈택스에서 취소한 뒤 '취소로 표시'를 누르세요.");
    d.cancel_reason = reason || "";
    if (d.doc_type === "현금영수증") {
      const key = d.mgt_key.slice(0, 20) + "-C";
      const r = await pb.cancelCashbill(d, key);
      return q(db.from("issue_docs").update({ status: "취소", cancel_mgt_key: key, cancel_confirm_num: r.confirmNum,
        memo: [d.memo, reason && "취소사유: " + reason].filter(Boolean).join(" / ") || null }).eq("id", id).select("*").single());
    }
    await pb.cancelTaxinvoice(d);
    return q(db.from("issue_docs").update({ status: "취소", memo: [d.memo, reason && "취소사유: " + reason].filter(Boolean).join(" / ") || null })
      .eq("id", id).select("*").single());
  },

  async "doc.refresh"({ db, pb }, { id }) {
    const d = await loadDoc(db, id);
    const info = d.doc_type === "현금영수증" ? await pb.cashbillInfo(d.mgt_key) : await pb.taxinvoiceInfo(d.mgt_key);
    await q(db.from("issue_docs").update({ result: { ...(d.result || {}), info } }).eq("id", id));
    return info;
  },

  async "url.cert"({ pb }) { return { url: await pb.certURL() }; },
  async "url.bank"({ pb }) { return { url: await pb.bankMgtURL() }; },
  async "url.sender"({ pb }) { return { url: await pb.senderMgtURL() }; },

  /** 팝빌에 등록된 계좌를 우리 계좌 목록으로 가져온다 */
  async "bank.accounts"({ db, pb }) {
    const list = await pb.listBankAccounts();
    const mine = await q(db.from("bank_accounts").select("*"));
    let added = 0;
    for (const a of list) {
      const hit = mine.find(m => m.account_no.replace(/\D/g, "") === a.account_no.replace(/\D/g, ""));
      if (hit) await q(db.from("bank_accounts").update({ popbill: true, bank_code: a.bank_code }).eq("id", hit.id));
      else { await q(db.from("bank_accounts").insert({ bank_code: a.bank_code, bank_name: BANKS[a.bank_code] || a.bank_code,
        account_no: a.account_no, alias: a.alias, popbill: true })); added++; }
    }
    return { total: list.length, added };
  },

  /** 계좌 거래내역 불러오기 (이미 있는 거래는 건너뜀) */
  async "bank.sync"({ db, pb }, { account_id, from, to }) {
    const acc = await q(db.from("bank_accounts").select("*").eq("id", account_id).single());
    if (!acc.popbill || !acc.bank_code) throw new Error("팝빌에 등록된 계좌가 아닙니다. 설정 → 팝빌에서 계좌를 등록하거나 엑셀로 올리세요.");
    const txs = await pb.bankSearch(acc.bank_code, acc.account_no, from, to);
    const have = new Set((await q(db.from("bank_txs").select("tid").eq("account_id", account_id))).map(t => t.tid));
    const rows = txs.filter(t => !have.has(t.tid)).map(t => ({ ...t, account_id, source: pb.demo ? "데모" : "팝빌" }));
    for (let i = 0; i < rows.length; i += 500) await q(db.from("bank_txs").insert(rows.slice(i, i + 500)));
    await q(db.from("bank_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", account_id));
    return { fetched: txs.length, added: rows.length };
  },

  /** 장문 문자 보내기 + 기록 */
  async "sms.send"({ db, pb, settings }, { to, name, subject, body, car_id }) {
    if (!settings.sms_sender) throw new Error("설정 → 상사정보에 문자 발신번호를 먼저 입력하세요 (팝빌에 등록된 번호).");
    if (!String(to || "").replace(/\D/g, "")) throw new Error("받는 사람 휴대폰 번호가 없습니다.");
    let receipt, ok = true;
    try { receipt = await pb.sendLMS(settings.sms_sender, to, name, subject, body); }
    catch (e) { receipt = e.message; ok = false; }
    await q(db.from("sent_messages").insert({ to_phone: to, to_name: name, subject, body, car_id: car_id || null, result: String(receipt), ok }));
    if (!ok) throw new Error(receipt);
    return { receipt };
  },
};

export async function handle(action, args, ctx) {
  const fn = ACTIONS[action];
  if (!fn) throw new Error("알 수 없는 작업: " + action);
  if (!["admin", "staff"].includes(ctx.role)) throw new Error("권한이 없습니다.");
  return fn(ctx, args || {});
}

// 팝빌 계좌조회 기관코드
export const BANKS = {
  "0002": "산업은행", "0003": "기업은행", "0004": "국민은행", "0007": "수협은행", "0011": "농협은행", "0012": "지역농축협",
  "0020": "우리은행", "0023": "SC제일은행", "0027": "씨티은행", "0031": "대구은행", "0032": "부산은행", "0034": "광주은행",
  "0035": "제주은행", "0037": "전북은행", "0039": "경남은행", "0045": "새마을금고", "0048": "신협", "0071": "우체국",
  "0081": "하나은행", "0088": "신한은행", "0089": "케이뱅크", "0090": "카카오뱅크", "0092": "토스뱅크",
};
