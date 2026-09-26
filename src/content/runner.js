/**
 * 입력 엔진의 진입점.
 *  - 팝업·단축키가 보내는 kapply:fill 메시지를 처리한다.
 *  - 지원서 화면에서는 플로팅 버튼을 띄워 클릭 한 번으로 실행할 수 있게 한다.
 *  - 실행 결과를 페이지 안 토스트로 알려 준다.
 * 자동 입력은 항상 사용자의 명시적인 동작으로만 시작하며, 제출 버튼은 누르지 않는다.
 */
(function () {
  'use strict';

  const KApply = globalThis.KApply;
  if (KApply.runnerStarted) return;
  KApply.runnerStarted = true;

  const { engine, storage, platforms } = KApply;
  const HOST_ID = 'kapply-launcher-host';
  let busy = false;

  async function execute() {
    if (busy) return { ok: false, code: 'BUSY', message: '이미 입력 중입니다.' };
    busy = true;
    setLauncherBusy(true);
    try {
      const result = await engine.run();
      showToast(result);
      return result;
    } catch (error) {
      const result = { ok: false, code: 'ERROR', message: error && error.message ? error.message : String(error) };
      showToast(result);
      return result;
    } finally {
      busy = false;
      setLauncherBusy(false);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    if (message.type === 'kapply:ping') {
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'kapply:fill') {
      execute().then(sendResponse);
      return true;
    }
    return false;
  });

  // ---------------------------------------------------------------------------
  // 페이지 UI (Shadow DOM으로 페이지 스타일과 격리)
  // ---------------------------------------------------------------------------

  const STYLE = `
    :host { all: initial; }
    .wrap { position: fixed; right: 20px; bottom: 96px; z-index: 2147483646; display: flex; flex-direction: column;
      align-items: flex-end; gap: 10px; font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
      "Pretendard", "Malgun Gothic", sans-serif; }
    button.launch { display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 11px 16px;
      background: #111827; color: #fff; font: 600 13px/1 inherit; cursor: pointer; box-shadow: 0 8px 24px rgba(17,24,39,.25);
      transition: transform .15s ease, opacity .15s ease; }
    button.launch:hover { transform: translateY(-1px); }
    button.launch:disabled { opacity: .6; cursor: progress; }
    button.launch .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent, #22c55e); }
    button.hide { border: 0; background: transparent; color: #6b7280; font: 500 11px/1 inherit; cursor: pointer; padding: 2px 4px; }
    .toast { width: 320px; max-height: 60vh; overflow: auto; background: #fff; color: #111827; border-radius: 14px;
      box-shadow: 0 16px 40px rgba(17,24,39,.22); padding: 14px 16px; font-size: 13px; line-height: 1.5; }
    .toast h2 { margin: 0 0 6px; font-size: 14px; }
    .toast .counts { display: flex; gap: 10px; margin: 6px 0 8px; font-weight: 600; }
    .toast .ok { color: #15803d; } .toast .warn { color: #b45309; } .toast .err { color: #b91c1c; }
    .toast ul { margin: 6px 0 0; padding-left: 18px; }
    .toast li { margin: 2px 0; }
    .toast .close { float: right; border: 0; background: transparent; font-size: 16px; cursor: pointer; color: #6b7280; }
    @media (prefers-color-scheme: dark) {
      .toast { background: #1f2937; color: #f9fafb; }
      .toast .ok { color: #4ade80; } .toast .warn { color: #fbbf24; } .toast .err { color: #f87171; }
    }
  `;

  let shadow = null;
  let launcher = null;
  let toast = null;
  let toastTimer = null;

  function ensureHost() {
    if (shadow && document.getElementById(HOST_ID)) return shadow;
    const host = document.createElement('div');
    host.id = HOST_ID;
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    shadow.append(style, wrap);
    return shadow;
  }

  function wrapElement() {
    return ensureHost().querySelector('.wrap');
  }

  function setLauncherBusy(isBusy) {
    if (!launcher) return;
    const button = launcher.querySelector('button.launch');
    button.disabled = isBusy;
    button.lastChild.textContent = isBusy ? '입력하는 중…' : `K-Apply로 채우기`;
  }

  function renderLauncher(status) {
    if (launcher) {
      launcher.style.setProperty('--accent', platforms.describe(status.platform).color);
      return;
    }
    launcher = document.createElement('div');
    launcher.style.display = 'flex';
    launcher.style.flexDirection = 'column';
    launcher.style.alignItems = 'flex-end';
    launcher.style.setProperty('--accent', platforms.describe(status.platform).color);

    const button = document.createElement('button');
    button.className = 'launch';
    button.type = 'button';
    button.title = `${status.name} 지원서를 저장된 프로필로 채웁니다 (Alt+Shift+F)`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    button.append(dot, document.createTextNode('K-Apply로 채우기'));
    button.addEventListener('click', () => execute());

    const hide = document.createElement('button');
    hide.className = 'hide';
    hide.type = 'button';
    hide.textContent = '이 화면에서 숨기기';
    hide.addEventListener('click', () => {
      removeLauncher();
      hiddenForPage = location.pathname;
    });

    launcher.append(button, hide);
    wrapElement().appendChild(launcher);
  }

  function removeLauncher() {
    if (launcher) launcher.remove();
    launcher = null;
  }

  function el(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent != null) node.textContent = textContent;
    return node;
  }

  function showToast(result) {
    if (toast) toast.remove();
    clearTimeout(toastTimer);
    toast = el('div', 'toast');
    toast.setAttribute('role', 'status');
    const close = el('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '닫기');
    close.addEventListener('click', () => toast && toast.remove());
    toast.appendChild(close);

    if (!result.ok) {
      toast.append(el('h2', null, 'K-Apply'), el('div', 'err', result.message || '입력하지 못했습니다.'));
    } else {
      const { counts, entries, notices } = result.report;
      toast.appendChild(el('h2', null, `${result.platformName} 자동 입력 완료`));
      const summary = el('div', 'counts');
      summary.append(el('span', 'ok', `입력 ${counts.filled}`), el('span', 'warn', `확인 필요 ${counts.failed + counts.manual}`), el('span', null, `건너뜀 ${counts.skipped}`));
      toast.appendChild(summary);
      const attention = entries.filter((entry) => entry.status === 'failed' || entry.status === 'manual');
      if (attention.length || notices.length) {
        const list = el('ul');
        attention.slice(0, 12).forEach((entry) => list.appendChild(el('li', 'warn', `${entry.label}${entry.detail ? ` — ${entry.detail}` : ''}`)));
        notices.forEach((notice) => list.appendChild(el('li', null, notice)));
        toast.appendChild(list);
      }
    }
    wrapElement().prepend(toast);
    toastTimer = setTimeout(() => toast && toast.remove(), result.ok && result.report.counts.failed === 0 ? 9000 : 20000);
  }

  // ---------------------------------------------------------------------------
  // 플로팅 버튼 표시 여부 갱신
  // ---------------------------------------------------------------------------

  let hiddenForPage = null;
  let showLauncher = true;
  let refreshTimer = null;

  function refresh() {
    refreshTimer = null;
    const detected = platforms.detect(document, location);
    const eligible = detected && detected.formReady && showLauncher && hiddenForPage !== location.pathname;
    if (eligible) renderLauncher({ platform: detected.id, name: detected.name });
    else removeLauncher();
  }

  function scheduleRefresh() {
    if (refreshTimer === null) refreshTimer = setTimeout(refresh, 800);
  }

  storage.loadSettings().then((settings) => {
    showLauncher = settings.showLauncher;
    refresh();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[storage.KEYS.settings]) return;
    const next = changes[storage.KEYS.settings].newValue || {};
    showLauncher = next.showLauncher !== false;
    refresh();
  });

  new MutationObserver((mutations) => {
    // 우리 UI 변화로 인한 재평가는 무시한다.
    if (mutations.every((mutation) => mutation.target.id === HOST_ID)) return;
    scheduleRefresh();
  }).observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
