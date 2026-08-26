/* 헤더·푸터는 페이지마다 같다. 한 곳에서 만들어 끼운다.
   (정적 사이트라 서버 템플릿이 없다.) */
var 매장 = {
  이름: "카팡모터스",
  주소: "부산광역시 금정구 반송로 425, 3층 311호",
  대표: "김상혁",
  전화: "",              // ← 매장 대표번호를 넣으면 화면 곳곳에 반영된다
  영업: "매일 09:00 – 19:00"
};

var 메뉴 = [
  ["/",         "홈"],
  ["/cars/",    "판매 차량"],
  ["/sell/",    "내 차 팔기"],
  ["/sign/",    "서류 작성"],
  ["/contact/", "오시는 길"]
];

(function () {
  var here = location.pathname.replace(/index\.html$/, "");
  if (here.length > 1 && !here.endsWith("/")) here += "/";

  var nav = 메뉴.map(function (m) {
    return '<a href="' + m[0] + '"' + (m[0] === here ? ' class="on"' : "") +
           ">" + m[1] + "</a>";
  }).join("");

  document.body.insertAdjacentHTML("afterbegin",
    '<header class="hd"><div class="hd-in">' +
    '<a href="/" class="logo">카팡<em>모터스</em></a>' +
    '<nav class="nav">' + nav + "</nav>" +
    "</div></header>");

  var 전화줄 = 매장.전화
    ? '<p style="margin:0 0 4px">전화 <a href="tel:' +
      매장.전화.replace(/[^0-9]/g, "") + '">' + 매장.전화 + "</a></p>"
    : "";

  document.body.insertAdjacentHTML("beforeend",
    '<footer class="ft"><div class="wrap">' +
    '<p class="ft-t">' + 매장.이름 + "</p>" +
    "<p style='margin:0 0 4px'>" + 매장.주소 + "</p>" +
    전화줄 +
    "<p style='margin:0'>" + 매장.영업 + "</p>" +
    '<div class="ft-r">대표 ' + 매장.대표 +
    " · 본 사이트의 차량 정보는 엔카 등록 정보를 따릅니다." +
    "<br>© " + new Date().getFullYear() + " " + 매장.이름 + "</div>" +
    "</div></footer>");
})();
