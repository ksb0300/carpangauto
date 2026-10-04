// 데모용 모의 팝빌 — popbill-core 와 같은 함수 모양. 국세청·은행으로는 아무것도 나가지 않는다.
// 통장 거래는 데모 DB 의 매도·매입·정산 기록으로 그럴듯하게 만들어, 자동 매칭을 시험해 볼 수 있게 한다.

const ymd = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
const rnd = n => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");
async function q(p) { const { data, error } = await p; if (error) throw new Error(error.message); return data; }

export function makeDemoPopbill(db) {
  return {
    demo: true,
    async status() { return { member: true, test: true, demo: true, balance: 10000, certExpire: "2027-12-31" }; },
    async joinMember() { return { code: 1, message: "데모: 가입한 것으로 처리" }; },
    async issueCashbill(doc) {
      if (doc.identity?.replace(/\D/g, "") === "0000000000") throw new Error("[팝빌 -14000020] 데모: 식별번호가 올바르지 않습니다");
      return { confirmNum: "D" + rnd(8), tradeDate: ymd(), raw: { demo: true } };
    },
    async cancelCashbill() { return { confirmNum: "D" + rnd(8), tradeDate: ymd(), raw: { demo: true } }; },
    async issueTaxinvoice() { return { ntsConfirmNum: `${ymd()}-41000000-${rnd(8)}`, raw: { demo: true } }; },
    async cancelTaxinvoice() { return { code: 1, message: "데모 발행취소" }; },
    async cashbillInfo() { return { stateCode: 304, stateMemo: "데모: 국세청 전송완료" }; },
    async taxinvoiceInfo() { return { stateCode: 300, stateMemo: "데모: 발행완료" }; },
    async certURL() { throw new Error("데모에서는 팝빌 인증서 등록 화면을 열 수 없습니다."); },
    async bankMgtURL() { throw new Error("데모에서는 팝빌 계좌 등록 화면을 열 수 없습니다."); },
    async senderMgtURL() { throw new Error("데모에서는 발신번호 등록 화면을 열 수 없습니다."); },
    async listBankAccounts() { return [{ bank_code: "0004", account_no: "123401-04-567890", alias: "데모 주거래(국민)" }]; },

    async bankSearch(code, no, from, to) {
      const [sales, buyers, cars, st] = await Promise.all([
        q(db.from("car_sales").select("*").gte("sale_date", from).lte("sale_date", to)),
        q(db.from("car_buyers").select("*")),
        q(db.from("cars").select("*").gte("purchase_date", from).lte("purchase_date", to)),
        q(db.from("settlements").select("*").eq("finalized", true).gte("settle_date", from).lte("settle_date", to)),
      ]);
      const dealers = await q(db.from("dealers").select("id,name"));
      const out = [];
      for (const s of sales) {
        const bs = buyers.filter(b => b.car_id === s.car_id);
        const first = bs[0]?.name || "매수인";
        out.push({ tid: "DS" + s.car_id.slice(0, 8), tx_date: s.sale_date, tx_time: "11:20:00", deposit: Number(s.sale_amount), withdraw: 0, balance: null, remark: `타행이체 / ${first}` });
      }
      for (const c of cars.filter(c => c.consign === "상사매입" && !c.deleted_at))
        out.push({ tid: "DP" + c.id.slice(0, 8), tx_date: c.purchase_date, tx_time: "15:02:00", deposit: 0, withdraw: Number(c.purchase_amount), balance: null, remark: `인터넷뱅킹 / ${c.seller_name || "매도인"}` });
      for (const s of st) {
        const car = (await q(db.from("cars").select("dealer_id").eq("id", s.car_id).maybeSingle()));
        const d = dealers.find(x => x.id === car?.dealer_id);
        out.push({ tid: "DT" + s.car_id.slice(0, 8), tx_date: s.settle_date, tx_time: "17:40:00", deposit: 0, withdraw: Number(s.payout), balance: null, remark: `정산 / ${d?.name || "딜러"}` });
      }
      out.push({ tid: "DX" + from.replace(/-/g, ""), tx_date: from, tx_time: "09:00:00", deposit: 0, withdraw: 33_000, balance: null, remark: "카드대금 / 통신요금" });
      return out.sort((a, b) => (a.tx_date + a.tx_time).localeCompare(b.tx_date + b.tx_time));
    },

    async sendLMS(sender, receiver) {
      if (!String(receiver).replace(/\D/g, "").startsWith("01")) throw new Error("[팝빌 -99999999] 데모: 휴대폰 번호가 아닙니다");
      return "DEMO" + rnd(10);
    },
  };
}
