/* 헤더·푸터는 페이지마다 같다. 한 곳에서 만들어 끼운다.
   (정적 사이트라 서버 템플릿이 없다.) */
var 매장 = {
  이름: "카팡모터스",
  영문: "CARPANG",
  주소: "부산광역시 기장군 장안읍 반룡산단3로 95 경동오토필드 604, 605호",
  대표: "김상혁",
  전화: "051-711-7818",     // 매장 대표번호
  휴대폰: "010-7683-5388",   // 상담 휴대폰
  영업: "매일 09:00 – 19:00"
};

var 메뉴 = [
  ["/",         "홈",        ""],
  ["/cars/",    "판매 차량", ""],
  ["/sell/",    "내 차 팔기", ""],
  ["/sign/",    "서류 작성", "hide-m"],
  ["/contact/", "오시는 길", ""]
];

function 전화링크(번호) {
  return '<a href="tel:' + 번호.replace(/[^0-9]/g, "") + '">' + 번호 + "</a>";
}

(function () {
  var here = location.pathname.replace(/index\.html$/, "");
  if (here.length > 1 && !here.endsWith("/")) here += "/";

  var nav = 메뉴.map(function (m) {
    var cls = [m[0] === here ? "on" : "", m[2]].filter(Boolean).join(" ");
    return '<a href="' + m[0] + '"' + (cls ? ' class="' + cls + '"' : "") + ">" + m[1] + "</a>";
  }).join("");

  document.body.insertAdjacentHTML("afterbegin",
    '<header class="hd"><div class="hd-in">' +
    '<a href="/" class="logo"><img src="/assets/logo.svg?v=ac6e2cbc" alt="' + 매장.영문 + '"></a>' +
    '<a class="tel btn-tel" href="tel:' + 매장.전화.replace(/[^0-9]/g, "") + '">전화 문의</a>' +
    '<nav class="nav">' + nav + "</nav>" +
    "</div></header>");

  document.body.insertAdjacentHTML("beforeend",
    '<footer class="ft"><div class="wrap"><div class="ft-top">' +
    '<div class="col"><img src="/assets/logo.svg?v=ac6e2cbc" alt="' + 매장.영문 + '">' +
    "<p style='margin:0 0 4px'>" + 매장.주소 + "</p>" +
    "<p style='margin:0'>" + 매장.영업 + "</p></div>" +
    '<div class="col"><b>CONTACT</b>' +
    "<p style='margin:0 0 4px'>매장 " + 전화링크(매장.전화) + "</p>" +
    "<p style='margin:0'>상담 " + 전화링크(매장.휴대폰) + "</p></div>" +
    '<div class="col"><b>MENU</b>' +
    메뉴.map(function (m) { return "<p style='margin:0 0 4px'><a href='" + m[0] + "'>" + m[1] + "</a></p>"; }).join("") +
    "</div></div>" +
    '<div class="ft-r">' + 매장.이름 + " · 대표 " + 매장.대표 +
    " · 차량 정보는 엔카 등록 정보를 따릅니다" +
    "<br>© " + new Date().getFullYear() + " " + 매장.영문 + "</div>" +
    "</div></footer>");

  /* 스크롤하며 나타나는 요소 */
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    document.querySelectorAll(".rv").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll(".rv").forEach(function (el) { el.classList.add("in"); });
  }
})();

/* 매물 카드 — 홈과 판매차량 페이지가 같이 쓴다 */
function 매물카드(c) {
  return '<a class="car" href="' + c.link + '" target="_blank" rel="noopener">' +
    '<div class="car-img">' +
      (c.photos[0] ? '<img loading="lazy" src="' + c.photos[0] + '" alt="">' : "") +
      (c.diagnosis ? '<span class="badge">엔카진단</span>' : "") +
    '</div><div class="car-b">' +
      '<p class="car-n">' + c.maker + " " + c.model + "</p>" +
      '<p class="car-g">' + (c.grade || "&nbsp;") + "</p>" +
      '<p class="car-m">' + c.year + " · " + c.mileage.toLocaleString() + "km · " +
        c.fuel + (c.transmission ? " · " + c.transmission : "") + "</p>" +
      '<p class="car-p">' + c.price.toLocaleString() + "<span>만원</span></p>" +
    "</div></a>";
}
