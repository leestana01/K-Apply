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

  /** 선택지를 찾지 못했을 때 사용자에게 보여 줄 사유 */
  function missingOption(options, candidates) {
    const wanted = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean)[0] || '';
    const list = options.map((option) => String(option).trim()).filter(Boolean);
    const shown = list.slice(0, 8).join(', ') + (list.length > 8 ? ` 외 ${list.length - 8}개` : '');
    return { ok: false, reason: list.length ? `선택지(${shown})에 '${wanted}'에 해당하는 항목이 없습니다.` : '선택지를 불러오지 못했습니다.' };
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
    if (index < 0) return missingOption(options.map((option) => option.textContent), candidates);
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
    if (index < 0) return missingOption(usable.map(radioLabel), candidates);
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
      return missingOption(items.map(dom.textOf), candidates);
    }
    items[index].click();
    await dom.sleep(120);
    await closeArk(trigger);
    return trigger.getAttribute('data-placeholder-shown') === null || dom.textOf(trigger).includes(dom.textOf(items[index]));
  }

  /**
   * Ark DatePicker: 팝오버 안의 입력창에 날짜를 넣고 Enter로 확정한다. 연월 선택기도 같은 방식을 쓴다.
   * 범위 선택기(입력창 2개)는 [시작, 종료] 배열을 받는다. 종료가 없으면(재직 중 등) 시작만 넣는다.
   * 창이 포커스를 잃은 상태에서도 입력칸 전환이 인식되도록 focus/focusin을 직접 보낸다.
   * @param {HTMLElement} trigger
   * @param {string|string[]} value
   */
  async function fillArkDate(trigger, value) {
    const values = (Array.isArray(value) ? value : [value]).filter((item) => text.parseDate(item));
    if (!values.length) return false;
    trigger.click();
    const content = await dom.waitFor(() => {
      const node = arkContent(trigger);
      return node && node.querySelector('input[data-part="input"]') ? node : null;
    });
    if (!content) return false;
    const inputs = [...content.querySelectorAll('input[data-part="input"]')];
    for (let index = 0; index < Math.min(values.length, inputs.length); index += 1) {
      const input = inputs[index];
      input.focus({ preventScroll: true });
      dom.fire(input, 'focus');
      dom.fire(input, 'focusin');
      await dom.sleep(60);
      dom.setNativeValue(input, text.formatDate(values[index], 'YYYY-MM-DD'));
      dom.fire(input, 'input');
      dom.press(input, 'Enter');
      await dom.sleep(200);
    }
    await closeArk(trigger);
    return trigger.getAttribute('data-placeholder') !== 'true' && trigger.getAttribute('aria-invalid') !== 'true';
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

  /** Ark ToggleGroup(비대상|대상, 전문학사|학사 등): 해당 항목이 선택되지 않았으면 누른다. */
  async function fillToggleGroup(group, candidates) {
    const items = [...group.querySelectorAll('[data-part="item"]')].filter((item) => !item.disabled);
    const index = text.pickOption(items.map(dom.textOf), candidates);
    if (index < 0) return false;
    const item = items[index];
    if (item.getAttribute('data-state') !== 'on') {
      item.click();
      await dom.sleep(120);
    }
    return item.getAttribute('data-state') === 'on';
  }

  /** 주소가 같은지 비교하기 위한 정규화: 공백·구두점 제거, "대한민국" 접두어 제거 */
  function addressKey(value) {
    return text.normalize(String(value || '').replace(/^\s*(대한민국|South Korea|Korea)\s*/i, ''));
  }

  /**
   * 그리팅 주소 검색 모달(Google Places): 검색어 입력 → Enter → 우편번호와 도로명 주소가 모두 같은 결과만 선택.
   * @param {HTMLElement} opener "주소 찾기" 버튼
   * @param {{postalCode:string, address:string}} target
   */
  async function fillGreetingAddress(opener, target) {
    opener.click();
    const dialog = await dom.waitFor(() =>
      [...document.querySelectorAll('[role="dialog"], [data-scope="dialog"][data-part="content"]')].find(
        (node) => dom.isVisible(node) && node.querySelector('input[type="search"]')
      )
    );
    if (!dialog) return { ok: false, reason: '주소 검색 창이 열리지 않았습니다.' };
    const input = dialog.querySelector('input[type="search"]');
    input.focus({ preventScroll: true });
    dom.fire(input, 'focusin');
    insertText(input, target.address);
    dom.press(input, 'Enter');

    const compact = (node) => String(node.textContent || '').replace(/\s+/g, '');
    const results = () => {
      const matches = [...dialog.querySelectorAll('div')].filter((node) => /주소.+우편번호\d{5}$/.test(compact(node)) && !/주소검색/.test(compact(node)));
      return matches.filter((node) => !matches.some((other) => other !== node && node.contains(other)));
    };
    const found = await dom.waitFor(() => (results().length ? results() : null), { timeout: 8000, interval: 150 });
    const close = () => {
      const button = [...dialog.querySelectorAll('button')].find((node) => /닫기|close/i.test(node.getAttribute('aria-label') || dom.textOf(node)));
      if (button) button.click();
      else dom.press(dialog, 'Escape');
    };
    if (!found) {
      close();
      return { ok: false, reason: '주소 검색 결과가 없습니다. 프로필의 도로명 주소를 확인해 주세요.' };
    }
    const wantedZip = text.digitsOnly(target.postalCode);
    const wantedAddress = addressKey(target.address);
    const parsed = found.map((node) => {
      const match = compact(node).match(/주소(.+)우편번호(\d{5})$/);
      return { node, address: match ? match[1] : '', zip: match ? match[2] : '' };
    });
    const exact = parsed.find((item) => item.zip === wantedZip && addressKey(item.address) === wantedAddress);
    if (!exact) {
      close();
      const seen = parsed.slice(0, 3).map((item) => `${item.address}(${item.zip})`).join(', ');
      return { ok: false, reason: `검색 결과에서 우편번호·주소가 정확히 같은 항목을 찾지 못했습니다. 결과: ${seen}` };
    }
    exact.node.click();
    await dom.sleep(400);
    return { ok: true };
  }

  /**
   * 마이다스인 주소 검색(postcodify): 검색어 입력 → 검색 → 우편번호와 도로명 주소가 모두 같은 결과 선택.
   * @returns {Promise<{ok:boolean, reason?:string}|null>} 검색 UI를 찾지 못하면 null
   */
  async function fillPostcodify(opener, target) {
    const controls = () => [...document.querySelectorAll('.postcodify_search_controls')].find(dom.isVisible);
    if (!controls() && opener) opener.click();
    const box = await dom.waitFor(controls, { timeout: 2500 });
    if (!box) return null;
    const keyword = box.querySelector('input.keyword, input[type="text"], input[type="search"]');
    const search = box.querySelector('button.search_button, button');
    if (!keyword || !search) return null;
    dom.typeValue(keyword, target.address, { blur: false });
    search.click();
    const results = await dom.waitFor(
      () => {
        const items = [...document.querySelectorAll('.postcodify_search_result')].filter(dom.isVisible);
        return items.length ? items : null;
      },
      { timeout: 8000, interval: 150 }
    );
    if (!results) return { ok: false, reason: '주소 검색 결과가 없습니다. 프로필의 도로명 주소를 확인해 주세요.' };
    const wantedZip = text.digitsOnly(target.postalCode);
    const wantedAddress = addressKey(target.address);
    const exact = results.find((item) => {
      const zip = dom.textOf(item.querySelector('.code5'));
      const address = dom.textOf(item.querySelector('.address_info'));
      return zip === wantedZip && addressKey(address) === wantedAddress;
    });
    if (!exact) return { ok: false, reason: '검색 결과에서 우편번호·주소가 정확히 같은 항목을 찾지 못했습니다.' };
    (exact.querySelector('a.selector') || exact.querySelector('.address a') || exact).click();
    await dom.sleep(300);
    return { ok: true };
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
      return missingOption(items.map(dom.textOf), candidates);
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
  // 마이다스인 새 버전(/v1/applicant) 컴포넌트
  // ---------------------------------------------------------------------------

  /** 드롭다운 트리거가 연 목록: 검색창과 li > button[value] 항목을 가진 ul */
  function openListbox(trigger) {
    return [...document.querySelectorAll('ul')].find(
      (list) => dom.isVisible(list) && !list.contains(trigger) && list.querySelector('li button[value]')
    );
  }

  /**
   * 드롭다운 버튼: 목록을 열어 항목을 고른다. 목록에 남는 검색 필터를 피하려고 전체 목록에서 먼저 찾는다.
   * @param {HTMLButtonElement} trigger
   * @param {string[]} candidates
   */
  async function fillButtonDropdown(trigger, candidates) {
    if (!openListbox(trigger)) trigger.click();
    const list = await dom.waitFor(() => openListbox(trigger), { timeout: 2000 });
    if (!list) return { ok: false, reason: `선택 목록이 열리지 않았습니다(선택하려던 값: '${(candidates || [])[0] || ''}').` };
    const items = [...list.querySelectorAll('li button[value]')].filter((item) => !/선택\s*안\s*함/.test(dom.textOf(item)));
    const index = text.pickOption(items.map(dom.textOf), candidates);
    if (index < 0) {
      trigger.click();
      await dom.sleep(150);
      return missingOption(items.map(dom.textOf), candidates);
    }
    const chosen = dom.textOf(items[index]);
    items[index].click();
    await dom.sleep(250);
    return text.normalize(dom.textOf(trigger)) === text.normalize(chosen) ? true : { ok: false, reason: `'${chosen}'을(를) 골랐지만 반영되지 않았습니다.` };
  }

  /** 버튼형 선택(비대상|군필|…): 선택된 버튼은 흰 배경 인라인 스타일로 표시된다. */
  function segmentSelected(button) {
    return /background-color:\s*(white|rgb\(255,\s*255,\s*255\))/.test(button.getAttribute('style') || '');
  }

  async function fillSegment(buttons, candidates) {
    const usable = buttons.filter((button) => !button.disabled);
    const index = text.pickOption(usable.map(dom.textOf), candidates);
    if (index < 0) return missingOption(usable.map(dom.textOf), candidates);
    if (!segmentSelected(usable[index])) {
      usable[index].click();
      await dom.sleep(250);
    }
    return segmentSelected(usable[index]);
  }

  /**
   * 주소 입력 창(도로명주소 검색): 검색 → 도로명 주소(괄호 속 참고항목 제외)와 지번 주소가 같은 결과 선택 → 확인.
   * 결과 목록에 우편번호가 표시되지 않으므로, 선택 후 채워진 우편번호를 호출하는 쪽에서 검증한다.
   */
  async function fillAddressDialog(opener, target) {
    opener.click();
    const dialog = await dom.waitFor(() =>
      [...document.querySelectorAll('[role="dialog"]')].find((node) => dom.isVisible(node) && node.querySelector('input[type="text"]'))
    );
    if (!dialog) return { ok: false, reason: '주소 입력 창이 열리지 않았습니다.' };
    const button = (label) => [...dialog.querySelectorAll('button')].find((node) => dom.textOf(node) === label);
    const cancel = async () => {
      const node = button('취소');
      if (node) node.click();
      await dom.sleep(200);
    };
    const input = dialog.querySelector('input[type="text"]');
    input.focus({ preventScroll: true });
    dom.fire(input, 'focusin');
    insertText(input, target.address);
    const search = button('검색');
    if (search) search.click();
    else dom.press(input, 'Enter');
    // 결과 항목 텍스트: "도로명 <주소> 지번 <주소>" (순서는 달라도 된다)
    const valueAfter = (item, label) => {
      const match = dom.textOf(item).match(new RegExp(`${label}\\s*(.*?)(?=\\s*(?:도로명|지번)|$)`));
      return match ? match[1].trim() : '';
    };
    const wantedRoad = addressKey(target.address);
    const wantedJibun = target.jibunAddress ? addressKey(target.jibunAddress) : '';
    const matching = (items) =>
      items.filter((item) => {
        const road = valueAfter(item, '도로명').replace(/\s*\([^)]*\)\s*$/, '');
        if (addressKey(road) !== wantedRoad) return false;
        if (!wantedJibun) return true;
        // 지번 칸에는 건물명이 이어 붙기도 하므로 앞부분이 같은지 본다.
        return addressKey(valueAfter(item, '지번')).startsWith(wantedJibun);
      });
    // 검색 결과는 로딩 중 항목·이전 결과를 거쳐 채워지므로, 일치 항목이 하나 나오거나
    // 목록이 1.5초 동안 바뀌지 않을 때까지 기다린 뒤 판단한다.
    let signature = '';
    let since = Date.now();
    let items = [];
    let matches = [];
    await dom.waitFor(
      () => {
        items = [...dialog.querySelectorAll('li')].filter((item) => dom.isVisible(item) && /도로명/.test(dom.textOf(item)));
        const current = items.map(dom.textOf).join('|');
        if (current !== signature) {
          signature = current;
          since = Date.now();
        }
        matches = matching(items);
        const settled = Date.now() - since >= 1500;
        return matches.length === 1 && Date.now() - since >= 300 ? true : settled && items.length ? true : null;
      },
      { timeout: 10000, interval: 150 }
    );
    if (!items.length) {
      await cancel();
      return { ok: false, reason: '주소 검색 결과가 없습니다. 프로필의 도로명 주소를 확인해 주세요.' };
    }
    if (matches.length !== 1) {
      await cancel();
      return {
        ok: false,
        reason: matches.length ? '같은 도로명 주소의 결과가 여러 개라 고르지 않았습니다. 지번 주소를 프로필에 입력해 주세요.' : '검색 결과에서 도로명 주소가 정확히 같은 항목을 찾지 못했습니다.',
      };
    }
    matches[0].click();
    await dom.sleep(300);
    // 결과를 고르면 창 안에 상세주소 칸이 나타나는 경우가 있다. 있으면 여기서 넣는다.
    const detail = [...dialog.querySelectorAll('input[type="text"]')].find((node) => dom.isVisible(node) && /상세\s*주소/.test(node.getAttribute('placeholder') || ''));
    if (detail && target.addressDetail && !hasValue(detail)) {
      detail.focus({ preventScroll: true });
      insertText(detail, target.addressDetail);
      await dom.sleep(100);
    }
    const confirm = button('확인');
    if (!confirm) {
      await cancel();
      return { ok: false, reason: '확인 버튼을 찾지 못했습니다.' };
    }
    confirm.click();
    await dom.sleep(400);
    return { ok: true };
  }

  /** 검색형 입력이 연 결과 목록: li > button 항목(값 속성 없음)을 가진 ul */
  function searchResults(input) {
    return [...document.querySelectorAll('ul')].find(
      (list) => dom.isVisible(list) && !list.contains(input) && list.querySelector('li > button') && !list.querySelector('li button[value]')
    );
  }

  /**
   * 검색형 입력(학교·전공·회사명): 검색어 입력 → 결과 목록에서 이름이 정확히 같은 항목 선택.
   * 같은 이름이 없으면 "'검색어' 등록하기" 항목으로 직접 등록한다(허용한 경우에만).
   * 선택하면 입력칸이 선택한 이름을 보여 주는 텍스트로 바뀌므로, scope 안에 그 이름이 보이는지로 확인한다.
   * @param {HTMLInputElement} input
   * @param {string} value 검색어
   * @param {object} options
   * @param {HTMLElement} options.scope 선택 결과가 표시되는 영역
   * @param {false|'review'|'ok'} [options.register] 같은 이름이 없을 때 직접 등록 여부
   * @param {string[]} [options.names] 정확히 일치로 인정할 이름 후보(우선순위 순). 기본은 검색어 자체
   * @param {boolean} [options.alias] 괄호 속 부가 명칭을 뺀 이름이나 괄호 속 명칭이 같은 항목이 하나뿐이면 선택
   *   (예: 'SQLD' → 'SQLD(SQL개발자)'). 캠퍼스가 괄호로 붙는 학교명에는 쓰지 않는다.
   */
  /** 괄호 속 부가 명칭 변형: 'SQLD(SQL개발자)' → ['sqldsql개발자', 'sqld', 'sql개발자'] (정규화, 2자 이상) */
  function nameVariants(name) {
    const label = String(name || '').trim();
    const inner = label.match(/\(([^)]*)\)\s*$/);
    const base = label.replace(/\s*\([^)]*\)\s*$/, '');
    return [...new Set([label, base, inner ? inner[1] : ''].map(text.normalize).filter((item) => item.length >= 2))];
  }

  async function fillSearchList(input, value, { scope, register = false, names = null, alias = false }) {
    const wanted = text.normalize(value);
    const accepted = (names && names.length ? names : [value]).map(text.normalize);
    const wantedVariants = alias ? [...new Set(accepted.flatMap((name) => nameVariants(name)).concat(nameVariants(value)))] : [];
    input.focus({ preventScroll: true });
    dom.fire(input, 'focusin');

    /**
     * 검색어를 넣고 결과 목록이 안정될 때까지 기다린다.
     * 사이트는 검색 결과보다 "'검색어'등록하기" 항목을 먼저 보여 준다. 등록 항목만 있는 목록은
     * 결과가 늦게 도착할 수 있으므로 더 오래 변화가 없을 때만 확정한다.
     */
    async function search(query) {
      insertText(input, query);
      const key = text.normalize(query);
      let signature = '';
      let since = Date.now();
      return dom.waitFor(
        () => {
          const found = searchResults(input);
          if (!found) return null;
          const items = [...found.querySelectorAll('li > button')].map(dom.textOf);
          const results = items.filter((item) => !/등록하기/.test(item));
          const related = results.some((item) => text.normalize(item).includes(key)) || items.length > results.length;
          const current = items.join('|');
          if (current !== signature) {
            signature = current;
            since = Date.now();
            return null;
          }
          const settle = results.length ? 250 : 1500;
          return related && Date.now() - since >= settle ? found : null;
        },
        { timeout: 8000, interval: 250 }
      );
    }

    const nameOf = (item) => text.normalize(dom.textOf(item));
    const pick = (items) => {
      for (const name of accepted) {
        const exact = items.find((item) => nameOf(item) === name);
        if (exact) return { item: exact, aliased: false };
      }
      if (!alias) return null;
      // 괄호 안팎이 뒤바뀐 표기도 같은 항목으로 본다: 'SQL 개발자(SQLD)' ↔ 'SQLD(SQL개발자)'. 하나뿐일 때만 고른다.
      const matches = items.filter((item) => !/등록하기/.test(dom.textOf(item)) && nameVariants(dom.textOf(item)).some((variant) => wantedVariants.includes(variant)));
      return matches.length === 1 ? { item: matches[0], aliased: true } : null;
    };

    // 전체 이름으로 찾고, 없으면 괄호 밖·안 이름으로 다시 찾는다(사이트 검색은 부분 일치라 괄호가 붙은 이름으로는 안 나오는 경우가 있다).
    const queries = [String(value)];
    if (alias) {
      const label = String(value).trim();
      const inner = label.match(/\(([^)]*)\)\s*$/);
      [label.replace(/\s*\([^)]*\)\s*$/, ''), inner ? inner[1] : ''].forEach((query) => {
        if (query && query.trim().length >= 2 && !queries.includes(query.trim())) queries.push(query.trim());
      });
    }
    let list = null;
    let found = null;
    let seen = [];
    for (const query of queries) {
      list = await search(query);
      if (!list) continue;
      const items = [...list.querySelectorAll('li > button')];
      seen = [...new Set(seen.concat(items.map(dom.textOf).filter((name) => !/등록하기/.test(name))))];
      found = pick(items);
      if (found) break;
    }
    const close = async () => {
      insertText(input, '');
      input.blur();
      await dom.sleep(150);
    };

    let chosen = found && found.item;
    let direct = null;
    if (!chosen && register) {
      // 직접 등록은 입력한 검색어 그대로 등록되므로, 원래 이름으로 다시 검색한 목록에서 고른다.
      list = queries.length > 1 || !list ? await search(String(value)) : list;
      direct = list && [...list.querySelectorAll('li > button')].find((item) => /등록하기/.test(dom.textOf(item)));
      chosen = direct;
    }
    if (!chosen) {
      await close();
      if (!list && !seen.length) return { ok: false, reason: `'${value}' 검색 결과를 불러오지 못했습니다.` };
      return missingOption(seen, [value]);
    }
    const chosenName = chosen === direct ? wanted : nameOf(chosen);
    const chosenLabel = chosen === direct ? String(value) : dom.textOf(chosen);
    chosen.click();
    const shown = await dom.waitFor(
      () => !searchResults(input) && (!input.isConnected || text.normalize(input.value) === chosenName) && text.normalize(dom.textOf(scope)).includes(chosenName),
      { timeout: 2000 }
    );
    if (!shown) return { ok: false, reason: `'${chosenLabel}'을(를) 골랐지만 화면에 반영되지 않았습니다.` };
    if (found && found.aliased) return { ok: true, review: `'${value}'을(를) 목록의 '${chosenLabel}'(으)로 골랐습니다. 같은 항목인지 확인해 주세요.`, detail: chosenLabel };
    if (chosen === direct) {
      const similar = seen.filter((name) => nameVariants(name).some((variant) => nameVariants(value).some((mine) => variant.includes(mine) || mine.includes(variant)))).slice(0, 3);
      const hint = similar.length ? ` 목록의 비슷한 항목: ${similar.map((name) => `'${name}'`).join(', ')}.` : '';
      return register === 'review'
        ? { ok: true, review: `'${value}'이(가) 목록에 없어 직접 등록했습니다. 공식 명칭인지 확인해 주세요.${hint}`, directRegistered: true }
        : { ok: true, detail: `'${value}' 직접 등록`, directRegistered: true };
    }
    return true;
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
    fillToggleGroup,
    fillGreetingAddress,
    fillPostcodify,
    fillButtonDropdown,
    fillSegment,
    segmentSelected,
    fillAddressDialog,
    fillSearchList,
    addressKey,
    fillAntDropdown,
    fillAntDate,
    fillAutocompleteDropdown,
    fillMidasDate,
    fillMidasSearch,
  };
})();
