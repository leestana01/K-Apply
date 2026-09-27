/**
 * 나인하이어(ninehire) 지원서 어댑터.
 *
 * 나인하이어 지원서는 styled-components + Ant Design 기반이며 입력 요소에 name 속성이 없다.
 * 항목마다 ApplicationFormInput__Layout 블록이 있고, 블록 제목(EditableLabel__Input)으로 의미를 판별한다.
 *
 * 학력·경력·자격증/수상·어학 같은 일반 항목은 "하위 입력 폼 → [입력사항 저장]" 방식으로 한 건씩 추가된다.
 */
(function () {
  'use strict';

  const KApply = globalThis.KApply;
  KApply.adapters = KApply.adapters || {};
  if (KApply.adapters.ninehire) return;

  const { dom, text, controls, matcher } = KApply;
  const { STATUS } = KApply.engine;

  const BLOCK = '[class*="ApplicationFormInput__Layout"]';
  const LABEL = '[class*="EditableLabel__Input"]';
  const SELECTOR = '[class*="Selector__Container"]';
  const FILE_BUTTON = '[class*="FileUploadInput__InputButton"]';
  const SAVE_TEXT = '입력사항 저장';

  const SECTION_TITLE = {
    basic: '기본 정보',
    links: '링크',
    application: '지원 정보',
    military: '병역',
    documents: '제출 서류',
  };

  const FILE_NAME_PATTERN = /\.(pdf|docx?|hwpx?|pptx?|xlsx?|zip|png|jpe?g|key)\b/i;
  const PLACEHOLDER_SELECT = /선택/;

  function blockLabel(block) {
    const label = block.querySelector(LABEL);
    return text.cleanLabel(label ? label.textContent : '');
  }

  function saveButton(block) {
    return [...block.querySelectorAll('button')].find((button) => dom.textOf(button) === SAVE_TEXT) || null;
  }

  /** 입력 요소가 속한 블록이 현재 블록인지(중첩 블록 방지) */
  function ownedBy(block, element) {
    return element.closest(BLOCK) === block;
  }

  function own(block, selector) {
    return [...block.querySelectorAll(selector)].filter((element) => ownedBy(block, element) && dom.isVisible(element));
  }

  /**
   * 선택 칸의 안내 문구(예: "병역구분", "선택해주세요.")는 회색 color 속성이 붙은 span으로 표시된다.
   * 선택되면 color 속성이 없는 span으로 바뀐다.
   */
  function selectorFilled(selector) {
    const label = selector.querySelector('span');
    if (!label) return !PLACEHOLDER_SELECT.test(dom.textOf(selector));
    return !label.hasAttribute('color');
  }

  // ---------------------------------------------------------------------------
  // 단일 항목
  // ---------------------------------------------------------------------------

  async function fillSingle(session, block, label) {
    if (block.querySelector('[class*="AddressInput__"]')) {
      await fillAddress(session, block, label);
      return;
    }
    const path = matcher.matchField(label);
    if (!path) return;
    const section = SECTION_TITLE[path.split('.')[0]] || '기타';
    const raw = session.get(path);
    if (text.isBlank(raw)) return;

    const picker = own(block, '.ant-picker input')[0];
    if (picker) {
      if (!text.parseDate(raw)) {
        session.manual(section, label, `날짜를 고르는 칸인데 프로필 값('${raw}')이 날짜가 아닙니다. 날짜(예: 2026-10-01)로 저장하거나 직접 선택해 주세요.`);
        return;
      }
      await session.apply({ section, label, value: raw, filled: controls.hasValue(picker), run: () => controls.fillAntDate(picker, raw) });
      return;
    }
    const selector = own(block, SELECTOR)[0];
    if (selector) {
      const status = await session.apply({
        section,
        label,
        value: raw,
        filled: selectorFilled(selector),
        run: () => controls.fillAntDropdown(selector, session.candidates(path)),
      });
      // 병역 구분을 고르면 군별·계급·기간 등이 나타난다.
      if (path === 'military.status' && status !== STATUS.FAILED) {
        await dom.sleep(300);
        const parts = await fillPlan(block, militaryPlan(session), new Set([selector]));
        parts.forEach((part) =>
          session.report.add(part.ok ? (part.review ? STATUS.REVIEW : STATUS.FILLED) : STATUS.FAILED, section, `${label} · ${part.label}`, part.reason || part.review || '')
        );
        return;
      }
      // "기타" 등을 고르면 상세 입력칸이 새로 나타난다. 내용은 알 수 없으므로 사용자에게 맡긴다.
      await dom.sleep(150);
      const detail = own(block, 'input[type="text"], input:not([type]), textarea').find((node) => !controls.hasValue(node));
      if (status === STATUS.FILLED && detail) session.manual(section, `${label} 상세`, `'${dom.textOf(selector)}' 선택 시 나타난 입력칸을 직접 채워 주세요.`);
      return;
    }
    const radios = own(block, 'input[type="radio"]');
    if (radios.length) {
      await session.apply({
        section,
        label,
        value: raw,
        filled: radios.some((radio) => radio.checked),
        run: () => controls.fillRadio(radios, session.candidates(path)),
      });
      return;
    }
    const input = own(block, 'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"]')[0];
    if (input) {
      const value = session.textValue(path, input);
      await session.apply({ section, label, value, filled: controls.hasValue(input), run: () => controls.fillText(input, value) });
    }
  }

  function stem(name) {
    return String(name).replace(/\.[^.]+$/, '');
  }

  /**
   * 주소지(카카오 우편번호 위젯): 검색 버튼을 누르면 위젯 대신 저장된 주소를 선택 결과로 전달한다.
   * 나인하이어는 위젯 결과 중 우편번호·도로명·지번 주소만 사용한다.
   */
  async function fillAddress(session, block, label) {
    const section = SECTION_TITLE.basic;
    const zip = session.get('basic.postalCode');
    const road = session.get('basic.address');
    if (text.isBlank(zip) || text.isBlank(road)) {
      if (!text.isBlank(zip) || !text.isBlank(road)) {
        session.manual(section, label, '프로필에 우편번호와 도로명 주소가 모두 있어야 합니다. 옵션 화면의 [주소 검색]으로 입력해 주세요.');
      }
      return;
    }
    const button = own(block, 'button').find((node) => /검색/.test(dom.textOf(node)));
    const shown = () => (block.textContent || '').replace(/\s+/g, '');
    const filled = /\d{5}/.test(own(block, '[class*="AddressInput__DivLikeInput"]').map(dom.textOf).join(' '));
    const status = await session.apply({
      section,
      label,
      value: road,
      filled,
      run: async () => {
        if (!button) return { ok: false, reason: '주소 검색 버튼을 찾지 못했습니다.' };
        const outcome = await KApply.engine.postcodeViaBridge(button, {
          zonecode: text.digitsOnly(zip),
          roadAddress: road,
          jibunAddress: session.get('basic.jibunAddress') || '',
          address: road,
          addressType: 'R',
          userSelectedType: 'R',
          autoRoadAddress: '',
          autoJibunAddress: '',
          buildingName: '',
          apartment: 'N',
        });
        if (!outcome.ok) return outcome;
        const content = shown();
        const ok = content.includes(text.digitsOnly(zip)) && content.includes(road.replace(/\s+/g, ''));
        return ok ? { ok: true } : { ok: false, reason: '선택한 주소가 화면에 반영되지 않았습니다.' };
      },
    });
    const detail = session.get('basic.addressDetail');
    if (!detail || status === STATUS.FAILED) return;
    const input = await dom.waitFor(() =>
      own(block, 'input[type="text"], input:not([type])').find((node) => !node.readOnly && !node.disabled && /상세|나머지/.test(placeholderOf(node)))
    );
    if (input) {
      await session.apply({ section, label: `${label} · 상세 주소`, value: detail, filled: controls.hasValue(input), run: () => controls.fillText(input, detail) });
    } else {
      session.manual(section, `${label} · 상세 주소`, '상세 주소 입력칸을 찾지 못했습니다. 직접 입력해 주세요.');
    }
  }

  async function fillDocument(session, block, label) {
    const slot = matcher.matchFile(label);
    if (!slot || !(await session.fileMeta(slot))) return;
    const trigger = own(block, FILE_BUTTON)[0];
    const input = block.querySelector('input[type="file"]');
    if (!trigger && !input) return;
    // 이미 첨부된 파일은 교체 방법이 공고마다 달라 덮어쓰기 설정과 관계없이 유지한다.
    if (FILE_NAME_PATTERN.test(block.textContent || '')) {
      session.report.add(STATUS.SKIPPED, SECTION_TITLE.documents, label, '이미 첨부된 파일이 있음 (교체하려면 직접 삭제 후 다시 실행)');
      return;
    }
    await session.applyFile({
      section: SECTION_TITLE.documents,
      label,
      slot,
      input,
      trigger,
      hint: dom.textOf(block.children[0]) + ' ' + dom.textOf(own(block, FILE_BUTTON)[0]),
      rejected: () => (/업로드\s*실패|실패했습니다|지원하지 않는\s*(파일|형식)|용량을\s*초과/.test(block.textContent || '') ? '나인하이어가 파일을 거부했습니다. 형식·용량을 확인해 주세요.' : null),
      confirm: (record) => {
        const content = block.textContent || '';
        if (/업로드\s*실패|오류|실패했|지원하지 않는/.test(content)) return '나인하이어가 파일을 거부했습니다. 형식·용량을 확인해 주세요.';
        return content.includes(record.name) || content.includes(stem(record.name)) ? true : '화면에 첨부된 파일이 표시되지 않았습니다.';
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 하위 입력 폼(반복 항목)
  // ---------------------------------------------------------------------------

  /**
   * @typedef {object} SubformPlan
   * @property {string[]} [top]           첫 번째 선택(구분) 후보
   * @property {string} key               저장 여부 확인용 대표값
   * @property {Array<{test:RegExp, candidates:string[]}>} [selects]
   * @property {Array<{test:RegExp, value:string}>} [dates]
   * @property {Array<{test:RegExp, value:string}>} [texts]
   * @property {Array<{test:RegExp, checked:boolean}>} [checks]
   */

  function placeholderOf(element) {
    return element.getAttribute('placeholder') || '';
  }

  function checkboxLabel(checkbox) {
    const container = checkbox.closest('[class*="CheckboxBtn__Container"]');
    const sibling = container && container.nextElementSibling;
    return sibling ? dom.textOf(sibling) : dom.labelOf(checkbox);
  }

  /**
   * 하위 입력 폼을 채우고 [입력사항 저장]을 누른다.
   * @returns {{ok:boolean, reason?:string, review?:string}}
   */
  /**
   * 계획(plan)에 따라 블록 안의 체크박스·선택·날짜·텍스트를 채운다. 저장 버튼은 누르지 않는다.
   * @param {Set<HTMLElement>} done 이미 처리한 선택 컨트롤
   * @returns {Promise<Array<{label:string, ok:boolean, review?:string, reason?:string}>>}
   */
  async function fillPlan(block, plan, done = new Set()) {
    const selectors = () => own(block, SELECTOR);
    const parts = [];
    const record = (label, value) => parts.push({ label, ...KApply.engine.toOutcome(value) });

    for (const rule of plan.checks || []) {
      const checkbox = own(block, 'input[type="checkbox"]').find((node) => rule.test.test(checkboxLabel(node)));
      if (checkbox) record(checkboxLabel(checkbox), await controls.fillCheckbox(checkbox, rule.checked));
    }

    for (const rule of plan.selects || []) {
      if (!rule.candidates.filter(Boolean).length) continue;
      const selector = selectors().find((node) => !done.has(node) && rule.test.test(dom.textOf(node)));
      if (!selector) continue;
      done.add(selector);
      const label = dom.textOf(selector);
      record(label, await controls.fillAntDropdown(selector, rule.candidates));
      await dom.sleep(150);
    }

    for (const rule of plan.dates || []) {
      if (text.isBlank(rule.value)) continue;
      const picker = own(block, '.ant-picker input').find((node) => rule.test.test(placeholderOf(node)) && !node.disabled);
      if (picker) record(placeholderOf(picker), await controls.fillAntDate(picker, rule.value));
    }

    for (const rule of plan.texts || []) {
      if (text.isBlank(rule.value)) continue;
      const input = own(block, 'input[type="text"], input:not([type]), input[type="number"], textarea').find(
        (node) => !node.closest('.ant-picker') && rule.test.test(placeholderOf(node)) && !node.disabled && !node.readOnly
      );
      if (!input) continue;
      const label = placeholderOf(input);
      // "…검색" 칸은 코드 목록(학교·전공)에서 골라야 값이 확정된다.
      if (rule.lookup || /검색/.test(label)) {
        record(label, await controls.fillAutocompleteDropdown(input, rule.value, rule.lookup || { reviewDirect: true }));
      } else {
        record(label, await controls.fillText(input, rule.value));
      }
    }
    return parts;
  }

  /**
   * 하위 입력 폼을 채우고 [입력사항 저장]을 누른다.
   * @returns {{ok:boolean, reason?:string, review?:string}}
   */
  async function runSubform(block, plan) {
    const selectors = () => own(block, SELECTOR);
    const done = new Set();

    if (plan.top && plan.top.length) {
      const top = selectors()[0];
      if (!top || !(await controls.fillAntDropdown(top, plan.top))) {
        return { ok: false, reason: '구분 선택지를 찾지 못했습니다.' };
      }
      done.add(top);
      await dom.sleep(250);
    }

    const parts = await fillPlan(block, plan, done);
    const failures = parts.filter((part) => !part.ok);
    const button = saveButton(block);
    if (!button) return { ok: false, reason: '저장 버튼을 찾지 못했습니다.' };
    if (button.disabled) {
      const cause = failures.map((part) => `${part.label}: ${part.reason || '입력 실패'}`).join(' / ');
      if (cause) return { ok: false, reason: cause };
      // 프로필에 값이 없어 비어 있는 칸을 알려 준다(나인하이어는 전공 등을 필수로 요구할 수 있다).
      const empty = own(block, 'input[type="text"], input:not([type]), textarea')
        .filter((node) => !node.disabled && !controls.hasValue(node) && placeholderOf(node))
        .map(placeholderOf);
      const emptySelects = selectors().filter((node) => !done.has(node) && !selectorFilled(node)).map(dom.textOf);
      const blanks = [...emptySelects, ...empty];
      return { ok: false, reason: blanks.length ? `필수 항목이 비어 있어 저장할 수 없습니다. 비어 있는 칸: ${blanks.join(', ')}` : '필수 항목이 비어 있어 저장할 수 없습니다.' };
    }
    button.click();
    const saved = await dom.waitFor(() => (block.textContent || '').includes(plan.key), { timeout: 2000 });
    if (!saved) return { ok: false, reason: '저장되지 않았습니다. 필수 항목을 확인해 주세요.' };

    const notes = [
      ...failures.map((part) => `${part.label}: ${part.reason || '입력 실패'}`),
      ...parts.filter((part) => part.ok && part.review).map((part) => `${part.label}: ${part.review}`),
    ];
    return notes.length ? { ok: true, review: notes.join(' / ') } : { ok: true };
  }

  /** @returns {Promise<boolean>} 모든 항목을 저장했거나 건너뛰었으면 true, 저장 실패로 중단했으면 false */
  async function fillSubformList(session, block, sectionTitle, entries, planFor, sourceId) {
    const present = (entry) => {
      const key = planFor(entry).key;
      return !!key && (block.textContent || '').includes(key);
    };
    const saved = entries.filter(present);
    saved.forEach((entry) => session.report.add(STATUS.SKIPPED, sectionTitle, planFor(entry).key, '이미 입력됨'));
    const pending = entries.filter((entry) => planFor(entry).key && !present(entry));

    // 받는 개수는 공고마다 다르다. 항목 안내 문구("최대 3개" 등)가 있으면 이미 저장된 것을 포함해 그 수까지만 넣는다.
    // 우선순위(목록 순서)로 넣을 항목을 고르고, 고른 항목은 날짜순으로 저장한다.
    const limit = dom.countLimitOf(block);
    const room = limit ? Math.max(0, limit - saved.length) : pending.length;
    session.overflow(sectionTitle, sourceId, pending.slice(room), limit || undefined);
    const chosen = session.chronological(sourceId, pending.slice(0, room));

    for (let index = 0; index < chosen.length; index += 1) {
      const plan = planFor(chosen[index]);
      const label = `${sectionTitle} ${index + 1} (${plan.key})`;
      let outcome;
      try {
        outcome = await runSubform(block, plan);
      } catch (error) {
        outcome = { ok: false, reason: error.message };
      }
      const status = !outcome.ok ? STATUS.FAILED : outcome.review ? STATUS.REVIEW : STATUS.FILLED;
      session.report.add(status, sectionTitle, label, outcome.reason || outcome.review || '');
      // 저장에 실패하면 하위 폼에 값이 남아 있으므로 다음 항목을 이어서 넣지 않는다(값이 섞이는 것을 방지).
      if (!outcome.ok) {
        const remaining = chosen.length - index - 1;
        if (remaining > 0) {
          session.manual(sectionTitle, `나머지 ${remaining}건`, `위 항목을 먼저 저장해야 해서 나머지 ${remaining}건은 입력하지 않았습니다. 해결 후 다시 실행해 주세요.`);
        }
        return false;
      }
    }
    return true;
  }


  const PLANS = {
    educations(entry) {
      return {
        key: entry.school,
        top: text.candidatesFor('educationLevel', entry.level),
        checks: [
          ...(entry.entryType ? [{ test: /편입/, checked: entry.entryType === '편입' }] : []),
          ...(entry.dayNight ? [{ test: /야간/, checked: entry.dayNight === '야간' }] : []),
        ],
        selects: [
          { test: /졸업\s*(상태|구분|여부)/, candidates: [entry.status] },
          { test: /기준\s*학점|만점/, candidates: entry.gpa ? [entry.gpaScale] : [] },
        ],
        dates: [
          { test: /입학/, value: entry.startDate },
          { test: /졸업/, value: entry.endDate },
        ],
        texts: [
          { test: /학교/, value: entry.school, lookup: { campus: entry.campus, reviewDirect: true } },
          { test: /^주전공|^전공/, value: entry.major },
          { test: /부전공/, value: entry.minor },
          { test: /복수\s*전공/, value: entry.doubleMajor },
          { test: /학점/, value: entry.gpa },
        ],
      };
    },
    careers(entry) {
      return {
        key: entry.company,
        checks: [{ test: /재직/, checked: entry.current === true }],
        selects: [{ test: /고용\s*형태/, candidates: [entry.employmentType] }],
        dates: [
          { test: /입사|시작/, value: entry.startDate },
          { test: /퇴사|종료/, value: entry.current ? '' : entry.endDate },
        ],
        texts: [
          { test: /회사/, value: entry.company },
          { test: /직급|직책|직위/, value: entry.position },
          { test: /부서/, value: entry.department },
          { test: /담당|업무/, value: entry.duties },
          { test: /연봉|급여/, value: text.digitsOnly(entry.salary) },
          { test: /퇴사\s*사유|이직|퇴직\s*사유/, value: entry.resignReason },
        ],
      };
    },
    certificates(entry) {
      return {
        key: entry.name,
        top: ['자격증', '자격', '면허'],
        selects: [],
        dates: [{ test: /취득|발행|일자|날짜/, value: entry.date }],
        texts: [
          { test: /자격|명칭|이름/, value: entry.name },
          { test: /발행|기관|시행/, value: entry.issuer },
          { test: /번호/, value: entry.number },
          { test: /점수|등급/, value: entry.grade },
        ],
      };
    },
    awards(entry) {
      return {
        key: entry.name,
        top: ['수상', '수상경력', '수상내역'],
        dates: [{ test: /수상|일자|날짜/, value: entry.date }],
        texts: [
          { test: /수상|명칭|이름|대회/, value: entry.name },
          { test: /기관|주최|수여/, value: entry.issuer },
          { test: /내용|내역|설명/, value: entry.description },
        ],
      };
    },
    languages(entry) {
      return {
        key: entry.test || entry.language,
        top: [entry.test, entry.language].filter(Boolean),
        selects: [{ test: /등급|급수|레벨/, candidates: [entry.grade] }],
        dates: [{ test: /취득|응시|발행|일자|날짜/, value: entry.date }],
        texts: [
          { test: /시험/, value: entry.test },
          { test: /주최|주관|기관/, value: entry.issuer },
          { test: /점수/, value: entry.score || entry.grade },
          { test: /등급|급수/, value: entry.grade },
          { test: /번호/, value: entry.number },
        ],
      };
    },
  };

  function militaryPlan(session) {
    const military = session.profile.military;
    return {
      key: '',
      selects: [
        { test: /병역\s*구분|^병역/, candidates: text.candidatesFor('militaryStatus', military.status) },
        { test: /복무\s*구분|역종|복무\s*형태/, candidates: [military.serviceType] },
        { test: /군별|군\s*종류/, candidates: [military.branch] },
        { test: /계급/, candidates: [military.rank] },
        { test: /제대|전역\s*구분/, candidates: [military.discharge] },
      ],
      dates: [
        { test: /입대|시작/, value: military.startDate },
        { test: /전역|제대|종료/, value: military.endDate },
      ],
      texts: [
        { test: /면제/, value: military.exemptionReason },
        { test: /병과|특기/, value: military.specialty },
      ],
    };
  }

  async function fillListBlock(session, block, label) {
    if (/학력/.test(label)) {
      await fillSubformList(session, block, '학력', session.list('educations'), PLANS.educations, 'educations');
    } else if (/경력/.test(label) && !/유무|여부/.test(label)) {
      await fillSubformList(session, block, '경력', session.list('careers'), PLANS.careers, 'careers');
    } else if (/자격|수상|면허/.test(label)) {
      // 자격증과 수상이 같은 하위 폼을 쓰므로, 앞 목록 저장이 실패하면 값이 섞이지 않게 멈춘다.
      let ok = true;
      if (/자격|면허/.test(label)) ok = await fillSubformList(session, block, '자격증', session.list('certificates'), PLANS.certificates, 'certificates');
      if (/수상/.test(label)) {
        if (ok) await fillSubformList(session, block, '수상', session.list('awards'), PLANS.awards, 'awards');
        else if (session.list('awards').length) session.manual('수상', '수상', '같은 입력 폼의 자격증 항목을 먼저 저장해야 해서 입력하지 않았습니다. 해결 후 다시 실행해 주세요.');
      }
    } else if (/어학|외국어/.test(label)) {
      await fillSubformList(session, block, '어학', session.list('languages'), PLANS.languages, 'languages');
    } else if (/병역/.test(label) && session.profile.military.status) {
      const outcome = await runSubform(block, militaryPlan(session)).catch((error) => ({ ok: false, reason: error.message }));
      const status = !outcome.ok ? STATUS.FAILED : outcome.review ? STATUS.REVIEW : STATUS.FILLED;
      session.report.add(status, SECTION_TITLE.military, label, outcome.reason || outcome.review || '');
    }
  }

  // ---------------------------------------------------------------------------

  async function fill(session) {
    const blocks = [...document.querySelectorAll(BLOCK)].filter((block) => !block.parentElement.closest(BLOCK));
    for (const block of blocks) {
      const label = blockLabel(block);
      if (!label) continue;
      if (block.querySelector(FILE_BUTTON) || block.querySelector('input[type="file"]')) {
        await fillDocument(session, block, label);
      } else if (saveButton(block)) {
        await fillListBlock(session, block, label);
      } else {
        await fillSingle(session, block, label);
      }
    }
    session.report.notice('자기소개 등 서술형 문항과 개인정보 동의는 직접 확인 후 제출해 주세요.');
  }

  KApply.adapters.ninehire = { id: 'ninehire', fill, PLANS };
})();
