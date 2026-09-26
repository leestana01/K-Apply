/**
 * 백그라운드 서비스 워커.
 *  - 감지 스크립트의 보고를 받아 탭별 툴바 배지를 표시하고 입력 엔진을 주입한다.
 *  - 팝업·단축키의 실행 요청을 해당 탭으로 전달한다.
 *  - 나인하이어 파일 첨부용 페이지 브리지를 주입한다.
 */
'use strict';

importScripts('../shared/platforms.js');

const ENGINE_FILES = [
  'src/shared/text.js',
  'src/shared/schema.js',
  'src/shared/storage.js',
  'src/shared/platforms.js',
  'src/shared/matcher.js',
  'src/content/dom.js',
  'src/content/controls.js',
  'src/content/engine.js',
  'src/content/adapters/greeting.js',
  'src/content/adapters/ninehire.js',
  'src/content/adapters/midas.js',
  'src/content/runner.js',
];

const BRIDGE_FILE = 'src/main/file-bridge.js';

async function setBadge(tabId, status) {
  const info = status && self.KApply.platforms.describe(status.platform);
  await chrome.action.setBadgeText({ tabId, text: info ? info.badge : '' });
  if (info) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: info.color });
    await chrome.action.setTitle({ tabId, title: `K-Apply — ${info.name} ${status.formReady ? '지원서 감지됨' : '채용 사이트'}` });
  } else {
    await chrome.action.setTitle({ tabId, title: 'K-Apply' });
  }
}

async function injectEngine(tabId, frameId = 0) {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ENGINE_FILES });
}

async function hasEngine(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'kapply:ping' }, { frameId: 0 });
    return !!(response && response.ok);
  } catch (error) {
    return false;
  }
}

async function ensureEngine(tabId) {
  if (!(await hasEngine(tabId))) await injectEngine(tabId);
}

async function detectInTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'kapply:status' }, { frameId: 0 });
  } catch (error) {
    // 확장프로그램 설치 이전에 열린 탭 등 감지 스크립트가 없는 경우 직접 실행한다.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/shared/platforms.js'] });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const detected = globalThis.KApply.platforms.detect(document, location);
        return detected ? { platform: detected.id, name: detected.name, formReady: detected.formReady } : null;
      },
    });
    return result ? result.result : null;
  }
}

async function runInTab(tabId) {
  const status = await detectInTab(tabId);
  if (!status) return { ok: false, code: 'UNSUPPORTED', message: '그리팅·나인하이어·마이다스인 지원서 화면이 아닙니다.' };
  await ensureEngine(tabId);
  return chrome.tabs.sendMessage(tabId, { type: 'kapply:fill' }, { frameId: 0 });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  switch (message.type) {
    case 'kapply:detected': {
      const tabId = sender.tab && sender.tab.id;
      if (tabId == null || sender.frameId !== 0) return false;
      setBadge(tabId, message.status).catch(() => {});
      ensureEngine(tabId).catch(() => {});
      return false;
    }
    case 'kapply:inject-bridge': {
      const tabId = sender.tab && sender.tab.id;
      chrome.scripting
        .executeScript({ target: { tabId, frameIds: [sender.frameId] }, world: 'MAIN', files: [BRIDGE_FILE] })
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, message: error.message }));
      return true;
    }
    case 'kapply:tab-status': {
      detectInTab(message.tabId)
        .then((status) => sendResponse({ ok: true, status }))
        .catch((error) => sendResponse({ ok: false, message: error.message }));
      return true;
    }
    case 'kapply:run': {
      runInTab(message.tabId)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, code: 'ERROR', message: error.message }));
      return true;
    }
    default:
      return false;
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'fill-current-page' || !tab || tab.id == null) return;
  try {
    await runInTab(tab.id);
  } catch (error) {
    // 단축키 실행 결과는 페이지 토스트로 표시되므로 여기서는 무시한다.
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
