/**
 * 페이지(MAIN world)에서 실행되는 파일 첨부 브리지.
 *
 * 일부 채용 솔루션(나인하이어)은 업로드 버튼을 누를 때 문서에 붙지 않은 임시 input[type=file]을 만들고
 * input.click()으로 파일 선택창을 연다. 콘텐츠 스크립트는 페이지 쪽 프로토타입을 바꿀 수 없으므로,
 * 이 스크립트가 "다음 한 번의" 파일 선택 요청만 가로채 확장프로그램이 전달한 파일을 넣어 준다.
 *
 * - arm 메시지를 받은 뒤 5초 안에 발생한 첫 파일 선택 1회에만 동작하고 즉시 원래 동작으로 복구한다.
 * - 파일 내용은 사용자가 업로드하려는 바로 그 페이지에만 전달된다.
 */
(function () {
  'use strict';

  if (window.__kapplyFileBridge) return;
  window.__kapplyFileBridge = true;

  const SOURCE = 'kapply-bridge';
  const ARM_TIMEOUT_MS = 5000;
  const originalClick = HTMLInputElement.prototype.click;
  const originalShowPicker = HTMLInputElement.prototype.showPicker;
  let pending = null;
  let timer = null;

  function post(type, token) {
    window.postMessage({ source: SOURCE, type, token }, location.origin);
  }

  function restore() {
    HTMLInputElement.prototype.click = originalClick;
    if (originalShowPicker) HTMLInputElement.prototype.showPicker = originalShowPicker;
    clearTimeout(timer);
    pending = null;
  }

  function deliver(input) {
    const job = pending;
    restore();
    setTimeout(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([job.buffer], job.name, { type: job.mime || 'application/octet-stream' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      post('consumed', job.token);
    }, 0);
  }

  function intercept(original) {
    return function (...args) {
      if (pending && this.type === 'file') {
        deliver(this);
        return undefined;
      }
      return original.apply(this, args);
    };
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== SOURCE || data.type !== 'arm') return;
    if (!(data.buffer instanceof ArrayBuffer) || typeof data.name !== 'string') return;
    restore();
    pending = { token: data.token, name: data.name, mime: data.mime, buffer: data.buffer };
    HTMLInputElement.prototype.click = intercept(originalClick);
    if (originalShowPicker) HTMLInputElement.prototype.showPicker = intercept(originalShowPicker);
    timer = setTimeout(restore, ARM_TIMEOUT_MS);
    post('armed', data.token);
  });
})();
