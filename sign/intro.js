/* 고객 서류 링크(비사업용 확인서·3일 환불 약정서)로 들어오면 TierONE 시작 화면 + 시그니처 소리 (2026-10-31)
   업무관리 시작 화면과 같은 아이콘·소리. 링크(?t=)로 들어왔을 때만, 이 창에서 한 번만.
   브라우저가 소리를 막으면 조용히 — 시작 화면이 떠 있는 동안 누르면 그때 울린다 */
(function () {
  if (!/[?&]t=/.test(location.search)) return;
  try { if (sessionStorage.getItem("tierone-intro")) return; sessionStorage.setItem("tierone-intro", "1"); } catch (e) {}
  var css = document.createElement("style");
  css.textContent =
    ".t1-intro{position:fixed;inset:0;z-index:9999;background:#050508;display:flex;align-items:center;justify-content:center;animation:t1-out .5s ease 2.3s forwards;cursor:pointer}" +
    ".t1-intro img{width:min(46vw,230px);animation:t1-in 1.4s cubic-bezier(.2,.8,.2,1) both,t1-glow 1.6s ease .6s both}" +
    "@keyframes t1-in{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:none}}" +
    "@keyframes t1-glow{0%{filter:drop-shadow(0 0 0 rgba(139,47,255,0))}45%{filter:drop-shadow(0 0 42px rgba(139,47,255,.75))}100%{filter:drop-shadow(0 0 18px rgba(139,47,255,.35))}}" +
    "@keyframes t1-out{to{opacity:0;visibility:hidden}}";
  document.head.appendChild(css);
  var el = document.createElement("div");
  el.className = "t1-intro";
  el.innerHTML = '<img src="/assets/tierone-icon-512.png" alt="TierONE">';
  function 닫기() { if (el.parentNode) el.parentNode.removeChild(el); }
  el.addEventListener("click", 닫기);
  (document.body || document.documentElement).appendChild(el);
  setTimeout(닫기, 2800);
  function 소리() { var a = new Audio("/assets/tierone-intro.wav"); a.volume = 0.85; return a.play(); }
  try {
    소리().catch(function () {
      addEventListener("pointerdown", function () { if (el.parentNode) 소리().catch(function () {}); }, { once: true });
    });
  } catch (e) {}
})();
