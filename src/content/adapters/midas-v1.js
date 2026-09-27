/**
 * 마이다스인 새 지원서 화면(/v1/applicant/resume-form) 어댑터.
 *
 * 기존 화면(jQuery·data-loop)과 달리 React + react-hook-form으로 만들어졌다.
 *  - 텍스트 칸: name="basicInfoGroupAnswers.name" 처럼 경로형 name
 *  - 날짜 칸: name 없이 placeholder(YYYY.MM.DD, 입대일, 제대일)만 있는 텍스트 칸
 *  - 버튼형 선택(병역 비대상|군필|…, 장애·보훈 비대상|대상): li > button, 선택된 버튼은 흰 배경 인라인 스타일
 *  - 드롭다운(국적, 계급, 제대구분 …): 버튼을 누르면 검색창과 li > button[value] 항목을 가진 목록이 열린다
 *  - 주소: [주소입력] → 도로명주소 검색 창 → 결과 선택 → [확인]
 *  - URL: [추가하기]로 행을 늘리는 목록
 *
 * 항목 이름은 입력 칸이 아니라 같은 행의 앞쪽 텍스트 요소에 있으므로 조상을 거슬러 올라가며 찾는다.
 * 단계 이동 버튼은 저장을 동반하므로 누르지 않는다.
 */
