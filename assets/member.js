/* 로그인한 직원·딜러에게만 매물 카드에 내부 정보를 덧붙인다.
   - 손님(로그인 안 함): 아무것도 하지 않는다. 추가 코드도 내려받지 않는다.
   - 업무관리(/office)에서 로그인하면 같은 주소라 로그인 상태가 여기로 이어진다.
   - 정보는 업무관리 서버(Supabase)가 등급을 확인해 돌려준다. 딜러는 본인 차량만, 직원·대표는 전부.
     공개 매물 파일(data/cars.json)에는 내부 정보가 들어가지 않는다. */
(function () {
  var SUPABASE_URL = "https://fwqtyyjhfewpxihpaasu.supabase.co";
  var PUBLIC_KEY = "sb_publishable_op7s3siOFMjUk99QfFbVZw_mmRBmZl1";   // 공개용 키 (보호는 서버 권한 규칙이 한다)
  var TOKEN_KEY = "sb-fwqtyyjhfewpxihpaasu-auth-token";
  var HIDE_KEY = "tierone-hide-internal";
  var ROLE = { admin: "대표", staff: "직원", dealer: "딜러" };

  var hasToken = false;
  try { hasToken = !!localStorage.getItem(TOKEN_KEY); } catch (e) {}
  if (!hasToken) return;

  var won = function (n) { return Math.round(Number(n) || 0).toLocaleString("ko-KR"); };
  var man = function (n) { return (Math.round((Number(n) || 0) / 10000)).toLocaleString("ko-KR") + "만"; };
  var norm = function (p) { return String(p || "").replace(/\s/g, ""); };
  var days = function (d) { return Math.max(0, Math.round((Date.now() - Date.parse(d + "T00:00:00+09:00")) / 864e5)); };

  import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm").then(async function (m) {
    var db = m.createClient(SUPABASE_URL, PUBLIC_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    var s = (await db.auth.getSession()).data.session;
    if (!s) return;
    var prof = (await db.from("profiles").select("name,role,dealer_id").eq("user_id", s.user.id).maybeSingle()).data;
    if (!prof) return;
    var office = prof.role !== "dealer";

    var res = await Promise.all([
      db.from("cars").select("id,plate,plate_before,purchase_amount,purchase_date,dealer_id,status").is("deleted_at", null),
      db.from("car_costs").select("car_id,amount"),
      db.from("car_loans").select("car_id,amount,status"),
      db.from("dealers").select("id,name"),
    ]);
    var cars = res[0].data || [], costs = res[1].data || [], loans = res[2].data || [], dealers = res[3].data || [];
    var byPlate = {};
    cars.forEach(function (c) { byPlate[norm(c.plate)] = c; if (c.plate_before) byPlate[norm(c.plate_before)] = byPlate[norm(c.plate_before)] || c; });
    var cost = {}, loan = {};
    costs.forEach(function (k) { cost[k.car_id] = (cost[k.car_id] || 0) + Number(k.amount); });
    loans.forEach(function (l) { if (l.status === "진행중") loan[l.car_id] = (loan[l.car_id] || 0) + Number(l.amount); });
    var dealerName = {};
    dealers.forEach(function (d) { dealerName[d.id] = d.name; });

    var hidden = false;
    try { hidden = localStorage.getItem(HIDE_KEY) === "1"; } catch (e) {}

    /* 상단 띠: 이름·등급, 내부 정보 보기/숨기기, 업무관리, 로그아웃 */
    var bar = document.createElement("div");
    bar.className = "mbar";
    document.body.insertBefore(bar, document.body.children[1] || null);
    function drawBar() {
      bar.innerHTML = '<div class="mbar-in"><span><b>' + prof.name + "</b> · " + ROLE[prof.role] + "</span>" +
        '<button type="button" class="mbar-t">' + (hidden ? "내부 정보 보기" : "내부 정보 숨기기 (손님용 화면)") + "</button>" +
        '<span class="grow"></span><a href="/office/">업무관리 →</a><button type="button" class="mbar-o">로그아웃</button></div>';
      bar.querySelector(".mbar-t").onclick = function () {
        hidden = !hidden;
        try { localStorage.setItem(HIDE_KEY, hidden ? "1" : "0"); } catch (e) {}
        document.documentElement.classList.toggle("int-hide", hidden); drawBar();
      };
      bar.querySelector(".mbar-o").onclick = async function () { await db.auth.signOut(); location.reload(); };
    }
    document.documentElement.classList.toggle("int-hide", hidden);
    drawBar();

    /* 매물 카드에 내부 정보 */
    function decorate(card) {
      if (card.dataset.int) return;
      card.dataset.int = "1";
      var c = byPlate[norm(card.dataset.plate)];
      var box = document.createElement("div");
      box.className = "car-int";
      if (!c) {
        if (office) { box.innerHTML = '<span class="dim">업무관리에 없는 차량</span>'; card.querySelector(".car-b").appendChild(box); }
        return;                                   // 딜러에게는 남의 차라 아무것도 안 붙인다
      }
      var price = Number(card.dataset.price) * 10000;
      var k = cost[c.id] || 0, margin = price - Number(c.purchase_amount) - k;
      box.innerHTML =
        "<div><span>매입</span><b>" + man(c.purchase_amount) + "</b></div>" +
        "<div><span>재고</span><b>" + days(c.purchase_date) + "일</b></div>" +
        "<div><span>상품화</span><b>" + man(k) + "</b></div>" +
        "<div><span>예상마진</span><b class=" + (margin < 0 ? "neg" : "pos") + ">" + man(margin) + "</b></div>" +
        (loan[c.id] ? "<div><span>재고금융</span><b>" + man(loan[c.id]) + "</b></div>" : "") +
        (office ? "<div><span>딜러</span><b>" + (dealerName[c.dealer_id] || "-") + "</b></div>" : "") +
        '<span class="int-go" role="link" tabindex="0">업무관리에서 보기 →</span>';
      box.querySelector(".int-go").addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation(); location.href = "/office/#/car/" + c.id;
      });
      card.querySelector(".car-b").appendChild(box);
    }
    function decorateAll() { document.querySelectorAll(".car[data-plate]").forEach(decorate); }
    decorateAll();
    new MutationObserver(decorateAll).observe(document.body, { childList: true, subtree: true });

    /* 대표: 판매 차량 화면 맨 위에 재고 통계 */
    var grid = document.getElementById("grid");
    if (prof.role === "admin" && grid) {
      var stock = cars.filter(function (c) { return c.status === "재고"; });
      var sum = stock.reduce(function (t, c) { return t + Number(c.purchase_amount); }, 0);
      var avg = stock.length ? Math.round(stock.reduce(function (t, c) { return t + days(c.purchase_date); }, 0) / stock.length) : 0;
      var long = stock.filter(function (c) { return days(c.purchase_date) >= 90; }).length;
      var lsum = Object.keys(loan).reduce(function (t, id) { return t + loan[id]; }, 0);
      var st = document.createElement("div");
      st.className = "int-stats car-int";
      st.innerHTML = "<div><span>재고</span><b>" + stock.length + "대</b></div><div><span>매입가 합</span><b>" + won(sum) + "</b></div>" +
        "<div><span>평균 재고일수</span><b>" + avg + "일</b></div><div><span>90일 넘은 재고</span><b>" + long + "대</b></div>" +
        "<div><span>재고금융</span><b>" + won(lsum) + "</b></div>";
      grid.parentNode.insertBefore(st, grid);
    }
  }).catch(function (e) { console.warn("내부 정보 불러오기 실패", e); });
})();
