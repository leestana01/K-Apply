/**
 * UI 컴포넌트별 값 설정기. 모두 성공 여부(boolean)를 돌려준다.
 *  - 네이티브 HTML (마이다스인)
 *  - Ark UI Select / DatePicker / Combobox / FileUpload (그리팅)
 *  - Ant Design Dropdown / DatePicker (나인하이어)
 */
(function () {
  'use strict';

  const KApply = globalThis.KApply;
  if (KApply.controls) return;

  const { dom, text } = KApply;

  function hasValue(element) {
    if (!element) return false;
    if (element.type === 'checkbox' || element.type === 'radio') return element.checked;
    if (element.tagName === 'SELECT') return element.selectedIndex > 0 && element.value !== '';
    return String(element.value || '').trim() !== '';
  }

  // ---------------------------------------------------------------------------
  // 네이티브 컨트롤
  // ---------------------------------------------------------------------------

  async function fillText(element, value) {
    dom.typeValue(element, String(value));
    await dom.sleep(30);
    return hasValue(element);
  }

  async function fillSelect(select, candidates) {
    const options = [...select.options].filter((option) => option.value !== '' && !option.disabled);
    const index = text.pickOption(
      options.map((option) => option.textContent),
      candidates
    );
    if (index < 0) return false;
    if (select.value === options[index].value) return true;
    dom.setNativeValue(select, options[index].value);
    dom.fire(select, 'input');
    dom.fire(select, 'change');
    await dom.sleep(60);
    return select.value === options[index].value;
  }

  function radioLabel(radio) {
    const wrapping = radio.closest('label');
    if (wrapping && dom.textOf(wrapping)) return dom.textOf(wrapping);
    if (radio.id) {
      const label = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
      if (label) return dom.textOf(label);
    }
    const sibling = radio.nextElementSibling;
    return sibling ? dom.textOf(sibling) : radio.value;
  }

  async function fillRadio(radios, candidates) {
    const usable = radios.filter((radio) => !radio.disabled);
    const index = text.pickOption(usable.map(radioLabel), candidates);
    if (index < 0) return false;
    const radio = usable[index];
    if (!radio.checked) radio.click();
    await dom.sleep(80);
    return radio.checked;
  }

  async function fillCheckbox(checkbox, checked) {
    if (checkbox.checked !== checked) checkbox.click();
    await dom.sleep(60);
    return checkbox.checked === checked;
  }

  function attachFiles(input, files) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    dom.fire(input, 'input');
    dom.fire(input, 'change');
  }

  async function fillFileInput(input, record) {
    attachFiles(input, [dom.toFile(record)]);
    await dom.sleep(300);
    return input.files.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Ark UI (그리팅)
  // ---------------------------------------------------------------------------

  function arkContent(trigger) {
    const id = trigger.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }

  async function closeArk(trigger) {
    const content = arkContent(trigger);
    if (content && content.getAttribute('data-state') === 'open') {
      trigger.click();
      await dom.sleep(80);
    }
  }

  async function fillArkSelect(trigger, candidates) {
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    const content = await dom.waitFor(() => {
      const node = arkContent(trigger);
      return node && node.querySelector('[data-part="item"]') ? node : null;
    });
    if (!content) {
      await closeArk(trigger);
      return false;
    }
    const items = [...content.querySelectorAll('[data-part="item"]')].filter((item) => !item.hasAttribute('data-disabled'));
    const index = text.pickOption(items.map(dom.textOf), candidates);
    if (index < 0) {
      await closeArk(trigger);
      return false;
    }
    items[index].click();
    await dom.sleep(120);
    await closeArk(trigger);
    return trigger.getAttribute('data-placeholder-shown') === null || dom.textOf(trigger).includes(dom.textOf(items[index]));
  }

  /** Ark DatePicker: 팝오버 안의 입력창에 날짜를 넣고 Enter로 확정한다. 연월 선택기도 같은 방식을 쓴다. */
  async function fillArkDate(trigger, isoDate) {
    const parsed = text.parseDate(isoDate);
    if (!parsed) return false;
    trigger.click();
    const content = await dom.waitFor(() => {
      const node = arkContent(trigger);
      return node && node.querySelector('input[data-part="input"]') ? node : null;
    });
    if (!content) return false;
    const input = content.querySelector('input[data-part="input"]');
    dom.setNativeValue(input, text.formatDate(isoDate, 'YYYY-MM-DD'));
    dom.fire(input, 'input');
    dom.press(input, 'Enter');
    await dom.sleep(150);
    await closeArk(trigger);
    return trigger.getAttribute('data-placeholder') !== 'true';
  }

  function arkItemText(item) {
    const main = item.querySelector('[data-part="item-text"]');
    if (main) return dom.textOf(main);
    // 설명(지역·업종 등)이 이름에 포함된 문자열과 겹칠 수 있으므로 노드 단위로 제거한다.
    const clone = item.cloneNode(true);
    clone.querySelectorAll('[data-part="item-description"]').forEach((node) => node.remove());
    return dom.textOf(clone);
  }

  function insertText(input, value) {
    dom.setNativeValue(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: value ? 'insertText' : 'deleteContentBackward', data: value || null }));
  }

  /**
   * Ark Combobox(회사명·학교명·전공 검색 등).
   * 글자만 넣으면 폼 상태에 반영되지 않으므로, 제안 목록에서 정확히 일치하는 항목을 고르거나
   * "직접 입력하기"(data-value="[[new]]") 항목을 선택해 값을 확정한다.
   * 제안 목록이 없는 자유 입력형(이메일 등)은 입력값을 그대로 둔다.
   */
  function leave(input) {
    input.blur();
    dom.fire(input, 'focusout');
  }

  async function fillArkCombobox(input, value) {
    const wanted = String(value);
    const key = text.normalize(wanted);
    // 브라우저 창이 포커스를 잃은 상태(팝업 클릭 직후 등)에서는 focus()가 이벤트를 만들지 않으므로 직접 보낸다.
    input.focus({ preventScroll: true });
    dom.fire(input, 'focus');
    dom.fire(input, 'focusin');
    insertText(input, '');
    await dom.sleep(80);
    insertText(input, wanted);

    // 제안 목록은 검색 API 응답 후 갱신되므로, 원하는 항목이 나타날 때까지 기다린다.
    const pick = () => {
      const content = arkContent(input);
      if (!content || input.getAttribute('aria-expanded') !== 'true') return null;
      const items = [...content.querySelectorAll('[data-part="item"]')];
      return (
        items.find((item) => text.normalize(arkItemText(item)) === key) ||
        items.find((item) => item.getAttribute('data-value') === '[[new]]' || /직접\s*입력/.test(dom.textOf(item))) ||
        null
      );
    };
    const target = await dom.waitFor(pick, { timeout: 4000, interval: 100 });

    if (target) {
      target.click();
      await dom.sleep(200);
      leave(input);
      await dom.sleep(200);
      return hasValue(input) && input.getAttribute('aria-invalid') !== 'true';
    }

    const expanded = input.getAttribute('aria-expanded') === 'true';
    const suggested = expanded && arkContent(input) && arkContent(input).querySelector('[data-part="item"]');
    dom.press(input, 'Escape');
    leave(input);
    await dom.sleep(150);
    // 제안 목록이 있는데 고르지 못했다면 값이 확정되지 않은 것이다(학교 목록에 없는 이름 등).
    return !suggested && hasValue(input) && input.getAttribute('aria-invalid') !== 'true';
  }

  // ---------------------------------------------------------------------------
  // Ant Design (나인하이어)
  // ---------------------------------------------------------------------------

  function visibleDropdowns() {
    return [...document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden)')].filter(dom.isVisible);
  }

  async function fillAntDropdown(trigger, candidates) {
    // 직전 드롭다운이 닫히는 애니메이션 중이면 새 메뉴와 헷갈리므로 먼저 닫히길 기다린다.
    await dom.waitFor(() => visibleDropdowns().length === 0, { timeout: 800 });
    const before = new Set(visibleDropdowns());
    trigger.click();
    const menu = await dom.waitFor(() => {
      const node = visibleDropdowns().find((candidate) => !before.has(candidate));
      return node && node.querySelector('.ant-dropdown-menu-item') ? node : null;
    });
    if (!menu) return false;
    const items = [...menu.querySelectorAll('.ant-dropdown-menu-item:not(.ant-dropdown-menu-item-disabled)')];
    const index = text.pickOption(items.map(dom.textOf), candidates);
    if (index < 0) {
      trigger.click();
      await dom.sleep(120);
      return false;
    }
    const chosen = dom.textOf(items[index]);
    items[index].click();
    await dom.sleep(150);
    return dom.textOf(trigger).includes(chosen);
  }

  const DATE_FORMATS = ['YYYY.MM.DD', 'YYYY-MM-DD', 'YYYYMMDD', 'YYYY/MM/DD'];
  const MONTH_FORMATS = ['YYYY.MM', 'YYYY-MM', 'YYYYMM', 'YYYY/MM'];

  /**
   * antd DatePicker는 설정된 format으로만 입력을 받는다. 콘텐츠 스크립트에서는 컴포넌트 설정을 읽을 수 없으므로
   * 흔한 포맷을 차례로 시도하고, 포커스를 뺀 뒤에도 값이 남아 있으면 확정된 것으로 본다.
   */
  async function fillAntDate(input, isoDate, { month = false } = {}) {
    const parsed = text.parseDate(isoDate);
    if (!parsed) return false;
    const placeholder = input.getAttribute('placeholder') || '';
    // 연월 선택기인지 알 수 없으면 값의 형태(일자 유무)에 맞는 포맷부터 시도하고, 실패하면 나머지도 시도한다.
    const monthFirst = month || /년월|월$|YYYY[.-]MM$/.test(placeholder) || parsed.d === null;
    const formats = monthFirst ? [...MONTH_FORMATS, ...DATE_FORMATS] : [...DATE_FORMATS, ...MONTH_FORMATS];
    for (const format of formats) {
      dom.fire(input, 'mousedown');
      input.focus({ preventScroll: true });
      await dom.sleep(120);
      dom.setNativeValue(input, text.formatDate(isoDate, format));
      dom.fire(input, 'input');
      await dom.sleep(120);
      dom.press(input, 'Enter');
      await dom.sleep(120);
      input.blur();
      dom.fire(input, 'focusout');
      await dom.sleep(150);
      if (hasValue(input)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // 마이다스인 (jQuery + Dates 플러그인)
  // ---------------------------------------------------------------------------

  /** data-dates="<그룹>:<YMD|YM|END>" 에서 입력 포맷을 결정한다. END는 같은 그룹의 시작일 포맷을 따른다. */
  function midasDateFormat(input) {
    const spec = input.getAttribute('data-dates') || '';
    const [group, kind] = spec.split(':');
    let resolved = kind;
    if (kind === 'END' || !kind) {
      const partner = [...document.querySelectorAll('[data-dates]')].find((node) => {
        const [otherGroup, otherKind] = (node.getAttribute('data-dates') || '').split(':');
        return node !== input && otherGroup === group && otherKind !== 'END';
      });
      resolved = partner ? partner.getAttribute('data-dates').split(':')[1] : 'YMD';
    }
    return resolved === 'YM' ? 'YYYY.MM' : 'YYYY.MM.DD';
  }

  async function fillMidasDate(input, isoDate) {
    const value = text.formatDate(isoDate, midasDateFormat(input));
    if (!value) return false;
    dom.typeValue(input, value, { blur: false });
    dom.press(input, 'Tab');
    dom.fire(input, 'focusout');
    dom.fire(input, 'blur');
    await dom.sleep(60);
    return hasValue(input);
  }

  /**
   * 학교·전공·자격증·어학시험 검색: 키워드 입력 → Enter(keypress) → 결과 선택.
   * 결과가 없으면 "직접 등록하기" 버튼을 누른다(어학시험 제외).
   */
  async function fillMidasSearch(searchInput, keyword) {
    const wrap = searchInput.closest('div.search') || searchInput.parentElement;
    dom.typeValue(searchInput, String(keyword), { blur: false });
    dom.press(searchInput, 'Enter');
    const settled = await dom.waitFor(() => wrap.querySelector('.searchResult button'), { timeout: 4000 });
    if (!settled) return false;
    const results = [...wrap.querySelectorAll('.searchResult li button[data-code]')];
    const index = text.pickOption(
      results.map((button) => button.getAttribute('title') || dom.textOf(button)),
      [keyword]
    );
    const target = index >= 0 ? results[index] : wrap.querySelector('.searchResult button.registKeyword');
    if (!target) return false;
    target.click();
    await dom.sleep(150);
    const row = searchInput.closest('.row') || wrap.parentElement;
    const hidden = row && row.querySelector('input[type="hidden"][name$="Name"]');
    return hidden ? hidden.value !== '' : true;
  }

  KApply.controls = {
    hasValue,
    fillText,
    fillSelect,
    fillRadio,
    radioLabel,
    fillCheckbox,
    attachFiles,
    fillFileInput,
    fillArkSelect,
    fillArkDate,
    fillArkCombobox,
    fillAntDropdown,
    fillAntDate,
    fillMidasDate,
    fillMidasSearch,
  };
})();