(function () {
  'use strict';

  const KApply = globalThis.KApply;
  KApply.adapters = KApply.adapters || {};
  if (KApply.adapters.midasV1) return;

  const { dom, text, controls, matcher } = KApply;

  const CONTROL = 'input:not([type="hidden"]), textarea, button, select';

  const NAMED_FIELDS = {
    'basicInfoGroupAnswers.name': 'basic.name',
    'basicInfoGroupAnswers.mobilePhone': 'basic.phone',
    'basicInfoGroupAnswers.email': 'basic.email',
    'basicInfoGroupAnswers.englishName': 'basic.englishName',
  };

  const SECTION = { basic: '기본 정보', military: '병역 · 보훈 · 장애', links: '링크', application: '지원 정보' };

  /** 새 화면인지: 경로 또는 경로형 name */
  function matches(doc = document, loc = location) {
    return /\/v1\/applicant\//.test(loc.pathname) || !!doc.querySelector('[name^="basicInfoGroupAnswers."], [name*="GroupResumeItemAnswers."]');
  }

  function currentStep() {
    const step = Number(new URLSearchParams(location.search).get('step'));
    return Number.isFinite(step) && step > 0 ? step : 1;
  }

  /** 행 제목: 조상을 거슬러 올라가며 컨트롤이 없는 앞쪽 형제의 짧은 텍스트를 찾는다. */
  function rowLabel(element) {
    let node = element;
    for (let depth = 0; depth < 8 && node; depth += 1) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.matches(CONTROL) || sibling.querySelector(CONTROL)) break;
        const value = dom.textOf(sibling);
        if (value && value.length < 40) return text.cleanLabel(value.replace(/\s*\*\s*$/, ''));
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  }

  function visibleControls(selector) {
    return [...document.querySelectorAll(selector)].filter((element) => dom.isVisible(element) && !element.closest('[role="dialog"]'));
  }

  /** 행 제목이 pattern에 맞는 컨트롤 */
  function inRow(pattern, selector = CONTROL) {
    return visibleControls(selector).filter((element) => pattern.test(rowLabel(element)));
  }

  const isSegment = (button) => button.tagName === 'BUTTON' && !!button.parentElement && button.parentElement.tagName === 'LI';

  /** 드롭다운 트리거: li 밖의 단독 버튼 */
  const isDropdown = (button) =>
    button.tagName === 'BUTTON' && button.type === 'button' && !isSegment(button) && button.parentElement && button.parentElement.children.length === 1;

  /** 행 안의 첫 번째 버튼형 선택 묶음 */
  function segmentGroup(pattern) {
    const buttons = inRow(pattern, 'button').filter(isSegment);
    if (!buttons.length) return [];
    const container = buttons[0].parentElement.parentElement;
    return buttons.filter((button) => button.parentElement.parentElement === container);
  }

  const segmentValue = (group) => {
    const selected = group.find(controls.segmentSelected);
    return selected ? dom.textOf(selected) : '';
  };

  // ---------------------------------------------------------------------------
  // 기본 정보
  // ---------------------------------------------------------------------------

  async function fillNamed(session) {
    for (const [name, path] of Object.entries(NAMED_FIELDS)) {
      const input = document.querySelector(`[name="${CSS.escape(name)}"]`);
      if (!input || !dom.isVisible(input) || input.disabled) continue;
      const value = session.textValue(path, input);
      await session.apply({
        section: SECTION.basic,
        label: rowLabel(input) || name,
        value,
        filled: controls.hasValue(input),
        run: () => controls.fillText(input, value),
      });
    }
  }

  async function fillBirthdate(session) {
    const input = inRow(/^생년월일/, 'input[type="text"]')[0];
    if (!input) return;
    const value = text.formatDate(session.get('basic.birthdate'), 'YYYY.MM.DD');
    await session.apply({
      section: SECTION.basic,
      label: '생년월일',
      value,
      filled: controls.hasValue(input),
      run: async () => {
        await controls.fillText(input, value);
        return input.value === value;
      },
    });
  }

  async function fillGender(session) {
    const radios = inRow(/^성별/, 'input[type="radio"]');
    if (!radios.length) return;
    const candidates = session.candidates('basic.gender');
    await session.apply({
      section: SECTION.basic,
      label: '성별',
      value: candidates,
      filled: radios.some((radio) => radio.checked),
      run: async () => {
        // 라디오 name이 선택지명(남/여)이다.
        const index = text.pickOption(
          radios.map((radio) => radio.name || radio.value),
          candidates
        );
        if (index < 0) return controls.fillRadio(radios, candidates);
        if (!radios[index].checked) radios[index].click();
        await dom.sleep(80);
        return radios[index].checked;
      },
    });
  }

  function nationalityCandidates(value) {
    if (text.isBlank(value)) return [];
    if (/^(대한민국|한국|korea|south korea|republic of korea|kr|kor)$/i.test(String(value).trim())) return ['대한민국', '한국'];
    return [String(value)];
  }

  async function fillNationality(session) {
    const trigger = inRow(/^국적/, 'button').find(isDropdown);
    if (!trigger) return;
    await session.apply({
      section: SECTION.basic,
      label: '국적',
      value: nationalityCandidates(session.get('basic.nationality')),
      filled: !/선택해\s*주세요/.test(dom.textOf(trigger)),
      run: () => controls.fillButtonDropdown(trigger, nationalityCandidates(session.get('basic.nationality'))),
    });
  }

  // ---------------------------------------------------------------------------
  // 주소
  // ---------------------------------------------------------------------------

  const addressField = (key) => document.querySelector(`[name="addressGroupResumeItemAnswers.currentAddress.${key}"]`);
  const stripReference = (value) => String(value || '').replace(/\s*\([^)]*\)\s*$/, '');

  async function fillAddress(session) {
    const opener = visibleControls('button').find((button) => dom.textOf(button) === '주소입력');
    const zip = addressField('zipCode');
    const address = addressField('address');
    if (!opener || !address) return;
    const target = {
      postalCode: session.get('basic.postalCode'),
      address: session.get('basic.address'),
      jibunAddress: session.get('basic.jibunAddress'),
    };
    if (text.isBlank(target.address)) {
      if (!text.isBlank(session.get('basic.addressDetail'))) {
        session.manual(SECTION.basic, '주소', '프로필에 도로명 주소가 없습니다. 옵션 화면의 [주소 검색]으로 입력해 주세요.');
      }
      return;
    }
    const status = await session.apply({
      section: SECTION.basic,
      label: '주소',
      value: target.address,
      filled: controls.hasValue(address),
      run: async () => {
        const outcome = await controls.fillAddressDialog(opener, target);
        if (!outcome.ok) return outcome;
        const shown = await dom.waitFor(() => (controls.hasValue(address) ? address.value : null), { timeout: 2000 });
        if (!shown) return { ok: false, reason: '주소를 선택했지만 주소 칸에 반영되지 않았습니다.' };
        if (controls.addressKey(stripReference(shown)) !== controls.addressKey(target.address)) {
          return { ok: false, reason: `입력된 주소(${shown})가 프로필 주소와 다릅니다. 직접 확인해 주세요.` };
        }
        if (target.postalCode && zip && zip.value !== target.postalCode) {
          return { ok: false, reason: `입력된 우편번호(${zip.value || '없음'})가 프로필(${target.postalCode})과 다릅니다. 직접 확인해 주세요.` };
        }
        return { ok: true, detail: zip && zip.value ? `(${zip.value}) ${shown}` : shown };
      },
    });
    if (status === 'failed') return;

    const detail = addressField('detailAddress');
    const detailValue = session.get('basic.addressDetail');
    if (!detail || text.isBlank(detailValue)) return;
    const enabled = await dom.waitFor(() => (!detail.disabled ? detail : null), { timeout: 1500 });
    await session.apply({
      section: SECTION.basic,
      label: '상세 주소',
      value: detailValue,
      filled: controls.hasValue(detail),
      run: async () => (enabled ? controls.fillText(detail, detailValue) : { ok: false, reason: '주소를 선택하기 전에는 상세 주소를 입력할 수 없습니다.' }),
    });
  }

  // ---------------------------------------------------------------------------
  // 병역 · 장애 · 보훈
  // ---------------------------------------------------------------------------

  async function fillSegmentRow(session, { pattern, label, path }) {
    const group = segmentGroup(pattern);
    if (!group.length) return { group, status: null };
    const candidates = session.candidates(path);
    const status = await session.apply({
      section: SECTION.military,
      label,
      value: candidates,
      // 화면이 처음부터 '비대상'을 선택해 두므로 그 상태는 입력 전으로 본다.
      filled: !!segmentValue(group) && segmentValue(group) !== '비대상',
      run: () => controls.fillSegment(group, candidates),
    });
    return { group, status };
  }

  async function fillMilitary(session) {
    const { group } = await fillSegmentRow(session, { pattern: /^병역/, label: '병역 구분', path: 'military.status' });
    if (!group.length) return;
    const chosen = segmentValue(group);
    if (!/군필|복무/.test(chosen)) return;

    const dateFields = [
      ['입대일', 'military.startDate'],
      ['제대일', 'military.endDate'],
    ];
    for (const [placeholder, path] of dateFields) {
      const input = await dom.waitFor(() => visibleControls(`input[placeholder="${placeholder}"]`).find((element) => !element.disabled), { timeout: 1200 });
      const value = text.formatDate(session.get(path), 'YYYY.MM.DD');
      if (!input) {
        if (value) session.manual(SECTION.military, placeholder, '입력 칸이 활성화되지 않았습니다.');
        continue;
      }
      await session.apply({
        section: SECTION.military,
        label: placeholder,
        value,
        filled: controls.hasValue(input),
        run: async () => {
          await controls.fillText(input, value);
          return input.value === value;
        },
      });
    }

    // 계급 · 제대구분 드롭다운은 선택 후 버튼 문구가 바뀌므로 순서로 찾는다.
    const dropdowns = inRow(/^병역/, 'button').filter(isDropdown);
    const plans = [
      [/계급/, '계급', 'military.rank'],
      [/제대|전역/, '제대 구분', 'military.discharge'],
    ];
    for (let index = 0; index < plans.length; index += 1) {
      const [placeholder, label, path] = plans[index];
      const trigger = dropdowns.find((button) => placeholder.test(dom.textOf(button))) || dropdowns[index];
      const candidates = session.candidates(path);
      if (!trigger) {
        if (candidates.length) session.manual(SECTION.military, label, '선택 칸을 찾지 못했습니다.');
        continue;
      }
      await session.apply({
        section: SECTION.military,
        label,
        value: candidates,
        filled: !/선택해\s*주세요/.test(dom.textOf(trigger)),
        run: async () => {
          if (trigger.disabled) return { ok: false, reason: '선택 칸이 비활성화되어 있습니다.' };
          return controls.fillButtonDropdown(trigger, candidates);
        },
      });
    }

    const period = visibleControls('button').filter((button) => /^\d+\s*개월$/.test(dom.textOf(button)));
    if (period.length) session.manual(SECTION.military, '복무 기간', '복무 기간(개월)은 병역 종류마다 기준이 달라 직접 선택해 주세요.');
  }

  async function fillPreferential(session) {
    const rows = [
      { pattern: /^장애/, label: '장애 여부', path: 'military.disability' },
      { pattern: /^보훈/, label: '보훈 여부', path: 'military.veteran' },
    ];
    for (const row of rows) {
      const { group } = await fillSegmentRow(session, row);
      if (group.length && /^대상$/.test(segmentValue(group))) {
        session.manual(SECTION.military, `${row.label} 상세`, '등록번호·정도·유형 등 상세 항목은 증빙과 일치해야 하므로 직접 입력해 주세요.');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // URL · 지원분야 · 첨부
  // ---------------------------------------------------------------------------

  const urlInputs = () => visibleControls('input[name^="etcGroupResumeItemAnswers.socialMediaAnswerList."]').filter((input) => /\.address$/.test(input.name));

  async function fillLinks(session) {
    const adder = inRow(/^URL$/i, 'button').find((button) => /추가하기/.test(dom.textOf(button)));
    if (!adder && !urlInputs().length) return;
    const links = ['portfolio', 'github', 'blog', 'linkedin']
      .map((key) => ({ key, value: String(session.get(`links.${key}`) || '').trim() }))
      .filter((link) => link.value);
    const labels = { portfolio: '포트폴리오', github: 'GitHub', blog: '블로그', linkedin: 'LinkedIn' };
    const present = () => urlInputs().map((input) => text.normalize(input.value));

    for (const link of links) {
      await session.apply({
        section: SECTION.links,
        label: labels[link.key],
        value: link.value,
        filled: present().includes(text.normalize(link.value)),
        run: async () => {
          let input = urlInputs().find((element) => !controls.hasValue(element) && !element.disabled);
          if (!input) {
            if (!adder) return { ok: false, reason: 'URL 행을 추가할 수 없습니다.' };
            const before = urlInputs().length;
            adder.click();
            input = await dom.waitFor(() => {
              const inputs = urlInputs();
              return inputs.length > before ? inputs[inputs.length - 1] : null;
            });
            if (!input) return { ok: false, reason: 'URL 행을 추가하지 못했습니다.' };
          }
          return controls.fillText(input, link.value);
        },
      });
    }
  }

  function checkApplySector(session) {
    const trigger = inRow(/^지원\s*분야/, 'button').find(isDropdown);
    if (trigger && /^신입\s*\/\s*경력$/.test(dom.textOf(trigger))) {
      session.manual(SECTION.application, '지원분야', '지원분야는 직접 선택해 주세요. 선택하지 않으면 다음 단계로 이동할 수 없습니다.');
    }
  }

  async function noticeAttachments(session) {
    const inputs = visibleControls('input[type="file"]').filter((input) => !/사진/.test(rowLabel(input)));
    for (const slot of KApply.schema.FILE_SLOTS) {
      const meta = await session.fileMeta(slot.key);
      if (!meta) continue;
      if (inputs.some((input) => matcher.matchFile(rowLabel(input)) === slot.key)) {
        session.manual('제출 서류', slot.label, `이 화면의 첨부는 아직 자동 업로드를 지원하지 않습니다. '${meta.name}'을(를) 직접 첨부해 주세요.`);
      }
    }
  }

  async function fill(session) {
    if (currentStep() === 1 || document.querySelector('[name^="basicInfoGroupAnswers."]')) {
      await fillNamed(session);
      await fillBirthdate(session);
      await fillGender(session);
      checkApplySector(session);
      await fillMilitary(session);
      await fillPreferential(session);
      await fillAddress(session);
      await fillLinks(session);
      await fillNationality(session);
    } else {
      session.report.notice('이 화면(학력·경력·어학 등)은 마이다스인 새 버전에서 아직 자동 입력을 지원하지 않습니다. 기본정보 단계는 자동 입력됩니다.');
    }
    await noticeAttachments(session);
    session.report.notice('단계를 이동하면 저장됩니다. 입력 결과를 확인한 뒤 [임시저장] 또는 [다음]을 직접 눌러 주세요.');
  }

  KApply.adapters.midasV1 = { id: 'midas', fill, matches, rowLabel, NAMED_FIELDS };
})();
