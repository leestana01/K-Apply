/**
 * 페이지(MAIN world)에서 실행되는 파일 첨부 브리지.
 *
 * 1) 파일 선택 가로채기 (arm)
 *    일부 채용 솔루션(나인하이어)은 업로드 버튼을 누를 때 문서에 붙지 않은 임시 input[type=file]을 만들고
 *    input.click()으로 파일 선택창을 연다. 콘텐츠 스크립트는 페이지 쪽 프로토타입을 바꿀 수 없으므로,
 *    이 스크립트가 "다음 한 번의" 파일 선택 요청만 가로채 확장프로그램이 전달한 파일을 넣어 준다.
 *    arm 후 5초 안의 첫 파일 선택 1회에만 동작하고 즉시 원래 동작으로 복구한다.
 *
 * 2) 서버 업로드 검증 (watch)
 *    첨부한 파일이 실제로 서버에 전송됐는지 확인하기 위해 fetch / XMLHttpRequest 요청을 관찰한다.
 *    요청 본문(Blob 또는 FormData 안의 Blob) 중 크기와 SHA-256이 원본과 같은 것이 있고,
 *    응답이 2xx이면 업로드 성공으로 보고한다. 요청을 변경하거나 지연시키지 않으며,
 *    감시 중인 파일이 없을 때는 아무 일도 하지 않는다.
 *
 * 3) 카카오(Daum) 우편번호 위젯 대행 (arm-postcode)
 *    주소 검색 버튼이 new daum.Postcode({ oncomplete })로 위젯을 열 때, 다음 1회에 한해 위젯을 띄우지 않고
 *    사용자가 선택한 것과 같은 형태의 결과(zonecode, roadAddress, jibunAddress …)로 oncomplete를 호출한다.
 *    arm 후 5초가 지나면 원래 위젯으로 복구한다.
 *
 * 4) 외부 인증 창 차단 (arm-popup-guard / release-popup-guard)
 *    일부 항목은 선택하는 순간 외부 인증 창을 연다(예: 마이다스인에서 YBM 연동 기업의 TOEIC 선택 시
 *    window.open + form.submit으로 YBM 로그인 창). 확장프로그램이 항목을 고르는 동안에만
 *    window.open과 새 창을 대상으로 하는 form.submit을 막고, 막은 횟수를 돌려준다.
 *    release 또는 5초 경과 시 원래 동작으로 복구한다.
 *
 * 파일 내용·주소는 사용자가 입력하려는 바로 그 페이지에만 전달된다.
 */
