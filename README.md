# carpangauto.com

카팡모터스 고객용 페이지. 지금은 **비사업용 사실확인서** 서명 화면 하나를 서비스한다.

## 왜 이 저장소가 있나

서명 화면 자체는 Google Apps Script 웹앱이다. 그런데 Apps Script 주소로 직접
들어가면 구글이 상단에 "이 애플리케이션은 Google Apps Script 사용자가
만들었습니다 / 악용사례 신고" 배너를 강제로 붙인다. 차를 팔러 온 고객에게는
사기 사이트처럼 보인다.

그래서 이 페이지가 웹앱을 iframe 으로 감싼다. 감싸면 배너가 나오지 않는다.
(Apps Script 쪽은 `setXFrameOptionsMode(ALLOWALL)` 로 열어 두었다.)

## 주소를 바꿀 때

`index.html` 의 `웹앱주소` 한 줄만 고치면 된다.

## 배포

GitHub Pages (main 브랜치 루트) → 커스텀 도메인 carpangauto.com
