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

  function selectorFilled(selector) {
    return !PLACEHOLDER_SELECT.test(dom.textOf(selector));
  }

  // ---------------------------------------------------------------------------
  // 단일 항목
  // ---------------------------------------------------------------------------

  async function fillSingle(session, block, label) {
    if (block.querySelector('[class*="AddressInput__"]')) {
      if (session.get('basic.address')) session.manual(SECTION_TITLE.basic, label, '주소 검색 버튼으로 직접 선택해 주세요.');
      return;
    }
    const path = matcher.matchField(label);
    if (!path) return;
    const section = SECTION_TITLE[path.split('.')[0]] || '기타';
    const raw = session.get(path);
    if (text.isBlank(raw)) return;

    const picker = own(block, '.ant-picker input')[0];
    if (picker) {
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
  async function runSubform(block, plan) {
    const selectors = () => own(block, SELECTOR);
    const done = new Set();
    /** @type {Array<{label:string, ok:boolean, review?:string, reason?:string}>} */
    const parts = [];
    const record = (label, value) => parts.push({ label, ...KApply.engine.toOutcome(value) });

    if (plan.top && plan.top.length) {
      const top = selectors()[0];
      if (!top || !(await controls.fillAntDropdown(top, plan.top))) {
        return { ok: false, reason: '구분 선택지를 찾지 못했습니다.' };
      }
      done.add(top);
      await dom.sleep(250);
    }

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
    }

    for (const rule of plan.dates || []) {
      if (text.isBlank(rule.value)) continue;
      const picker = own(block, '.ant-picker input').find((node) => rule.test.test(placeholderOf(node)) && !node.disabled);
      if (picker) record(placeholderOf(picker), await controls.fillAntDate(picker, rule.value));
    }

    for (const rule of plan.texts || []) {
      if (text.isBlank(rule.value)) continue;
      const input = own(block, 'input[type="text"], input:not([type]), input[type="number"], textarea').find(
        (node) => !node.closest('.ant-picker') && rule.test.test(placeholderOf(node)) && !node.disabled
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

    const failures = parts.filter((part) => !part.ok);
    const button = saveButton(block);
    if (!button) return { ok: false, reason: '저장 버튼을 찾지 못했습니다.' };
    if (button.disabled) {
      const cause = failures.map((part) => `${part.label}: ${part.reason || '입력 실패'}`).join(' / ');
      return { ok: false, reason: cause || '필수 항목이 비어 있어 저장할 수 없습니다.' };
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

  async function fillSubformList(session, block, sectionTitle, entries, planFor) {
    for (let index = 0; index < entries.length; index += 1) {
      const plan = planFor(entries[index]);
      const label = `${sectionTitle} ${index + 1}${plan.key ? ` (${plan.key})` : ''}`;
      if (!plan.key) continue;
      if ((block.textContent || '').includes(plan.key)) {
        session.report.add(STATUS.SKIPPED, sectionTitle, label, '이미 입력됨');
        continue;
      }
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
        const remaining = entries.length - index - 1;
        if (remaining > 0) {
          session.manual(sectionTitle, `${sectionTitle} ${index + 2}~${entries.length}`, `위 항목을 먼저 저장해야 해서 나머지 ${remaining}건은 입력하지 않았습니다. 해결 후 다시 실행해 주세요.`);
        }
        break;
      }
    }
  }

  const PLANS = {
    educations(entry) {
      return {
        key: entry.school,
        top: text.candidatesFor('educationLevel', entry.level),
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
          { test: /점수/, value: entry.score },
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
        { test: /병역|구분/, candidates: text.candidatesFor('militaryStatus', military.status) },
        { test: /군별|군\s*종류/, candidates: [military.branch] },
        { test: /계급/, candidates: [military.rank] },
        { test: /제대|전역\s*구분/, candidates: [military.discharge] },
      ],
      dates: [
        { test: /입대|시작/, value: military.startDate },
        { test: /전역|제대|종료/, value: military.endDate },
      ],
      texts: [{ test: /면제/, value: military.exemptionReason }],
    };
  }

  async function fillListBlock(session, block, label) {
    if (/학력/.test(label)) {
      await fillSubformList(session, block, '학력', session.list('educations'), PLANS.educations);
    } else if (/경력/.test(label) && !/유무|여부/.test(label)) {
      await fillSubformList(session, block, '경력', session.list('careers'), PLANS.careers);
    } else if (/자격|수상|면허/.test(label)) {
      if (/자격|면허/.test(label)) await fillSubformList(session, block, '자격증', session.list('certificates'), PLANS.certificates);
      if (/수상/.test(label)) await fillSubformList(session, block, '수상', session.list('awards'), PLANS.awards);
    } else if (/어학|외국어/.test(label)) {
      await fillSubformList(session, block, '어학', session.list('languages'), PLANS.languages);
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
