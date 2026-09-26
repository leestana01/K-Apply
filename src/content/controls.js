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

  // ---------------------------------------------------------------------------
  // 코드 목록 선택 공통 규칙 (학교·전공·회사·자격증·어학시험 검색)
  // ---------------------------------------------------------------------------

  /**
   * @typedef {object} LookupOptions
   * @property {string} [campus]        학교 캠퍼스·분교
   * @property {boolean} [reviewDirect] 목록에 없어 직접 입력했을 때 "확인 필요"로 표시할지 (학교·전공 등 코드가 중요한 항목)
   * @property {boolean} [allowDirect]  목록에 없을 때 직접 입력을 허용할지 (기본 true)
   * @property {boolean} [freeText]     제안 목록은 참고용이고 입력값 자체가 유효한 칸 (이메일 등)
   */

  /**
   * 목록 항목 텍스트에서 선택할 대상을 정한다.
   * @returns {{index:number, review?:string, reason?:string, direct?:boolean}}
   */
  function resolveListed(options, value, { campus = '', reviewDirect = false, allowDirect = true, freeText = false } = {}, hasDirect = false) {
    const match = text.matchListed(options, value, { campus });
    if (match.index >= 0) return { index: match.index, review: match.exact ? '' : match.note };
    if (freeText) return { index: -1, keep: true };
    if (match.ambiguous) {
      return {
        index: -1,
        reason: `목록에 여러 항목(${match.choices.slice(0, 4).join(', ')})이 있어 고르지 않았습니다. 프로필에 캠퍼스를 입력하거나 직접 선택해 주세요.`,
      };
    }
    if (allowDirect && hasDirect) {
      return { index: -1, direct: true, review: reviewDirect ? `'${value}'이(가) 목록에 없어 직접 입력했습니다. 공식 명칭인지 확인해 주세요.` : '' };
    }
    return { index: -1, reason: `'${value}'을(를) 목록에서 찾지 못했습니다. 직접 선택해 주세요.` };
  }

  function listedResult(decision, ok, failure) {
    if (!ok) return { ok: false, reason: failure };
    return decision.review ? { ok: true, review: decision.review } : { ok: true };
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

  function leave(input) {
    input.blur();
    dom.fire(input, 'focusout');
  }

  function insertText(input, value) {
    dom.setNativeValue(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: value ? 'insertText' : 'deleteContentBackward', data: value || null }));
  }

  /**
   * Ark Combobox(회사명·학교명·전공 검색 등).
   * 글자만 넣으면 폼 상태에 반영되지 않으므로 목록에서 항목을 골라 값을 확정한다.
   *  - 목록에 같은 이름(캠퍼스 포함)의 코드 항목이 있으면 그 항목
   *  - 없으면 "직접 입력하기"(data-value="[[new]]")
   *  - 캠퍼스 등으로 여러 항목이 있으면 추측하지 않고 실패로 보고
   * 제안 목록이 없는 자유 입력형(이메일 등)은 입력값을 그대로 둔다.
   * @param {HTMLInputElement} input
   * @param {string} value
   * @param {LookupOptions} [lookup]
   */
  async function fillArkCombobox(input, value, lookup = {}) {
    const wanted = String(value);
    // 브라우저 창이 포커스를 잃은 상태(팝업 클릭 직후 등)에서는 focus()가 이벤트를 만들지 않으므로 직접 보낸다.
    input.focus({ preventScroll: true });
    dom.fire(input, 'focus');
    dom.fire(input, 'focusin');
    insertText(input, '');
    await dom.sleep(80);
    insertText(input, wanted);

    const isDirect = (item) => item.getAttribute('data-value') === '[[new]]' || /직접\s*입력/.test(dom.textOf(item));
    // 제안 목록은 검색 API 응답 후 갱신된다. 직접 입력 항목이 현재 입력값으로 바뀌고 목록이 잠시 안정될 때까지 기다린다.
    let lastSignature = '';
    let stableSince = 0;
    const content = await dom.waitFor(
      () => {
        const node = arkContent(input);
        if (!node || input.getAttribute('aria-expanded') !== 'true') return null;
        const items = [...node.querySelectorAll('[data-part="item"]')];
        if (!items.length) return null;
        const signature = items.map(dom.textOf).join('|');
        if (signature !== lastSignature) {
          lastSignature = signature;
          stableSince = Date.now();
          return null;
        }
        const direct = items.find(isDirect);
        const directReady = !direct || dom.textOf(direct).includes(wanted);
        return directReady && Date.now() - stableSince >= 400 ? node : null;
      },
      { timeout: 5000, interval: 100 }
    );

    if (content) {
      const items = [...content.querySelectorAll('[data-part="item"]')];
      const listed = items.filter((item) => !isDirect(item));
      const direct = items.find(isDirect);
      const decision = resolveListed(listed.map(arkItemText), wanted, lookup, !!direct);
      const target = decision.index >= 0 ? listed[decision.index] : decision.direct ? direct : null;
      if (decision.keep) {
        dom.press(input, 'Escape');
        leave(input);
        await dom.sleep(150);
        return hasValue(input) && input.getAttribute('aria-invalid') !== 'true';
      }
      if (target) {
        target.click();
        await dom.sleep(200);
        leave(input);
        await dom.sleep(200);
        const ok = hasValue(input) && input.getAttribute('aria-invalid') !== 'true';
        return listedResult(decision, ok, '선택한 항목이 반영되지 않았습니다.');
      }
      dom.press(input, 'Escape');
      insertText(input, '');
      leave(input);
      await dom.sleep(150);
      return { ok: false, reason: decision.reason };
    }

    // 제안 목록이 뜨지 않는 자유 입력 칸
    dom.press(input, 'Escape');
    leave(input);
    await dom.sleep(150);
    return hasValue(input) && input.getAttribute('aria-invalid') !== 'true';
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

  /**
   * 나인하이어 자동완성(학교·전공 검색). 드롭다운을 여는 클릭 시점에 현재 입력값으로 코드 목록을 검색하므로
   * 값을 넣은 뒤 입력 영역을 클릭해 목록을 열고, 규칙에 맞는 항목 또는 "직접 입력하기"를 고른다.
   * @param {HTMLInputElement} input
   * @param {string} value
   * @param {LookupOptions} [lookup]
   */
  async function fillAutocompleteDropdown(input, value, lookup = {}) {
    const wanted = String(value);
    const MENU = '[class*="AutocompleteDropdown__DropdownMenu"]';
    const DIRECT = '[class*="AutocompleteDropdown__DirectSection"]';
    const visible = (selector) => [...document.querySelectorAll(selector)].filter(dom.isVisible);

    input.focus({ preventScroll: true });
    dom.fire(input, 'focus');
    dom.fire(input, 'focusin');
    insertText(input, '');
    await dom.sleep(60);
    insertText(input, wanted);
    await dom.sleep(120);
    const opener = input.closest('[class*="InputWrapper"]') || input.parentElement;
    const before = visible(MENU).map(dom.textOf).join('|');
    dom.fire(opener, 'mousedown');
    opener.click();
    dom.fire(input, 'focusin');

    let lastSignature = null;
    let stableSince = 0;
    const startedAt = Date.now();
    const ready = await dom.waitFor(
      () => {
        const direct = visible(DIRECT)[0];
        if (!direct || !dom.textOf(direct).includes(wanted)) return null;
        const signature = visible(MENU).map(dom.textOf).join('|');
        if (signature !== lastSignature) {
          lastSignature = signature;
          stableSince = Date.now();
          return null;
        }
        // 이전 검색 결과가 그대로 남아 있을 수 있으므로, 목록이 바뀌었거나 충분히 기다린 뒤에 판단한다.
        const refreshed = signature !== before || Date.now() - startedAt > 2500;
        return refreshed && Date.now() - stableSince >= 400 ? direct : null;
      },
      { timeout: 6000, interval: 100 }
    );

    const close = async () => {
      dom.press(input, 'Escape');
      leave(input);
      await dom.sleep(150);
    };

    if (!ready) {
      await close();
      return hasValue(input) ? { ok: true, review: '검색 목록이 열리지 않아 입력값을 그대로 두었습니다. 목록에서 다시 선택해 주세요.' } : false;
    }

    const seen = new Set();
    const items = visible(MENU).filter((item) => {
      const key = dom.textOf(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const decision = resolveListed(items.map(dom.textOf), wanted, lookup, true);
    if (decision.keep) {
      await close();
      return hasValue(input);
    }
    if (decision.index >= 0) {
      const item = items[decision.index];
      const expected = dom.textOf(item);
      (item.querySelector('[class*="MenuContainer"]') || item).click();
      await dom.sleep(250);
      await close();
      return listedResult(decision, text.normalize(input.value) === text.normalize(expected), '선택한 학교가 반영되지 않았습니다.');
    }
    if (decision.direct) {
      ready.click();
      await dom.sleep(250);
      await close();
      return listedResult(decision, text.normalize(input.value) === text.normalize(wanted), '직접 입력이 반영되지 않았습니다.');
    }
    insertText(input, '');
    await close();
    return { ok: false, reason: decision.reason };
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
   * 결과 목록에서 규칙에 맞는 코드 항목을 고르고, 없으면 "직접 등록하기"를 누른다(어학시험은 직접 등록 없음).
   * @param {HTMLInputElement} searchInput
   * @param {string} keyword
   * @param {LookupOptions} [lookup]
   */
  async function fillMidasSearch(searchInput, keyword, lookup = {}) {
    const wrap = searchInput.closest('div.search') || searchInput.parentElement;
    dom.typeValue(searchInput, String(keyword), { blur: false });
    dom.press(searchInput, 'Enter');
    const settled = await dom.waitFor(() => wrap.querySelector('.searchResult button, .searchResult .noResult'), { timeout: 5000 });
    if (!settled) return { ok: false, reason: '검색 결과가 표시되지 않았습니다.' };
    const results = [...wrap.querySelectorAll('.searchResult li button[data-code]')];
    const register = wrap.querySelector('.searchResult button.registKeyword');
    const decision = resolveListed(
      results.map((button) => button.getAttribute('title') || dom.textOf(button)),
      String(keyword),
      lookup,
      !!register
    );
    const target = decision.index >= 0 ? results[decision.index] : decision.direct ? register : null;
    if (!target) {
      dom.fire(document, 'mousedown');
      return { ok: false, reason: decision.reason };
    }
    target.click();
    await dom.sleep(200);
    const row = searchInput.closest('.row') || wrap.parentElement;
    const hidden = row && row.querySelector('input[type="hidden"][name$="Name"]');
    return listedResult(decision, hidden ? hidden.value !== '' : true, '선택한 항목이 반영되지 않았습니다.');
  }

  KApply.controls = {
    hasValue,
    fillText,
    fillSelect,
    fillRadio,
    radioLabel,
    fillCheckbox,
    fillArkSelect,
    fillArkDate,
    fillArkCombobox,
    fillAntDropdown,
    fillAntDate,
    fillAutocompleteDropdown,
    fillMidasDate,
    fillMidasSearch,
  };
})();