(function () {
  'use strict';

  if (window.__kapplyFileBridge) return;
  window.__kapplyFileBridge = true;

  const SOURCE = 'kapply-bridge';
  const ARM_TIMEOUT_MS = 5000;

  function post(type, token, extra) {
    window.postMessage({ source: SOURCE, type, token, ...extra }, location.origin);
  }

  // ---------------------------------------------------------------------------
  // 1) 파일 선택 가로채기
  // ---------------------------------------------------------------------------

  const originalClick = HTMLInputElement.prototype.click;
  const originalShowPicker = HTMLInputElement.prototype.showPicker;
  let pending = null;
  let armTimer = null;

  function disarm() {
    HTMLInputElement.prototype.click = originalClick;
    if (originalShowPicker) HTMLInputElement.prototype.showPicker = originalShowPicker;
    clearTimeout(armTimer);
    pending = null;
  }

  function deliver(input) {
    const job = pending;
    disarm();
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

  function arm(data) {
    if (!(data.buffer instanceof ArrayBuffer) || typeof data.name !== 'string') return;
    disarm();
    pending = { token: data.token, name: data.name, mime: data.mime, buffer: data.buffer };
    HTMLInputElement.prototype.click = intercept(originalClick);
    if (originalShowPicker) HTMLInputElement.prototype.showPicker = intercept(originalShowPicker);
    armTimer = setTimeout(disarm, ARM_TIMEOUT_MS);
    post('armed', data.token);
  }

  // ---------------------------------------------------------------------------
  // 2) 서버 업로드 검증
  // ---------------------------------------------------------------------------

  /** token → { size, sha256, timer } */
  const watchers = new Map();
  let networkHooked = false;

  async function sha256Hex(blob) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function blobsIn(body) {
    if (body instanceof Blob) return [body];
    if (body instanceof FormData) return [...body.values()].filter((value) => value instanceof Blob);
    return [];
  }

  /**
   * @param {*} body 요청 본문
   * @param {Promise<number>} statusPromise 응답 상태 코드 (네트워크 오류는 0)
   */
  async function inspect(body, statusPromise) {
    const blobs = blobsIn(body);
    if (!blobs.length) return;
    for (const blob of blobs) {
      const candidates = [...watchers.entries()].filter(([, watcher]) => watcher.size === blob.size);
      if (!candidates.length) continue;
      const hash = await sha256Hex(blob);
      const matched = candidates.find(([, watcher]) => watcher.sha256 === hash);
      if (!matched) continue;
      const [token, watcher] = matched;
      watchers.delete(token);
      const status = await statusPromise;
      clearTimeout(watcher.timer);
      post('upload-result', token, { ok: status >= 200 && status < 300, status });
      return;
    }
  }

  function hookNetwork() {
    if (networkHooked) return;
    networkHooked = true;

    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const promise = originalFetch.apply(this, arguments);
      const body = init && init.body;
      if (watchers.size && body) {
        inspect(
          body,
          promise.then(
            (response) => response.status,
            () => 0
          )
        );
      }
      return promise;
    };

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (watchers.size && body) {
        const xhr = this;
        const status = new Promise((resolve) => xhr.addEventListener('loadend', () => resolve(xhr.status), { once: true }));
        inspect(body, status);
      }
      return originalSend.apply(this, arguments);
    };
  }

  function watch(data) {
    if (typeof data.size !== 'number' || typeof data.sha256 !== 'string') return;
    hookNetwork();
    const timer = setTimeout(() => {
      if (!watchers.delete(data.token)) return;
      post('upload-result', data.token, { ok: false, reason: 'timeout' });
    }, Math.max(5000, Number(data.timeoutMs) || 60000));
    watchers.set(data.token, { size: data.size, sha256: data.sha256, timer });
    post('watching', data.token);
  }

  function unwatch(data) {
    const watcher = watchers.get(data.token);
    if (!watcher) return;
    clearTimeout(watcher.timer);
    watchers.delete(data.token);
  }

  // ---------------------------------------------------------------------------
  // 3) 카카오 우편번호 위젯 대행
  // ---------------------------------------------------------------------------

  let postcodeJob = null;
  let postcodeTimer = null;
  let postcodeRestore = null;

  function installPostcodeHook(daum) {
    const Original = daum.Postcode;
    if (!Original || Original.__kapply) return;
    function Replacement(options) {
      if (!postcodeJob) return new Original(options);
      const job = postcodeJob;
      releasePostcode();
      const complete = () => {
        if (options && typeof options.oncomplete === 'function') options.oncomplete(job.result);
        post('postcode-consumed', job.token);
      };
      // 위젯을 띄우지 않고, 호출하는 쪽이 embed/open을 부른 뒤 결과를 전달한다.
      return {
        embed() {
          setTimeout(complete, 0);
        },
        open() {
          setTimeout(complete, 0);
        },
      };
    }
    Replacement.__kapply = true;
    Replacement.prototype = Original.prototype;
    daum.Postcode = Replacement;
    postcodeRestore = () => {
      if (daum.Postcode === Replacement) daum.Postcode = Original;
    };
  }

  function releasePostcode() {
    clearTimeout(postcodeTimer);
    postcodeJob = null;
    if (postcodeRestore) postcodeRestore();
    postcodeRestore = null;
  }

  function armPostcode(data) {
    const result = data.result;
    if (!result || typeof result.zonecode !== 'string') return;
    releasePostcode();
    postcodeJob = { token: data.token, result };
    if (window.daum && window.daum.Postcode) {
      installPostcodeHook(window.daum);
    } else {
      // 우편번호 스크립트가 아직 로드되지 않았다면 로드되는 시점에 가로챈다.
      const timer = setInterval(() => {
        if (!postcodeJob) return clearInterval(timer);
        if (window.daum && window.daum.Postcode) {
          clearInterval(timer);
          installPostcodeHook(window.daum);
        }
      }, 50);
    }
    postcodeTimer = setTimeout(releasePostcode, ARM_TIMEOUT_MS);
    post('postcode-armed', data.token);
  }

  // ---------------------------------------------------------------------------
  // 4) 외부 인증 창 차단
  // ---------------------------------------------------------------------------

  const originalOpen = window.open;
  const originalSubmit = HTMLFormElement.prototype.submit;
  let guard = null;

  function releaseGuard() {
    if (!guard) return;
    const { token, blocked, timer } = guard;
    guard = null;
    clearTimeout(timer);
    window.open = originalOpen;
    HTMLFormElement.prototype.submit = originalSubmit;
    post('popup-guard-result', token, { blocked });
  }

  function armGuard(data) {
    releaseGuard();
    guard = { token: data.token, blocked: 0, timer: setTimeout(releaseGuard, ARM_TIMEOUT_MS) };
    window.open = function () {
      guard.blocked += 1;
      return null;
    };
    HTMLFormElement.prototype.submit = function () {
      const target = this.getAttribute('target');
      if (target && target !== '_self') {
        guard.blocked += 1;
        return undefined;
      }
      return originalSubmit.apply(this, arguments);
    };
    post('popup-guard-armed', data.token);
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== SOURCE) return;
    if (data.type === 'arm') arm(data);
    else if (data.type === 'watch') watch(data);
    else if (data.type === 'unwatch') unwatch(data);
    else if (data.type === 'arm-postcode') armPostcode(data);
    else if (data.type === 'arm-popup-guard') armGuard(data);
    else if (data.type === 'release-popup-guard' && guard && guard.token === data.token) releaseGuard();
  });
})();
