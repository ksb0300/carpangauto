/* 서류 작성 페이지 공통: 손가락 서명 패드 (비사업용 확인서 · 3일 환불 약정서) */
function SignPad(canvas, onInk) {
  var ctx = canvas.getContext("2d"), drawing = false, ink = false;
  function size() {
    var r = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * r; canvas.height = canvas.offsetHeight * r;
    ctx.scale(r, r); ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#f4f4f6";
  }
  size();
  window.addEventListener("resize", function () {
    var data = ink ? canvas.toDataURL() : null; size();
    if (data) { var img = new Image(); img.onload = function () { ctx.drawImage(img, 0, 0, canvas.offsetWidth, canvas.offsetHeight); }; img.src = data; }
  });
  function pos(e) { var r = canvas.getBoundingClientRect(), p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; }
  function start(e) { e.preventDefault(); drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e) { if (!drawing) return; e.preventDefault(); var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
    if (!ink) { ink = true; onInk && onInk(true); } }
  canvas.addEventListener("mousedown", start); canvas.addEventListener("mousemove", move); window.addEventListener("mouseup", function () { drawing = false; });
  canvas.addEventListener("touchstart", start, { passive: false }); canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", function () { drawing = false; });
  return {
    hasInk: function () { return ink; },
    clear: function () { ctx.clearRect(0, 0, canvas.width, canvas.height); ink = false; onInk && onInk(false); },
    /* 화면은 어두운 패드 위 흰 선, 서류는 흰 종이 → 선만 골라 검정으로 */
    blackPng: function () {
      var c = document.createElement("canvas"); c.width = canvas.width; c.height = canvas.height;
      var x = c.getContext("2d"); x.drawImage(canvas, 0, 0);
      var im = x.getImageData(0, 0, c.width, c.height), px = im.data;
      for (var i = 0; i < px.length; i += 4) if (px[i + 3] > 0) { px[i] = 17; px[i + 1] = 17; px[i + 2] = 17; }
      x.putImageData(im, 0, 0); return c.toDataURL("image/png");
    }
  };
}
/* 숫자 칸: 다 채우면 다음 칸, 빈 칸에서 지우기 누르면 앞 칸. 목록 = [[id, 길이, 다음id, 앞id], ...] */
SignPad.autoNext = function ($, list) {
  list.forEach(function (c) {
    var el = $(c[0]);
    el.addEventListener("input", function () { var v = this.value.replace(/[^0-9]/g, "").slice(0, c[1]); this.value = v; if (v.length >= c[1] && c[2]) $(c[2]).focus(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Backspace" && this.value === "" && c[3]) $(c[3]).focus(); });
  });
};
