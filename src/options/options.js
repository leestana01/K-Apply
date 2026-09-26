(function () {
  'use strict';

  const { storage, schema, text } = globalThis.KApply;

  const $ = (id) => document.getElementById(id);
  const SAVE_DELAY_MS = 400;

  let profile = schema.emptyProfile();
  let saveTimer = null;

  // ---------------------------------------------------------------------------
  // 저장
  // ---------------------------------------------------------------------------

  function setSaveState(state, message) {
    const node = $('save-state');
    node.className = `save-state ${state}`;
    node.textContent = message;
  }

  function scheduleSave() {
    setSaveState('pending', '저장 중…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await storage.saveProfile(profile);
        setSaveState('', '저장됨');
      } catch (error) {
        setSaveState('error', `저장 실패: ${error.message}`);
      }
    }, SAVE_DELAY_MS);
  }

  // ---------------------------------------------------------------------------
  // 필드 렌더링
  // ---------------------------------------------------------------------------

  function el(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'className') node.className = value;
      else if (key === 'textContent') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children).forEach((child) => child && node.append(child));
    return node;
  }

  const VALIDATORS = {
    email: (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    url: (value) => !value || /^https?:\/\/\S+$/i.test(value),
    tel: (value) => !value || text.splitPhone(value) !== null,
  };

  let fieldSequence = 0;

  /**
   * @param {object} field 스키마 필드 정의
   * @param {*} value 현재 값
   * @param {(value:*) => void} onChange
   */
  function renderField(field, value, onChange) {
    fieldSequence += 1;
    const id = `field-${fieldSequence}`;
    let control;

    if (field.type === 'select') {
      control = el(
        'select',
        { id },
        field.options.map(([optionValue, optionLabel]) => el('option', { value: optionValue, textContent: optionLabel }))
      );
      control.value = value;
    } else if (field.type === 'textarea') {
      control = el('textarea', { id, rows: 4 });
      control.value = value;
    } else if (field.type === 'checkbox') {
      control = el('input', { id, type: 'checkbox' });
      control.checked = value === true;
    } else {
      const inputType = { date: 'date', month: 'month', email: 'email', url: 'url', tel: 'tel', number: 'number' }[field.type] || 'text';
      control = el('input', { id, type: inputType, placeholder: field.placeholder, autocomplete: field.autocomplete || 'off' });
      control.value = value;
    }

    const read = () => (field.type === 'checkbox' ? control.checked : control.value);
    const validate = VALIDATORS[field.type];
    const handler = () => {
      if (validate) control.setAttribute('aria-invalid', String(!validate(control.value.trim())));
      onChange(read());
    };
    control.addEventListener(field.type === 'checkbox' || field.type === 'select' ? 'change' : 'input', handler);
    if (validate) control.setAttribute('aria-invalid', String(!validate(String(value || '').trim())));

    const label = el('label', { for: id, textContent: field.label });
    if (field.type === 'checkbox') return el('div', { className: 'field checkbox' }, [control, label]);
    const wrapper = el('div', { className: `field${field.type === 'textarea' ? ' wide' : ''}` }, [label, control]);
    if (field.hint) wrapper.append(el('span', { className: 'hint', textContent: field.hint }));
    return wrapper;
  }

  // ---------------------------------------------------------------------------
  // 섹션 렌더링
  // ---------------------------------------------------------------------------

  function entryTitle(section, entry, index) {
    const parts = (section.summary || []).map((key) => entry[key]).filter(Boolean);
    return parts.length ? parts.join(' · ') : `${section.itemLabel} ${index + 1}`;
  }

  function renderSingle(section) {
    const values = profile[section.id];
    const grid = el(
      'div',
      { className: 'grid' },
      section.fields.map((field) =>
        renderField(field, values[field.key], (value) => {
          values[field.key] = value;
          scheduleSave();
        })
      )
    );
    return el('section', { className: 'card', id: `section-${section.id}` }, [el('h2', { textContent: section.title }), grid]);
  }

  function renderList(section) {
    const card = el('section', { className: 'card', id: `section-${section.id}` });
    const entries = profile[section.id];
    const addButton = el('button', { className: 'btn', type: 'button', textContent: `+ ${section.itemLabel} 추가` });
    addButton.addEventListener('click', () => {
      entries.push(schema.emptyEntry(section));
      scheduleSave();
      rerender(section.id, true);
    });
    card.append(el('div', { className: 'section-head' }, [el('h2', { textContent: section.title }), addButton]));

    const list = el('div', { className: 'entries' });
    if (!entries.length) {
      list.append(el('div', { className: 'empty', textContent: `등록된 ${section.itemLabel}이(가) 없습니다.` }));
    }
    entries.forEach((entry, index) => {
      const title = el('div', { className: 'entry-title', textContent: entryTitle(section, entry, index) });
      const move = (delta) => {
        const target = index + delta;
        [entries[index], entries[target]] = [entries[target], entries[index]];
        scheduleSave();
        rerender(section.id);
      };
      const up = el('button', { className: 'icon-btn', type: 'button', title: '위로', 'aria-label': '위로 이동', textContent: '↑', disabled: index === 0 });
      const down = el('button', {
        className: 'icon-btn',
        type: 'button',
        title: '아래로',
        'aria-label': '아래로 이동',
        textContent: '↓',
        disabled: index === entries.length - 1,
      });
      const remove = el('button', { className: 'icon-btn', type: 'button', title: '삭제', 'aria-label': '삭제', textContent: '✕' });
      up.addEventListener('click', () => move(-1));
      down.addEventListener('click', () => move(1));
      remove.addEventListener('click', () => {
        entries.splice(index, 1);
        scheduleSave();
        rerender(section.id);
      });

      const grid = el(
        'div',
        { className: 'grid' },
        section.fields.map((field) =>
          renderField(field, entry[field.key], (value) => {
            entry[field.key] = value;
            title.textContent = entryTitle(section, entry, index);
            scheduleSave();
          })
        )
      );
      list.append(el('article', { className: 'entry' }, [el('div', { className: 'entry-head' }, [title, up, down, remove]), grid]));
    });
    card.append(list);
    return card;
  }

  function renderSection(section) {
    return section.kind === 'list' ? renderList(section) : renderSingle(section);
  }

  function rerender(sectionId, focusLast = false) {
    const section = schema.SECTION_BY_ID[sectionId];
    const current = $(`section-${sectionId}`);
    const next = renderSection(section);
    current.replaceWith(next);
    renderNav();
    if (focusLast) {
      const entries = next.querySelectorAll('.entry');
      const last = entries[entries.length - 1];
      if (last) {
        last.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const first = last.querySelector('input, select, textarea');
        if (first) first.focus({ preventScroll: true });
      }
    }
  }

  function renderNav() {
    const links = schema.SECTIONS.map((section) => {
      const count = section.kind === 'list' ? profile[section.id].length : null;
      return el('a', { href: `#section-${section.id}` }, [
        el('span', { textContent: section.title }),
        count === null ? null : el('span', { className: 'count', textContent: String(count) }),
      ]);
    });
    links.push(el('a', { href: '#files' }, [el('span', { textContent: '첨부 파일' })]));
    links.push(el('a', { href: '#settings' }, [el('span', { textContent: '설정' })]));
    links.push(el('a', { href: '#data' }, [el('span', { textContent: '백업 · 초기화' })]));
    $('nav').replaceChildren(...links);
  }

  function renderAll() {
    fieldSequence = 0;
    $('sections').replaceChildren(...schema.SECTIONS.map(renderSection));
    renderNav();
  }

  // ---------------------------------------------------------------------------
  // 첨부 파일
  // ---------------------------------------------------------------------------

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function renderFiles() {
    const meta = await storage.loadFileMeta();
    const slots = schema.FILE_SLOTS.map((slot) => {
      const info = meta[slot.key];
      const picker = el('input', { type: 'file', hidden: true, accept: '.pdf,.doc,.docx,.hwp,.hwpx,.ppt,.pptx,.zip,.png,.jpg,.jpeg' });
      const choose = el('button', { className: 'btn', type: 'button', textContent: info ? '변경' : '파일 선택' });
      const remove = el('button', { className: 'btn btn-danger', type: 'button', textContent: '삭제', hidden: !info });
      const status = el('div', { className: 'muted small' });

      choose.addEventListener('click', () => picker.click());
      picker.addEventListener('change', async () => {
        const file = picker.files[0];
        if (!file) return;
        if (file.size > schema.MAX_FILE_BYTES) {
          status.textContent = `파일이 너무 큽니다 (${formatBytes(file.size)}). 최대 ${formatBytes(schema.MAX_FILE_BYTES)}.`;
          status.className = 'small err';
          return;
        }
        status.textContent = '저장 중…';
        try {
          await storage.saveFile(slot.key, { name: file.name, type: file.type, size: file.size, data: await readAsBase64(file) });
          renderFiles();
        } catch (error) {
          status.textContent = `저장 실패: ${error.message}`;
        }
      });
      remove.addEventListener('click', async () => {
        await storage.removeFile(slot.key);
        renderFiles();
      });

      const details = info
        ? [
            el('div', { className: 'file-name', textContent: info.name }),
            el('div', {
              className: 'muted small',
              textContent: `${formatBytes(info.size)} · ${new Date(info.updatedAt).toLocaleDateString('ko-KR')} 저장`,
            }),
          ]
        : [el('div', { className: 'muted', textContent: '등록된 파일 없음' })];

      return el('div', { className: 'file-slot' }, [
        el('strong', { textContent: slot.label }),
        ...details,
        el('div', { className: 'actions' }, [choose, remove, picker]),
        status,
      ]);
    });
    $('file-grid').replaceChildren(...slots);
  }

  // ---------------------------------------------------------------------------
  // 설정 · 백업
  // ---------------------------------------------------------------------------

  async function initSettings() {
    await initSettingsValues();
    $('setting-launcher').addEventListener('change', (event) => storage.saveSettings({ showLauncher: event.target.checked }));
    $('setting-overwrite').addEventListener('change', (event) => storage.saveSettings({ overwrite: event.target.checked }));
    $('shortcut-link').addEventListener('click', (event) => {
      event.preventDefault();
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }

  function exportProfile() {
    const payload = { format: 'k-apply-profile', version: 1, exportedAt: new Date().toISOString(), profile };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const link = el('a', { href: url, download: `k-apply-profile-${date}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importProfile(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = parsed && parsed.format === 'k-apply-profile' ? parsed.profile : parsed;
      profile = await storage.saveProfile(incoming);
      renderAll();
      setSaveState('', '가져오기 완료');
    } catch (error) {
      setSaveState('error', `가져오기 실패: 올바른 K-Apply 백업 파일이 아닙니다.`);
    }
  }

  function initData() {
    $('export').addEventListener('click', exportProfile);
    $('import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (file) importProfile(file);
      event.target.value = '';
    });
    $('reset').addEventListener('click', async () => {
      // 되돌릴 수 없는 작업이므로 사용자에게 확인한다.
      if (!window.confirm('프로필, 첨부 파일, 설정을 모두 삭제합니다. 계속할까요?')) return;
      await storage.clearAll();
      profile = schema.emptyProfile();
      renderAll();
      renderFiles();
      initSettingsValues();
      setSaveState('', '모두 삭제됨');
    });
  }

  async function initSettingsValues() {
    const settings = await storage.loadSettings();
    $('setting-launcher').checked = settings.showLauncher;
    $('setting-overwrite').checked = settings.overwrite;
  }

  async function init() {
    profile = await storage.loadProfile();
    renderAll();
    await Promise.all([renderFiles(), initSettings()]);
    initData();
  }

  init().catch((error) => setSaveState('error', `불러오기 실패: ${error.message}`));
})();
