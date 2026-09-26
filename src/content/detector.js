/**
 * 모든 페이지에서 실행되는 경량 감지 스크립트.
 * 채용 솔루션을 판별하면 서비스 워커에 알려 툴바 배지를 표시하고 입력 엔진을 주입받는다.
 * 이 스크립트는 페이지의 입력값을 읽거나 외부로 전송하지 않는다.
 */
(function () {
  'use strict';

  const KApply = globalThis.KApply;
  if (!KApply || KApply.detectorStarted) return;
  KApply.detectorStarted = true;

  const RECHECK_DELAY_MS = 700;
  const IDLE_STOP_MS = 20000;
  let lastSignature = '';
  let timer = null;
  let observer = null;

  function currentStatus() {
    const result = KApply.platforms.detect(document, location);
    return result ? { platform: result.id, name: result.name, formReady: result.formReady } : null;
  }

  function report() {
    timer = null;
    const status = currentStatus();
    const signature = status ? `${status.platform}:${status.formReady}:${location.pathname}` : 'none';
    if (signature === lastSignature) return;
    lastSignature = signature;
    KApply.lastStatus = status;
    if (!status) return;
    try {
      chrome.runtime.sendMessage({ type: 'kapply:detected', status }).catch(() => {});
    } catch (error) {
      // 확장프로그램이 업데이트·재시작되면 컨텍스트가 무효화된다. 이 경우 감시를 멈춘다.
      if (observer) observer.disconnect();
    }
  }

  function schedule() {
    if (timer === null) timer = setTimeout(report, RECHECK_DELAY_MS);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'kapply:status') {
      sendResponse(currentStatus());
    }
    return false;
  });

  report();

  // SPA 화면 전환과 지연 렌더링을 따라가기 위해 DOM 변화를 감시한다.
  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);

  // 채용 사이트가 아닌 페이지에서 불필요한 감시를 계속하지 않도록, 일정 시간 안에 감지되지 않으면 중단한다.
  setTimeout(() => {
    if (!KApply.lastStatus) observer.disconnect();
  }, IDLE_STOP_MS);
})();
