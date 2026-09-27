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
  const { STATUS } = KApply.engine;

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

  function visibleControls(selector, scope = document) {
    return [...scope.querySelectorAll(selector)].filter((element) => dom.isVisible(element) && !element.closest('[role="dialog"]'));
  }

  /** 행 제목이 pattern에 맞는 컨트롤 */
  function inRow(pattern, selector = CONTROL, scope = document) {
    return visibleControls(selector, scope).filter((element) => pattern.test(rowLabel(element)));
  }

  /** 버튼형 선택: li > button. 드롭다운·검색 결과 목록(ul > li)의 항목은 제외한다. */
  const isSegment = (button) =>
    button.tagName === 'BUTTON' && !!button.parentElement && button.parentElement.tagName === 'LI' && button.parentElement.parentElement.tagName !== 'UL';

  /** 드롭다운 트리거: li 밖의 단독 버튼 */
  const isDropdown = (button) =>
    button.tagName === 'BUTTON' && button.type === 'button' && !isSegment(button) && button.parentElement && button.parentElement.children.length === 1;

  /** 행 안의 버튼형 선택 묶음. option을 주면 그 선택지를 가진 묶음을 고른다(한 행에 묶음이 여럿일 때). */
  function segmentGroup(pattern, { scope = document, option = null } = {}) {
    const buttons = inRow(pattern, 'button', scope).filter(isSegment);
    const groups = new Map();
    for (const button of buttons) {
      const container = button.parentElement.parentElement;
      if (!groups.has(container)) groups.set(container, []);
      groups.get(container).push(button);
    }
    const list = [...groups.values()];
    if (!option) return list[0] || [];
    return list.find((group) => group.some((button) => option.test(dom.textOf(button)))) || [];
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
    if (status === STATUS.FAILED) return;

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

  // ---------------------------------------------------------------------------
  // 2단계: 학력 · 경력 (항목 블록)
  // ---------------------------------------------------------------------------

  /**
   * "+ 고등학교" 같은 추가 버튼으로 만드는 항목 블록.
   * 블록 머리글은 "- 고등학교" 텍스트이고, 머리글에서 조상으로 올라가며 marker 입력칸을 처음 포함하는 요소가 블록이다.
   */
  const BLOCKS = {
    highschool: { name: '고등학교', marker: 'input[placeholder="입학일"]', title: '고등학교' },
    college: { name: '대학교', marker: 'input[placeholder="입학일"]', title: '대학교' },
    graduate: { name: '대학원', marker: 'input[placeholder="입학일"]', title: '대학원' },
    career: { name: '직장경력', marker: 'input[placeholder="입사일"]', title: '경력' },
  };

  const SCHOOL_SEARCH = 'input[placeholder^="학교명을 검색"]';
  const MAJOR_SEARCH = 'input[placeholder^="전공명을 검색"]';
  const COMPANY_SEARCH = 'input[placeholder^="회사명을"]';

  function blocksOf(kind) {
    const { name, marker } = BLOCKS[kind];
    return [...document.querySelectorAll('p')]
      .filter((node) => dom.textOf(node) === `- ${name}`)
      .map((header) => {
        let node = header.parentElement;
        while (node && !node.querySelector(marker)) node = node.parentElement;
        return node;
      })
      .filter(Boolean);
  }

  /**
   * 블록 안의 행: 제목 텍스트 요소에서 조상으로 올라가며 입력 컨트롤을 처음 포함하는 요소.
   * 블록 안에서는 선택한 학교명·"/" 같은 텍스트가 컨트롤 앞에 끼어 있어 컨트롤 기준의 rowLabel을 쓰지 않는다.
   */
  function rowIn(block, pattern) {
    const title = [...block.querySelectorAll('p, span')].find(
      (node) => !node.querySelector(CONTROL) && pattern.test(text.cleanLabel(dom.textOf(node).replace(/\s*\*\s*$/, '')))
    );
    let node = title && title.parentElement;
    while (node && node !== block.parentElement && !node.querySelector(CONTROL)) node = node.parentElement;
    return node && node !== block.parentElement ? node : null;
  }

  /** 블록 안 행의 버튼형 선택 묶음 */
  function segmentIn(block, pattern, option = null) {
    const row = rowIn(block, pattern);
    return row ? segmentGroup(/.*/, { scope: row, option }) : [];
  }

  /** 블록 안 행의 선택 버튼(드롭다운 트리거): 버튼형 선택·추가 버튼이 아닌 button */
  function pickerIn(pattern, block) {
    const row = rowIn(block, pattern);
    if (!row) return null;
    return visibleControls('button', row).find(
      (button) => button.type === 'button' && !isSegment(button) && !button.closest('ul') && !/추가하기|^\d+\s*(년|개월|학기)$/.test(dom.textOf(button))
    );
  }

  const adderOf = (kind) =>
    visibleControls('button').find((button) => new RegExp(`^\\+?\\s*${BLOCKS[kind].name}\\s*\\*?$`).test(dom.textOf(button)));

  async function addBlock(kind) {
    const adder = adderOf(kind);
    if (!adder || adder.disabled) return null;
    const before = blocksOf(kind);
    adder.click();
    return dom.waitFor(() => blocksOf(kind).find((block) => !before.includes(block)) || null, { timeout: 2000 });
  }

  /** 월 단위 종료일은 그 달의 마지막 날로 입력한다(예: 2020-02 → 2020.02.29). */
  function endDate(value) {
    const parsed = text.parseDate(value);
    if (!parsed) return '';
    if (parsed.d) return text.formatDate(value, 'YYYY.MM.DD');
    const last = new Date(parsed.y, parsed.m, 0).getDate();
    return `${parsed.y}.${String(parsed.m).padStart(2, '0')}.${String(last).padStart(2, '0')}`;
  }

  async function applyDate(session, { section, label, input, value }) {
    if (!input) {
      if (value) session.manual(section, label, '입력 칸을 찾지 못했습니다.');
      return;
    }
    await session.apply({
      section,
      label,
      value,
      filled: controls.hasValue(input),
      run: async () => {
        if (input.disabled) return { ok: false, reason: '입력 칸이 비활성화되어 있습니다.' };
        await controls.fillText(input, value);
        return input.value === value || { ok: false, reason: `날짜가 반영되지 않았습니다(입력값 ${input.value || '없음'}).` };
      },
    });
  }

  async function applySegment(session, { section, label, group, candidates }) {
    if (!group.length || !candidates.length) return;
    await session.apply({
      section,
      label,
      value: candidates,
      run: () => controls.fillSegment(group, candidates),
    });
  }

  async function applyDropdown(session, { section, label, trigger, candidates }) {
    if (!trigger || !candidates.length) return;
    await session.apply({
      section,
      label,
      value: candidates,
      filled: !/선택해\s*주세요|^만점기준$/.test(dom.textOf(trigger)),
      run: async () => {
        const enabled = await dom.waitFor(() => (!trigger.disabled ? trigger : null), { timeout: 1500 });
        if (!enabled) return { ok: false, reason: '선택 칸이 비활성화되어 있습니다.' };
        return controls.fillButtonDropdown(trigger, candidates);
      },
    });
  }

  async function applyText(session, { section, label, input, value }) {
    if (!input || text.isBlank(value)) return;
    const typed = String(value).trim();
    await session.apply({ section, label, value: typed, filled: controls.hasValue(input), run: () => controls.fillText(input, typed) });
  }

  /** 블록이 이미 채워졌는지: 검색 칸이 선택한 이름으로 바뀌었으면 입력된 것으로 본다. */
  const blockFilled = (block, search) => !block.querySelector(search);

  /** 목록 항목을 어느 블록에 넣을지: 같은 이름이 이미 있으면 건너뛰고, 빈 블록을 먼저 쓰고, 없으면 추가한다. */
  async function blockFor(session, kind, name, search, used) {
    const section = BLOCKS[kind].title;
    const blocks = blocksOf(kind);
    const same = blocks.find((block) => blockFilled(block, search) && text.normalize(dom.textOf(block)).includes(text.normalize(name)));
    if (same) {
      used.add(same);
      session.report.add(STATUS.SKIPPED, section, name, '이미 입력됨');
      return null;
    }
    const empty = blocks.find((block) => !used.has(block) && !blockFilled(block, search));
    const block = empty || (await addBlock(kind));
    if (!block) {
      session.manual(section, name, '항목을 추가하지 못했습니다(최대 개수를 넘었거나 추가 버튼이 없음). 직접 입력해 주세요.');
      return null;
    }
    used.add(block);
    return block;
  }

  const DEGREE = { university: ['학사'], college: ['전문학사'], master: ['석사'], doctor: ['박사', '석박사통합'] };
  const STATUS_CANDIDATES = {
    졸업: ['졸업'],
    졸업예정: ['졸업예정', '재학'],
    재학: ['재학', '졸업예정'],
    휴학: ['휴학'],
    수료: ['수료'],
    중퇴: ['중퇴', '자퇴'],
  };
  const regionCandidates = (region) => (text.isBlank(region) || region === '해외' ? [] : [region]);

  async function fillSchoolBlock(session, block, entry, kind) {
    const section = `${BLOCKS[kind].title} · ${entry.school}`;
    if (kind !== 'highschool') {
      await applySegment(session, { section, label: '학위 구분', group: segmentIn(block, /^학위\s*구분/), candidates: DEGREE[entry.level] || [] });
    }

    const search = block.querySelector(SCHOOL_SEARCH);
    const status = await session.apply({
      section,
      label: '학교명',
      value: entry.school,
      filled: !search,
      run: () => controls.fillSearchList(search, entry.school, { scope: block, register: 'review' }),
    });
    if (status === STATUS.FAILED) return;

    await applyDropdown(session, {
      section,
      label: '소재지',
      trigger: pickerIn(/^학교\s*정보/, block),
      candidates: regionCandidates(entry.region),
    });
    if (entry.campusType) {
      await applySegment(session, {
        section,
        label: '본교 / 분교',
        group: segmentIn(block, /^학교\s*정보/, /본교|분교/),
        candidates: entry.campusType === '제2캠퍼스' ? ['분교'] : [entry.campusType],
      });
    }
    if (kind === 'highschool' && entry.dayNight) {
      await applySegment(session, { section, label: '주간 / 야간', group: segmentIn(block, /^학교\s*정보/, /주간|야간/), candidates: [entry.dayNight] });
    }

    await applyDate(session, { section, label: '입학일', input: block.querySelector('input[placeholder="입학일"]'), value: text.formatDate(entry.startDate, 'YYYY.MM.DD') });
    await applyDate(session, { section, label: '졸업일', input: block.querySelector('input[placeholder="졸업일"]'), value: endDate(entry.endDate) });
    await applySegment(session, { section, label: '졸업 구분', group: segmentIn(block, /^졸업\s*구분/), candidates: STATUS_CANDIDATES[entry.status] || (entry.status ? [entry.status] : []) });
    if (entry.entryType) {
      await applySegment(session, { section, label: '입학 구분', group: segmentIn(block, /^입학\s*구분/), candidates: [entry.entryType] });
    }

    if (!text.isBlank(entry.gpa)) {
      await applyDropdown(session, {
        section,
        label: '만점 기준',
        trigger: pickerIn(/^학업\s*성적/, block),
        candidates: entry.gpaScale ? [entry.gpaScale, Number(entry.gpaScale).toFixed(1)] : [],
      });
      await applyText(session, { section, label: '평점', input: block.querySelector('input[name$="Grade.score"]'), value: entry.gpa });
    }

    if (kind !== 'highschool') await fillMajors(session, block, entry, section);
  }

  async function fillMajors(session, block, entry, section) {
    const majors = [
      [entry.major, '주전공'],
      [entry.doubleMajor, '복수전공'],
      [entry.minor, '부전공'],
    ].filter(([name]) => !text.isBlank(name));
    for (const [name, type] of majors) {
      if (text.normalize(dom.textOf(block)).includes(text.normalize(name)) && !visibleControls(MAJOR_SEARCH, block).some((input) => input.value === name)) {
        session.report.add(STATUS.SKIPPED, section, `${type} · ${name}`, '이미 입력됨');
        continue;
      }
      let input = visibleControls(MAJOR_SEARCH, block).find((element) => !controls.hasValue(element));
      if (!input) {
        const adder = visibleControls('button', rowIn(block, /^전공$/) || block).find((button) => /추가하기/.test(dom.textOf(button)));
        if (!adder) {
          session.manual(section, `${type} · ${name}`, '전공 행을 추가할 수 없습니다. 직접 입력해 주세요.');
          continue;
        }
        const before = visibleControls(MAJOR_SEARCH, block);
        adder.click();
        input = await dom.waitFor(() => visibleControls(MAJOR_SEARCH, block).find((element) => !before.includes(element)) || null, { timeout: 1500 });
        if (!input) {
          session.manual(section, `${type} · ${name}`, '전공 행을 추가하지 못했습니다. 직접 입력해 주세요.');
          continue;
        }
      }
      // 전공 행: 검색 칸과 주전공/복수전공/부전공 · 주간/야간 버튼을 함께 가진 가장 가까운 조상
      let row = input.parentElement;
      while (row && row !== block && ![...row.querySelectorAll('li > button')].some((button) => /주전공/.test(dom.textOf(button)))) row = row.parentElement;
      const status = await session.apply({
        section,
        label: `${type} · ${name}`,
        value: name,
        run: () => controls.fillSearchList(input, name, { scope: row || block, register: 'review' }),
      });
      if (status === STATUS.FAILED || !row || row === block) continue;
      const groups = (option) => {
        const buttons = [...row.querySelectorAll('li > button')].filter(isSegment);
        const container = buttons.find((button) => option.test(dom.textOf(button)));
        return container ? buttons.filter((button) => button.parentElement.parentElement === container.parentElement.parentElement) : [];
      };
      await applySegment(session, { section, label: `${name} · 전공 구분`, group: groups(/주전공/), candidates: [type] });
      if (entry.dayNight) await applySegment(session, { section, label: `${name} · 주간 / 야간`, group: groups(/주간|야간/), candidates: [entry.dayNight] });
    }
  }

  function schoolKind(entry) {
    if (entry.level === 'highschool') return 'highschool';
    if (entry.level === 'university' || entry.level === 'college') return 'college';
    if (entry.level === 'master' || entry.level === 'doctor') return 'graduate';
    return null;
  }

  async function fillEducations(session) {
    const used = new Set();
    for (const entry of session.list('educations')) {
      if (text.isBlank(entry.school)) continue;
      const kind = schoolKind(entry);
      if (!kind) {
        if (entry.level === 'ged') session.manual('학력', entry.school, '검정고시는 이 지원서의 학력 항목에 없으므로 직접 입력해 주세요.');
        continue;
      }
      if (!adderOf(kind) && !blocksOf(kind).length) continue;
      const block = await blockFor(session, kind, entry.school, SCHOOL_SEARCH, used);
      if (block) await fillSchoolBlock(session, block, entry, kind);
    }
  }

  /** 기업마다 켜는 경력 세부 항목: 행 제목 → 프로필 키 */
  const CAREER_TEXT = [
    [/^(근무\s*)?부서/, 'department', '부서'],
    [/^(직위|직급|직책)/, 'position', '직급 / 직책'],
    [/^(담당\s*업무|업무\s*내용|주요\s*업무)/, 'duties', '담당 업무'],
    [/^연봉/, 'salary', '연봉'],
  ];

  async function fillCareers(session) {
    if (!adderOf('career') && !blocksOf('career').length) return;
    const used = new Set();
    for (const entry of session.list('careers')) {
      if (text.isBlank(entry.company)) continue;
      if (/아르바이트/.test(entry.employmentType)) {
        session.report.add(STATUS.SKIPPED, '경력', entry.company, '아르바이트 경력은 이 지원서의 작성 대상이 아닙니다.');
        continue;
      }
      const block = await blockFor(session, 'career', entry.company, COMPANY_SEARCH, used);
      if (!block) continue;
      const section = `경력 · ${entry.company}`;

      await applyDropdown(session, { section, label: '고용 형태', trigger: pickerIn(/^고용\s*형태/, block), candidates: entry.employmentType ? [entry.employmentType] : [] });
      await applySegment(session, { section, label: '재직 여부', group: segmentIn(block, /^근무\s*기간/), candidates: [entry.current ? '재직중' : '퇴사'] });
      await applyDate(session, { section, label: '입사일', input: block.querySelector('input[placeholder="입사일"]'), value: text.formatDate(entry.startDate, 'YYYY.MM.DD') });
      if (!entry.current) {
        await applyDate(session, { section, label: '퇴사일', input: block.querySelector('input[placeholder="퇴사일"]'), value: endDate(entry.endDate) });
      }

      const search = block.querySelector(COMPANY_SEARCH);
      await session.apply({
        section,
        label: '회사명',
        value: entry.company,
        filled: !search,
        run: () => controls.fillSearchList(search, entry.company, { scope: block, register: 'ok' }),
      });

      await applyText(session, { section, label: '퇴직 사유', input: block.querySelector('input[name$=".retirementReason"], textarea[name$=".retirementReason"]'), value: entry.resignReason });
      for (const [pattern, key, label] of CAREER_TEXT) {
        const input = visibleControls('input[type="text"], input[type="number"], textarea', rowIn(block, pattern) || document.createElement('div')).find((element) => !element.matches(COMPANY_SEARCH));
        await applyText(session, { section, label, input, value: entry[key] });
      }
    }
  }

  const hasEntrySections = () => ['highschool', 'college', 'graduate', 'career'].some((kind) => adderOf(kind) || blocksOf(kind).length);

  async function fill(session) {
    const basics = !!document.querySelector('[name^="basicInfoGroupAnswers."]');
    const entries = hasEntrySections();
    if (basics) {
      await fillNamed(session);
      await fillBirthdate(session);
      await fillGender(session);
      checkApplySector(session);
      await fillMilitary(session);
      await fillPreferential(session);
      await fillAddress(session);
      await fillLinks(session);
      await fillNationality(session);
    }
    if (entries) {
      await fillEducations(session);
      await fillCareers(session);
    }
    if (!basics && !entries) {
      session.report.notice('이 단계(어학·자격 등)는 마이다스인 새 화면에서 아직 자동 입력을 지원하지 않습니다.');
    }
    await noticeAttachments(session);
    session.report.notice('단계를 이동하면 저장됩니다. 입력 결과를 확인한 뒤 [임시저장] 또는 [다음]을 직접 눌러 주세요.');
  }

  KApply.adapters.midasV1 = { id: 'midas', fill, matches, rowLabel, NAMED_FIELDS };
})();
