(function () {
  'use strict';

  const { storage, schema, platforms } = globalThis.KApply;

  const $ = (id) => document.getElementById(id);
  const fillButton = $('fill');
  let activeTabId = null;

  function el(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent != null) node.textContent = textContent;
    return node;
  }

  function setStatus({ title, desc, color, enabled }) {
    $('status-title').textContent = title;
    $('status-desc').textContent = desc || '';
    $('status-dot').style.background = color || 'var(--border)';
    fillButton.disabled = !enabled;
  }

  async function renderShortcut() {
    const commands = await chrome.commands.getAll();
    const command = commands.find((item) => item.name === 'fill-current-page');
    $('shortcut').textContent = command && command.shortcut ? command.shortcut : '미지정';
  }

  async function renderProfile() {
    const [profile, fileMeta] = await Promise.all([storage.loadProfile(), storage.loadFileMeta()]);
    const container = $('profile-summary');
    container.replaceChildren();
    if (schema.isProfileEmpty(profile) && Object.keys(fileMeta).length === 0) {
      container.append(el('div', 'name', '저장된 프로필이 없습니다'), el('div', 'muted', '프로필 편집에서 기본 정보를 먼저 입력해 주세요.'));
      return false;
    }
    const name = profile.basic.name || '이름 미입력';
    container.appendChild(el('div', 'name', `${name}${profile.basic.email ? ` · ${profile.basic.email}` : ''}`));
    const stats = [
      ['학력', profile.educations.length],
      ['경력', profile.careers.length],
      ['프로젝트', profile.projects.length],
      ['활동', profile.activities.length + profile.trainings.length],
      ['어학·자격', profile.languages.length + profile.certificates.length],
      ['첨부 파일', Object.keys(fileMeta).length],
    ];
    const list = el('dl');
    stats.forEach(([label, count]) => {
      const item = el('div');
      item.append(el('dt', null, label), el('dd', null, String(count)));
      list.appendChild(item);
    });
    container.appendChild(list);
    return true;
  }

  function renderResult(result) {
    const box = $('result');
    box.hidden = false;
    box.replaceChildren();
    if (!result || !result.ok) {
      box.append(el('h2', null, '입력하지 못했습니다'), el('div', 'err', (result && result.message) || '알 수 없는 오류가 발생했습니다.'));
      return;
    }
    const { counts, entries, notices } = result.report;
    box.appendChild(el('h2', null, `${result.platformName} 입력 결과`));
    const summary = el('div', 'counts');
    summary.append(
      el('span', 'ok', `입력 ${counts.filled}`),
      el('span', 'warn', `확인 필요 ${counts.failed + counts.manual}`),
      el('span', 'muted', `건너뜀 ${counts.skipped}`)
    );
    box.appendChild(summary);
    const list = el('ul');
    entries
      .filter((entry) => entry.status === 'failed' || entry.status === 'manual')
      .forEach((entry) => list.appendChild(el('li', 'warn', `${entry.label}${entry.detail ? ` — ${entry.detail}` : ''}`)));
    entries
      .filter((entry) => entry.status === 'filled')
      .forEach((entry) => list.appendChild(el('li', null, entry.label)));
    notices.forEach((notice) => list.appendChild(el('li', 'muted', notice)));
    if (list.childElementCount) box.appendChild(list);
  }

  async function detect() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/.test(tab.url || '')) {
      setStatus({ title: '지원서 페이지가 아닙니다', desc: '웹 페이지에서 사용할 수 있습니다.', enabled: false });
      return;
    }
    activeTabId = tab.id;
    const response = await chrome.runtime.sendMessage({ type: 'kapply:tab-status', tabId: tab.id });
    const status = response && response.ok ? response.status : null;
    if (!status) {
      setStatus({ title: '지원하는 채용 솔루션이 아닙니다', desc: '그리팅 · 나인하이어 · 마이다스인을 지원합니다.', enabled: false });
      return;
    }
    const info = platforms.describe(status.platform);
    setStatus({
      title: `${info.name} ${status.formReady ? '지원서 감지됨' : '채용 사이트'}`,
      desc: status.formReady ? '저장된 프로필로 지금 화면의 항목을 채웁니다.' : '지원서 작성 화면으로 이동하면 입력할 수 있습니다.',
      color: info.color,
      enabled: status.formReady,
    });
  }

  fillButton.addEventListener('click', async () => {
    if (activeTabId == null) return;
    fillButton.disabled = true;
    fillButton.textContent = '입력하는 중…';
    try {
      renderResult(await chrome.runtime.sendMessage({ type: 'kapply:run', tabId: activeTabId }));
    } catch (error) {
      renderResult({ ok: false, message: error.message });
    } finally {
      fillButton.disabled = false;
      fillButton.textContent = '지원서 자동 입력';
    }
  });

  $('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  renderShortcut();
  renderProfile();
  detect().catch((error) => setStatus({ title: '페이지를 확인할 수 없습니다', desc: error.message, enabled: false }));
})();
