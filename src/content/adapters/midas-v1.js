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
    await applyDate(session, { section: SECTION.basic, label: '생년월일', input, value });
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
      addressDetail: session.get('basic.addressDetail'),
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
      // 화면이 처음부터 '비대상'을 선택해 두므로 그 상태는 입력 전으로 본다. 단, 원하는 값이 '비대상'이면 이미 입력된 것이다.
      filled: !!segmentValue(group) && (segmentValue(group) !== '비대상' || text.pickOption([segmentValue(group)], candidates) === 0),
      run: () => controls.fillSegment(group, candidates),
    });
    return { group, status };
  }

  async function fillMilitary(session) {
    const { group } = await fillSegmentRow(session, { pattern: /^병역/, label: '병역 구분', path: 'military.status' });
    if (!group.length) return;
    const chosen = segmentValue(group);
    if (!/군필|복무/.test(chosen)) return;

    // 입대·제대 날짜: 기업마다 '입대일/제대일', '입대년월/제대년월', '전역일' 등으로 표기한다.
    const dateFields = [
      [/입대/, '입대일', 'military.startDate'],
      [/제대|전역/, '제대일', 'military.endDate'],
    ];
    for (const [pattern, label, path] of dateFields) {
      const input = await dom.waitFor(
        () => visibleControls('input[type="text"]').find((element) => !element.disabled && !element.name && pattern.test(element.getAttribute('placeholder') || '')),
        { timeout: 1200 }
      );
      const value = text.formatDate(session.get(path), 'YYYY.MM.DD');
      if (!input) {
        if (value) session.manual(SECTION.military, label, `${label} 칸이 활성화되지 않아 '${value}'을(를) 넣지 못했습니다.`);
        continue;
      }
      // 월 단위(YYYY.MM) 입력 마스크를 쓰는 기업이 있다.
      await applyDate(session, { section: SECTION.military, label, input, value });
    }

    // 계급·제대구분·군별 드롭다운: 기업마다 켜는 칸과 순서가 다르고, 선택하면 안내 문구가 값으로 바뀐다.
    // 그래서 안내 문구 또는 현재 값의 종류로 어떤 칸인지 구분한다.
    const KINDS = [
      { key: 'rank', label: '계급', path: 'military.rank', placeholder: /계급/, value: /^(이병|일병|상병|병장|하사|중사|상사|원사|준위|소위|중위|대위|소령|중령|대령|준장|소장|중장|대장|훈련병|기타)$/ },
      { key: 'discharge', label: '제대 구분', path: 'military.discharge', placeholder: /제대|전역|소집/, value: /(만기|의가사|의병|소집해제|불명예|제대|전역|면제)/ },
      { key: 'branch', label: '군별', path: 'military.branch', placeholder: /군별|군\s*종|복무\s*형태/, value: /(육군|해군|공군|해병|의경|의무경찰|전경|해경|사회복무|공익|병역특례|산업기능|전문연구|카투사|의무소방|상근|기타)/ },
    ];
    const triggers = inRow(/^병역/, 'button').filter((button) => button.type === 'button' && !isSegment(button) && !/^\d+\s*개월$/.test(dom.textOf(button)));
    const kindOf = (button) => {
      const shown = dom.textOf(button);
      return (
        KINDS.find((kind) => /선택/.test(shown) && kind.placeholder.test(shown)) ||
        KINDS.find((kind) => !/선택/.test(shown) && kind.value.test(shown)) ||
        null
      );
    };
    for (const kind of KINDS) {
      const trigger = triggers.find((button) => kindOf(button) === kind);
      const candidates = session.candidates(kind.path);
      if (!trigger) {
        if (candidates.length && kind.key !== 'branch') session.manual(SECTION.military, kind.label, `${kind.label} 선택 칸을 찾지 못해 '${candidates[0]}'을(를) 넣지 못했습니다.`);
        continue;
      }
      await session.apply({
        section: SECTION.military,
        label: kind.label,
        value: candidates,
        filled: !/선택해\s*주세요/.test(dom.textOf(trigger)),
        run: async () => {
          if (trigger.disabled) return { ok: false, reason: `${kind.label} 선택 칸이 비활성화되어 있습니다.` };
          return controls.fillButtonDropdown(trigger, candidates);
        },
      });
    }

    // 병과(보직): 입력칸
    const role = visibleControls('input[type="text"]').find((element) => /militaryRole$/.test(element.name || '') || /병과/.test(element.getAttribute('placeholder') || ''));
    const specialty = session.get('military.specialty');
    if (role && !text.isBlank(specialty)) {
      await session.apply({ section: SECTION.military, label: '병과', value: specialty, filled: controls.hasValue(role), run: () => controls.fillText(role, specialty) });
    }
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

  /**
   * URL 종류 후보: 주소의 도메인으로 고르고, 맞는 종류가 없으면 '기타'.
   * 선택지는 기업마다 다를 수 있어(예: 블로그·노션·티스토리·기타) 여러 표기를 우선순위대로 둔다.
   */
  function linkTypeCandidates(url, key) {
    const host = (() => {
      try {
        return new URL(url).hostname.toLowerCase();
      } catch (error) {
        return '';
      }
    })();
    const rules = [
      [/(^|\.)tistory\.com$/, ['티스토리', '블로그']],
      [/(^|\.)github\.(com|io)$/, ['GitHub', '깃허브']],
      [/(^|\.)linkedin\.com$/, ['LinkedIn', '링크드인']],
      [/(^|\.)(notion\.site|notion\.so)$/, ['노션', 'Notion']],
      [/(^|\.)(youtube\.com|youtu\.be)$/, ['유튜브', 'YouTube']],
      [/(^|\.)instagram\.com$/, ['인스타그램', 'Instagram']],
      [/(^|\.)(twitter\.com|x\.com)$/, ['트위터', 'X']],
      [/(^|\.)tiktok\.com$/, ['틱톡', 'TikTok']],
      [/(^|\.)(velog\.io|blog\.naver\.com|brunch\.co\.kr|medium\.com)$/, ['블로그']],
    ];
    const matched = rules.find(([pattern]) => pattern.test(host));
    const fromKey = { blog: ['블로그'], portfolio: ['포트폴리오'], github: ['GitHub', '깃허브'], linkedin: ['LinkedIn', '링크드인'] }[key] || [];
    return [...new Set([...(matched ? matched[1] : []), ...fromKey, '기타'])];
  }

  /** URL 행의 종류 선택 버튼 */
  function linkTypeTrigger(input) {
    let row = input.parentElement;
    while (row && row !== document.body && !visibleControls('button', row).some((button) => button.type === 'button')) row = row.parentElement;
    return row && row !== document.body ? visibleControls('button', row).find((button) => button.type === 'button' && !/추가하기/.test(dom.textOf(button))) : null;
  }

  /** 종류가 선택되지 않은 상태: 안내 문구(link 등)만 보이는 경우 */
  const linkTypeEmpty = (trigger) => !trigger || /^(link|링크|선택|종류)/i.test(dom.textOf(trigger)) || !dom.textOf(trigger);

  async function applyLinkType(session, label, input, key) {
    const trigger = linkTypeTrigger(input);
    if (!trigger) return;
    const candidates = linkTypeCandidates(input.value, key);
    await session.apply({
      section: SECTION.links,
      label: `${label} 종류`,
      value: candidates,
      filled: !linkTypeEmpty(trigger),
      run: () => controls.fillButtonDropdown(trigger, candidates),
    });
  }

  async function fillLinks(session) {
    const adder = inRow(/^URL$/i, 'button').find((button) => /추가하기/.test(dom.textOf(button)));
    if (!adder && !urlInputs().length) return;
    const links = ['portfolio', 'github', 'blog', 'linkedin']
      .map((key) => ({ key, value: String(session.get(`links.${key}`) || '').trim() }))
      .filter((link) => link.value);
    const labels = { portfolio: '포트폴리오', github: 'GitHub', blog: '블로그', linkedin: 'LinkedIn' };
    const find = (value) => urlInputs().find((input) => text.normalize(input.value) === text.normalize(value));

    for (const link of links) {
      let target = find(link.value);
      await session.apply({
        section: SECTION.links,
        label: labels[link.key],
        value: link.value,
        filled: !!target,
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
          target = input;
          return controls.fillText(input, link.value);
        },
      });
      // 주소가 이미 있어도 종류가 비어 있으면 채운다(종류는 필수인 기업이 있다).
      target = target || find(link.value);
      if (target) await applyLinkType(session, labels[link.key], target, link.key);
    }
  }


  /** 긴급(비상) 연락처: 전화번호 입력칸과 관계 드롭다운 */
  async function fillEmergency(session) {
    const phone = document.querySelector('input[name$="emergencyContact.emergencyPhoneNumber"]');
    if (!phone || !dom.isVisible(phone)) return;
    const value = session.textValue('basic.phone', phone, session.get('basic.emergencyPhone'));
    if (text.isBlank(value)) {
      session.manual(SECTION.basic, '긴급 연락처', '프로필에 긴급 연락처가 없습니다. 옵션 화면의 기본 정보에 입력하면 다음부터 채웁니다.');
    } else {
      await session.apply({ section: SECTION.basic, label: '긴급 연락처', value, filled: controls.hasValue(phone), run: () => controls.fillText(phone, value) });
    }
    const relation = inRow(/^긴급\s*연락처/, 'button').find((button) => button.type === 'button' && !isSegment(button));
    const candidates = session.candidates('basic.emergencyRelation');
    if (!relation) return;
    if (!candidates.length) {
      if (/선택/.test(dom.textOf(relation))) session.manual(SECTION.basic, '긴급 연락처 관계', '프로필에 긴급 연락처 관계가 없습니다. 옵션 화면의 기본 정보에 입력해 주세요.');
      return;
    }
    await session.apply({
      section: SECTION.basic,
      label: '긴급 연락처 관계',
      value: candidates,
      filled: !/선택/.test(dom.textOf(relation)),
      run: () => controls.fillButtonDropdown(relation, candidates),
    });
  }

  /** 지원경로 드롭다운: 프로필의 지원 경로(쉼표로 여러 표현 가능) 중 선택지에 있는 것을 고른다. */
  async function fillApplySource(session) {
    const trigger = inRow(/^지원\s*경로/, 'button').find((button) => button.type === 'button' && !isSegment(button));
    if (!trigger) return;
    const candidates = session.candidates('application.source');
    if (!candidates.length) {
      if (/선택|지원\s*경로/.test(dom.textOf(trigger))) session.manual(SECTION.application, '지원경로', '프로필에 지원 경로가 없습니다. 옵션 화면의 지원 정보에 입력해 주세요.');
      return;
    }
    await session.apply({
      section: SECTION.application,
      label: '지원경로',
      value: candidates,
      filled: !/선택|^지원\s*경로$/.test(dom.textOf(trigger)),
      run: () => controls.fillButtonDropdown(trigger, candidates),
    });
  }

  /** 주민등록지: 현주소와 같으면 [상동]으로 채운다(프로필 주소는 하나이므로 현주소와 같다고 본다). */
  async function fillResidentAddress(session) {
    const field = (key) => document.querySelector(`[name="addressGroupResumeItemAnswers.residentAddress.${key}"]`);
    const current = (key) => document.querySelector(`[name="addressGroupResumeItemAnswers.currentAddress.${key}"]`);
    const address = field('address');
    if (!address || !dom.isVisible(address)) return;
    const same = inRow(/^주민\s*등록지/, 'button').find((button) => /^상동$/.test(dom.textOf(button)));
    const currentAddress = current('address');
    await session.apply({
      section: SECTION.basic,
      label: '주민등록지',
      value: currentAddress && currentAddress.value ? '상동' : session.get('basic.address'),
      filled: controls.hasValue(address),
      run: async () => {
        if (!currentAddress || !controls.hasValue(currentAddress)) return { ok: false, reason: '현주소가 비어 있어 주민등록지를 [상동]으로 채울 수 없습니다. 현주소를 먼저 입력해 주세요.' };
        if (!same) return { ok: false, reason: '주민등록지의 [상동] 버튼을 찾지 못했습니다. 직접 입력해 주세요.' };
        same.click();
        const copied = await dom.waitFor(() => (address.value && address.value === currentAddress.value ? true : null), { timeout: 2000 });
        if (!copied) return { ok: false, reason: '[상동]을 눌렀지만 주민등록지에 현주소가 복사되지 않았습니다.' };
        return { ok: true, detail: `상동 — ${address.value}` };
      },
    });
  }

  function checkApplySector(session) {
    const trigger = inRow(/^지원\s*분야/, 'button').find(isDropdown);
    if (trigger && /^신입\s*\/\s*경력$/.test(dom.textOf(trigger))) {
      session.manual(SECTION.application, '지원분야', '지원분야는 직접 선택해 주세요. 선택하지 않으면 다음 단계로 이동할 수 없습니다.');
    }
  }

  async function noticeAttachments(session, handled = new Set()) {
    const inputs = visibleControls('input[type="file"]').filter((input) => !/사진/.test(rowLabel(input)));
    for (const slot of KApply.schema.FILE_SLOTS) {
      if (handled.has(slot.key)) continue;
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
    highschool: { name: '고등학교', marker: 'input[placeholder^="입학"]', title: '고등학교' },
    college: { name: '대학교', marker: 'input[placeholder^="입학"]', title: '대학교' },
    graduate: { name: '대학원', marker: 'input[placeholder^="입학"]', title: '대학원' },
    career: { name: '직장경력', marker: 'input[placeholder^="입사"]', title: '경력' },
    project: { name: '프로젝트', marker: 'input[name$=".projectName"]', title: '프로젝트' },
    award: { name: '수상경력', marker: 'input[name$=".awardName"]', title: '수상' },
    activity: { name: '학내외활동', marker: 'input[name^="activityAnswers."][name$=".organization"]', title: '학내외활동' },
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
        if (input.value === value) return true;
        // 월 단위 칸(YYYY.MM)은 입력 마스크가 일자를 잘라낸다.
        if (/^\d{4}\.\d{2}$/.test(input.value) && value.startsWith(input.value)) return { ok: true, detail: input.value };
        return { ok: false, reason: `날짜가 반영되지 않았습니다(입력값 ${input.value || '없음'}).` };
      },
    });
  }

  async function applySegment(session, { section, label, group, candidates }) {
    if (!group.length || !candidates.length) return;
    const current = segmentValue(group);
    await session.apply({
      section,
      label,
      value: candidates,
      // 이미 원하는 값이 선택돼 있으면 건너뛴다(기본 선택이 원하는 값과 같은 경우 포함).
      filled: !!current && text.pickOption([current], candidates) === 0,
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

  /** 검색 칸이 선택한 이름으로 바뀐 블록의 식별 텍스트(비어 있으면 '') */
  const searchIdentity = (search) => (block) => (block.querySelector(search) ? '' : dom.textOf(block));
  /** 입력칸 값으로 식별하는 블록 */
  const inputIdentity = (selector) => (block) => {
    const input = block.querySelector(selector);
    return input ? String(input.value || '') : '';
  };

  /**
   * 목록 항목을 넣을 블록을 정한다.
   * 1. 같은 이름이 이미 입력된 블록이 있으면 그 항목은 건너뛴다.
   * 2. 빈 블록을 쓰고, 모자라면 [+ 추가]로 늘린다. 받는 개수는 기업마다 다르므로 사이트가 더 받지 않거나
   *    안내 문구의 개수("대표 1가지만", "최대 3건")에 이르면 멈춘다.
   * 3. 확보한 칸 수만큼 우선순위(목록 순서) 상위 항목을 고르고, 고른 항목은 날짜순으로 배치한다.
   * @returns {Promise<Array<{entry:object, block:HTMLElement}>>}
   */
  async function allocate(session, { kind, sourceId, entries, nameOf, identity }) {
    const existing = blocksOf(kind);
    const pending = [];
    // 같은 이름이 이미 입력된 블록도 비어 있는 칸은 채운다(칸마다 '이미 입력됨'이면 건너뛴다).
    const filled = [];
    for (const entry of entries) {
      const name = nameOf(entry);
      const same = existing.find((block) => identity(block) && text.normalize(identity(block)).includes(text.normalize(name)));
      if (same) filled.push({ entry, block: same });
      else pending.push(entry);
    }
    const free = existing.filter((block) => !identity(block));
    while (free.length < pending.length) {
      const current = blocksOf(kind);
      const limit = current.length ? Math.min(...current.map((node) => dom.countLimitOf(node) || Infinity)) : Infinity;
      if (current.length >= limit) break;
      const block = await addBlock(kind);
      if (!block) break;
      free.push(block);
    }
    const capacity = Math.min(free.length, pending.length);
    session.overflow(BLOCKS[kind].title, sourceId, pending.slice(capacity), blocksOf(kind).length);
    const placed = session.chronological(sourceId, pending.slice(0, capacity)).map((entry, index) => ({ entry, block: free[index] }));
    return [...filled, ...placed];
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

    // 학교정보 행의 선택 칸(소재지, 고등학교 계열 등)은 안내 문구 또는 현재 값으로 구분한다.
    const infoRow = rowIn(block, /^학교\s*정보/);
    const infoPickers = infoRow
      ? visibleControls('button', infoRow).filter((button) => button.type === 'button' && !isSegment(button) && !button.closest('ul'))
      : [];
    const REGION = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|해외|미국|일본|중국|기타.*|.*특별시|.*광역시|.*도)$/;
    const regionPicker = infoPickers.find((button) => /소재지/.test(dom.textOf(button)) || REGION.test(dom.textOf(button)));
    const trackPicker = infoPickers.find((button) => button !== regionPicker && (/계열/.test(dom.textOf(button)) || !/선택/.test(dom.textOf(button))));
    await applyDropdown(session, { section, label: '소재지', trigger: regionPicker, candidates: regionCandidates(entry.region) });
    if (trackPicker) {
      const track = String(entry.track || '').trim();
      if (!track) {
        if (/선택/.test(dom.textOf(trackPicker))) session.manual(section, '계열', `프로필에 '${entry.school}'의 계열이 없습니다. 옵션 화면의 학력에 입력해 주세요.`);
      } else {
        // '인문계'처럼 끝에 '계'를 붙여 적어도 선택지 '인문'과 맞춘다.
        await applyDropdown(session, { section, label: '계열', trigger: trackPicker, candidates: [...new Set([track, track.replace(/계$/, '')])] });
      }
    }
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

    await applyDate(session, { section, label: '입학일', input: block.querySelector('input[placeholder^="입학"]'), value: text.formatDate(entry.startDate, 'YYYY.MM.DD') });
    await applyDate(session, { section, label: '졸업일', input: block.querySelector('input[placeholder^="졸업"]'), value: endDate(entry.endDate) });
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
    const educations = session.list('educations').filter((entry) => !text.isBlank(entry.school));
    educations
      .filter((entry) => entry.level === 'ged')
      .forEach((entry) => session.manual('학력', entry.school, '검정고시는 이 지원서의 학력 항목에 없으므로 직접 입력해 주세요.'));
    for (const kind of ['highschool', 'college', 'graduate']) {
      if (!adderOf(kind) && !blocksOf(kind).length) continue;
      const pairs = await allocate(session, {
        kind,
        sourceId: 'educations',
        entries: educations.filter((entry) => schoolKind(entry) === kind),
        nameOf: (entry) => entry.school,
        identity: searchIdentity(SCHOOL_SEARCH),
      });
      for (const { entry, block } of pairs) await fillSchoolBlock(session, block, entry, kind);
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
    const careers = session.list('careers').filter((entry) => !text.isBlank(entry.company));
    careers
      .filter((entry) => /아르바이트/.test(entry.employmentType))
      .forEach((entry) => session.report.add(STATUS.SKIPPED, '경력', entry.company, '아르바이트 경력은 이 지원서의 작성 대상이 아닙니다.'));
    const pairs = await allocate(session, {
      kind: 'career',
      sourceId: 'careers',
      entries: careers.filter((entry) => !/아르바이트/.test(entry.employmentType)),
      nameOf: (entry) => entry.company,
      identity: searchIdentity(COMPANY_SEARCH),
    });
    for (const { entry, block } of pairs) {
      const section = `경력 · ${entry.company}`;

      await applyDropdown(session, { section, label: '고용 형태', trigger: pickerIn(/^고용\s*형태/, block), candidates: entry.employmentType ? [entry.employmentType] : [] });
      await applySegment(session, { section, label: '재직 여부', group: segmentIn(block, /^근무\s*기간/), candidates: [entry.current ? '재직중' : '퇴사'] });
      await applyDate(session, { section, label: '입사일', input: block.querySelector('input[placeholder^="입사"]'), value: text.formatDate(entry.startDate, 'YYYY.MM.DD') });
      if (!entry.current) {
        await applyDate(session, { section, label: '퇴사일', input: block.querySelector('input[placeholder^="퇴사"]'), value: endDate(entry.endDate) });
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

  // ---------------------------------------------------------------------------
  // 프로젝트 · 포트폴리오 (기업에 따라 학력 및 연구/경력 단계에 있음)
  // ---------------------------------------------------------------------------

  /** 입력칸의 최대 글자 수: maxlength 속성 또는 옆의 '0/500' 표시 */
  function maxLengthOf(element) {
    const attribute = Number(element.getAttribute('maxlength'));
    if (attribute > 0) return attribute;
    let node = element.parentElement;
    for (let depth = 0; depth < 3 && node; depth += 1) {
      const counter = [...node.querySelectorAll('p, span')].map(dom.textOf).find((value) => /^\d+\s*\/\s*\d+$/.test(value));
      if (counter) return Number(counter.split('/')[1]);
      node = node.parentElement;
    }
    return 0;
  }

  /** 글자 수 제한이 있는 서술 칸: 넘으면 잘라 넣지 않고 알린다. */
  async function applyLongText(session, { section, label, input, value }) {
    if (!input || text.isBlank(value)) return;
    const limit = maxLengthOf(input);
    const content = String(value).trim();
    if (limit && content.length > limit) {
      session.manual(section, label, `프로필 내용이 ${content.length}자로 이 칸의 제한(${limit}자)을 넘어 넣지 않았습니다. ${limit}자 이내로 줄여 직접 입력해 주세요.`);
      return;
    }
    await applyText(session, { section, label, input, value: content });
  }

  async function fillProjects(session) {
    if (!adderOf('project') && !blocksOf('project').length) return;
    const pairs = await allocate(session, {
      kind: 'project',
      sourceId: 'projects',
      entries: session.list('projects').filter((entry) => !text.isBlank(entry.name)),
      nameOf: (entry) => entry.name,
      identity: inputIdentity('input[name$=".projectName"]'),
    });
    for (const { entry, block } of pairs) {
      const section = `프로젝트 · ${entry.name}`;
      await applyText(session, { section, label: '프로젝트명', input: block.querySelector('input[name$=".projectName"]'), value: entry.name });
      const workplace = block.querySelector('input[name$=".workplace"], input[name$=".clientName"]');
      if (workplace && text.isBlank(entry.organization)) {
        session.manual(section, rowLabel(workplace) || '근무처', `프로필에 '${entry.name}'의 소속/발주처가 없습니다. 옵션 화면의 프로젝트에 입력해 주세요.`);
      } else {
        await applyText(session, { section, label: rowLabel(workplace) || '근무처', input: workplace, value: entry.organization });
      }
      const period = visibleControls('input[placeholder="기간"], input[placeholder$="기간"]', block);
      await applyDate(session, { section, label: '시작', input: period[0], value: text.formatDate(entry.startDate, 'YYYY.MM.DD') });
      if (!text.isBlank(entry.endDate)) await applyDate(session, { section, label: '종료', input: period[1], value: endDate(entry.endDate) });
      await applyText(session, { section, label: '참여 역할', input: block.querySelector('input[name$=".role"]'), value: entry.role });
      await applyText(session, { section, label: '기여도', input: block.querySelector('input[name$=".contributionRate"]'), value: entry.contribution });
      await applyLongText(session, { section, label: '상세 내용', input: block.querySelector('textarea[name$=".performWork"], textarea[name$=".description"]'), value: entry.description });
    }
  }

  const portfolioUrls = () => visibleControls('input[name*="portfolioFile"]').filter((input) => /\.url$/.test(input.name));

  /**
   * 포트폴리오 행: [첨부파일 추가] + URL 입력칸. 옵션에 포트폴리오 파일이 있으면 첨부하고 서버 수신까지 검증,
   * 없으면 포트폴리오 링크를 넣는다.
   * @returns {Promise<boolean>} 포트폴리오 파일을 이 칸에서 다뤘는지
   */
  async function fillPortfolio(session) {
    const adder = rowAdder(/^포트폴리오/);
    if (!adder && !portfolioUrls().length) return false;
    const meta = await session.fileMeta('portfolio');
    const link = String(session.get('links.portfolio') || '').trim();
    if (!meta && !link) return false;
    if (portfolioUrls().some((input) => controls.hasValue(input))) {
      session.report.add(STATUS.SKIPPED, '포트폴리오', '포트폴리오', '이미 입력됨');
      return !!meta;
    }
    let url = portfolioUrls().find((input) => !controls.hasValue(input));
    if (!url && adder) {
      adder.click();
      url = await dom.waitFor(() => portfolioUrls().find((input) => !controls.hasValue(input)) || null, { timeout: 1500 });
    }
    if (!url) {
      session.manual('포트폴리오', '포트폴리오', '포트폴리오 행을 추가하지 못했습니다. 직접 첨부하거나 URL을 입력해 주세요.');
      return !!meta;
    }
    let row = url.parentElement;
    while (row && row !== document.body && !row.querySelector('input[type="file"]')) row = row.parentElement;
    const file = row && row !== document.body ? row.querySelector('input[type="file"]') : null;
    if (meta && file) {
      await session.applyFile({
        section: '포트폴리오',
        label: '포트폴리오 파일',
        slot: 'portfolio',
        input: file,
        confirm: (record) => (controls.hasValue(url) || text.normalize(dom.textOf(row)).includes(text.normalize(record.name)) ? true : `'${record.name}'을(를) 올렸지만 첨부 목록에 표시되지 않았습니다.`),
      });
      return true;
    }
    if (link) {
      await session.apply({ section: '포트폴리오', label: '포트폴리오 URL', value: link, run: () => controls.fillText(url, link) });
    }
    return !!meta && !file;
  }

  const hasEntrySections = () => ['highschool', 'college', 'graduate', 'career', 'project'].some((kind) => adderOf(kind) || blocksOf(kind).length);

  // ---------------------------------------------------------------------------
  // 3단계: 어학 · 자격 · 경험
  // ---------------------------------------------------------------------------

  const EXAM_SEARCH = 'input[placeholder^="시험을 검색"]';
  const LICENSE_SEARCH = 'input[placeholder^="자격증명을 검색"]';

  /** 행 제목(공인외국어시험 · 자격증) 옆의 [추가하기] */
  const rowAdder = (pattern) => inRow(pattern, 'button').find((button) => /추가하기/.test(dom.textOf(button)));

  /** [추가하기]로 검색 칸이 있는 행을 하나 더 만든다. 안내 문구의 개수 제한("최대 2개" 등)에 이르면 만들지 않는다. */
  async function addSearchRow(pattern, search, count) {
    const adder = rowAdder(pattern);
    if (!adder || adder.disabled) return null;
    let section = adder.parentElement;
    while (section && section !== document.body && !pattern.test(text.cleanLabel(dom.textOf(section)))) section = section.parentElement;
    const limit = section && section !== document.body ? dom.countLimitOf(section) : null;
    if (limit && count >= limit) return null;
    const before = visibleControls(search);
    adder.click();
    return dom.waitFor(() => visibleControls(search).find((element) => !before.includes(element)) || null, { timeout: 1500 });
  }

  /** 비어 있는 검색 칸을 쓰거나 [추가하기]로 새 행을 만든다. */
  async function emptySearchRow(pattern, search, count = 0) {
    return visibleControls(search)[0] || addSearchRow(pattern, search, count);
  }

  /**
   * 새로 넣을 항목 수(want)만큼 빈 검색 행을 미리 확보하고 확보한 수를 돌려준다.
   * 받는 개수는 기업마다 다르므로, 사이트가 더 받지 않거나 안내 문구의 개수에 이르면 멈춘다.
   */
  async function reserveSearchRows(pattern, search, want, filled, created = []) {
    let free = visibleControls(search).length;
    while (free < want) {
      const input = await addSearchRow(pattern, search, filled() + free);
      if (!input) break;
      created.push(input);
      free += 1;
    }
    return Math.min(free, want);
  }

  /**
   * 미리 만들었지만 쓰지 않은(선택 실패 등) 빈 행을 지운다. 빈 필수 행이 남으면 다음 단계로 넘어갈 수 없다.
   * 행의 삭제(−) 버튼은 지원서 저장을 함께 하므로, 확장프로그램이 만든 행에만 쓴다.
   */
  async function removeUnusedRows(created, search) {
    let removed = 0;
    for (const input of created) {
      if (!input.isConnected || !input.matches(search) || controls.hasValue(input) || !dom.isVisible(input)) continue;
      let row = input.parentElement;
      const submitButtons = (node) => [...node.querySelectorAll('button')].filter((button) => button.type === 'submit' && dom.isVisible(button) && !dom.textOf(button));
      while (row && row.tagName !== 'FORM' && row !== document.body && !submitButtons(row).length) row = row.parentElement;
      if (!row || row.tagName === 'FORM' || row === document.body) continue;
      // 이 행만 포함하는지 확인한다(다른 행의 입력칸이 있으면 누르지 않는다).
      if (row.querySelectorAll('input[name]').length || row.querySelectorAll(search).length !== 1 || submitButtons(row).length !== 1) continue;
      submitButtons(row)[0].click();
      await dom.sleep(900);
      if (!input.isConnected) removed += 1;
    }
    return removed;
  }

  /** 검색 칸이 속한 행: 선택 후 나타나는 입력칸(name에 index 포함)을 함께 가진 가장 가까운 조상 */
  function rowOfSearch(input, stop) {
    let node = input.parentElement;
    while (node && node !== document.body && !node.querySelector(stop)) node = node.parentElement;
    return node;
  }

  /**
   * 이미 선택된 시험·자격증 행들. 행마다 표시 이름(칩)과 기준 입력칸(anchor)을 돌려준다.
   * 괄호 속 부가 명칭을 뺀 이름도 names에 넣는다(정규화하면 괄호가 사라지므로 먼저 뺀다).
   */
  function chosenRows(prefix, anchorKey) {
    return [...document.querySelectorAll(`input[name^="${prefix}"][name$=".${anchorKey}"]`)].map((anchor) => {
      let node = anchor.parentElement;
      while (node && !node.querySelector('p')) node = node.parentElement;
      const label = node ? dom.textOf(node.querySelector('p')) : '';
      // 괄호 안팎 변형까지 포함한다: 'SQLD(SQL개발자)' ↔ 프로필 'SQL 개발자(SQLD)'
      return { anchor, label, names: label ? controls.nameVariants(label) : [] };
    });
  }

  /**
   * 검색형 반복 행에서 항목을 고른다. 선택하면 검색 칸이 든 영역이 새 요소로 바뀌므로,
   * 선택 결과는 [추가하기]까지 포함하는 고정된 상위 영역에서 확인한다.
   * @returns {Promise<{status:string, anchor:HTMLInputElement|null, extra:object}>}
   */
  async function chooseInRow(session, { pattern, search, section, label, value, anchors, options, guard = false }) {
    const input = await emptySearchRow(pattern, search, anchors().length);
    // 더 추가할 수 없음(받는 개수 초과 또는 추가 버튼 없음): 호출하는 쪽이 나머지를 한 번에 알린다.
    if (!input) return { status: 'limited', anchor: null, extra: {} };
    const adder = rowAdder(pattern);
    let scope = input.parentElement;
    while (adder && scope && !scope.contains(adder)) scope = scope.parentElement;
    const before = anchors();
    const extra = {};
    const status = await session.apply({
      section,
      label,
      value,
      run: async () => {
        const select = () => controls.fillSearchList(input, value, { scope: scope || document.body, ...options });
        if (!guard) return select();
        // YBM 연동 기업은 TOEIC 등을 고르는 순간 YBM 로그인 창을 연다. 창을 막고, 막았다면 인증이 필요한 시험으로 본다.
        const guarded = await KApply.engine.withPopupGuard(select);
        if (!guarded) return { ok: false, reason: '인증 창 차단 모듈을 불러오지 못해 항목을 고르지 않았습니다. 직접 선택해 주세요.' };
        extra.blocked = guarded.blocked;
        return guarded.value;
      },
    });
    if (status === STATUS.FAILED) return { status, anchor: null, extra };
    const anchor = await dom.waitFor(() => anchors().find((element) => !before.includes(element)) || null);
    return { status, anchor, extra };
  }

  function examNames(entry) {
    const test = String(entry.test || '').trim();
    const language = String(entry.language || '').trim();
    return [language && `${test}(${language})`, language && `${test} (${language})`, test].filter(Boolean);
  }

  const EXAM_PREFIX = 'languageGroupAnswer.languageExamAnswers.';
  const LICENSE_PREFIX = 'licenseGroupAnswer.licenseAnswers.';

  async function fillExamFields(session, section, register, entry) {
    const index = register.name.slice(EXAM_PREFIX.length).split('.')[0];
    const field = (key) => document.querySelector(`input[name="${EXAM_PREFIX}${index}.${key}"]`);
    const box = rowOfSearch(register, 'input[placeholder^="응시"]');
    await applyText(session, { section, label: '등록 번호', input: register, value: entry.number });
    await applyDate(session, { section, label: '응시일', input: box && box.querySelector('input[placeholder^="응시"]'), value: text.formatDate(entry.date, 'YYYY.MM.DD') });
    const score = field('examScore.score');
    if (score) {
      await applyText(session, { section, label: '점수', input: score, value: entry.score });
      return;
    }
    // 등급형 시험(OPIc 등): 같은 행의 등급 드롭다운
    let row = box;
    const picker = (node) => visibleControls('button', node).find((button) => button.type === 'button' && !isSegment(button) && !/추가하기/.test(dom.textOf(button)));
    while (row && row !== document.body && !picker(row)) row = row.parentElement;
    const trigger = row && row !== document.body ? picker(row) : null;
    await session.apply({
      section,
      label: '등급',
      value: text.candidatesFor('languageGrade', entry.grade),
      filled: !!trigger && !/^등급$/.test(dom.textOf(trigger)),
      run: () => (trigger ? controls.fillButtonDropdown(trigger, text.candidatesFor('languageGrade', entry.grade)) : { ok: false, reason: '등급 선택 칸을 찾지 못했습니다.' }),
    });
  }

  async function fillLanguages(session) {
    if (!rowAdder(/^공인\s*외국어/) && !visibleControls(EXAM_SEARCH).length) return;
    const registers = () => [...document.querySelectorAll(`input[name^="${EXAM_PREFIX}"][name$=".registNumber"]`)];
    const entries = session.list('languages').filter((entry) => !text.isBlank(entry.test));
    const matching = (entry) => {
      const wanted = examNames(entry).map(text.normalize);
      // 시험은 언어별로 다른 항목이므로(OPIc(영어) ≠ OPIc(일본어)) 전체 이름으로만 비교한다.
      return chosenRows(EXAM_PREFIX, 'registNumber').find((row) => wanted.includes(text.normalize(row.label)));
    };

    // 이미 선택된 시험은 비어 있는 세부 칸만 채운다.
    const pending = [];
    for (const entry of entries) {
      const existing = matching(entry);
      if (!existing) pending.push(entry);
      else if (existing.anchor.disabled) session.manual(`어학 · ${examNames(entry)[0]}`, '성적 인증', 'YBM 성적 인증을 거쳐야 점수가 입력되는 시험입니다. 인증 창에서 인증해 주세요.');
      else await fillExamFields(session, `어학 · ${examNames(entry)[0]}`, existing.anchor, entry);
    }

    // 받는 개수만큼 행을 확보하고, 우선순위 상위 항목을 날짜순으로 넣는다.
    const created = [];
    const capacity = await reserveSearchRows(/^공인\s*외국어/, EXAM_SEARCH, pending.length, () => registers().length, created);
    session.overflow('어학', 'languages', pending.slice(capacity), registers().length + capacity);
    for (const entry of session.chronological('languages', pending.slice(0, capacity))) {
      const names = examNames(entry);
      const section = `어학 · ${names[0]}`;
      const chosen = await chooseInRow(session, {
        pattern: /^공인\s*외국어/,
        search: EXAM_SEARCH,
        section,
        label: '시험명',
        value: String(entry.test).trim(),
        anchors: registers,
        options: { names },
        guard: true,
      });
      if (chosen.status === 'limited') {
        session.manual(section, '시험명', `'${names[0]}'을(를) 넣을 빈 행을 찾지 못했습니다. [추가하기]로 행을 만든 뒤 직접 입력해 주세요.`);
        continue;
      }
      if (chosen.status === STATUS.FAILED) continue;
      if (!chosen.anchor) {
        session.manual(section, '시험 세부 항목', `'${names[0]}'을(를) 골랐지만 등록 번호·응시일 칸이 나타나지 않았습니다. 직접 입력해 주세요.`);
        continue;
      }
      if (chosen.extra.blocked !== 0 || chosen.anchor.disabled) {
        session.manual(section, '성적 인증', 'YBM 성적 인증을 거쳐야 점수가 입력되는 시험입니다. 시험을 지운 뒤 다시 선택해 인증 창에서 인증해 주세요.');
        continue;
      }
      await fillExamFields(session, section, chosen.anchor, entry);
    }
    await removeUnusedRows(created, EXAM_SEARCH);
  }

  async function fillLicenseFields(session, section, organization, entry) {
    const index = organization.name.slice(LICENSE_PREFIX.length).split('.')[0];
    const box = rowOfSearch(organization, 'input[placeholder^="취득"]');
    await applyText(session, { section, label: '발행 기관', input: organization, value: entry.issuer });
    await applyDate(session, { section, label: '취득일', input: box && box.querySelector('input[placeholder^="취득"]'), value: text.formatDate(entry.date, 'YYYY.MM.DD') });
    const register = document.querySelector(`input[name="${LICENSE_PREFIX}${index}.registNumber"]`);
    if (!register && !text.isBlank(entry.number)) {
      session.manual(section, '자격 번호', `이 행에는 자격 번호 칸이 없어(목록에 없는 자격증을 직접 등록한 경우) '${entry.number}'을(를) 넣지 못했습니다. 목록에서 자격증을 다시 골라 주세요.`);
      return;
    }
    await applyText(session, { section, label: '자격 번호', input: register, value: entry.number });
  }

  async function fillLicenses(session) {
    if (!rowAdder(/^자격증/) && !visibleControls(LICENSE_SEARCH).length) return;
    // 목록에 없는 자격증(직접 등록)은 자격 번호 칸이 없으므로 발행 기관 칸을 기준으로 삼는다.
    const organizations = () => [...document.querySelectorAll(`input[name^="${LICENSE_PREFIX}"][name$=".organization"]`)];
    const entries = session.list('certificates').filter((entry) => !text.isBlank(entry.name));

    const pending = [];
    for (const entry of entries) {
      const mine = controls.nameVariants(entry.name);
      const existing = chosenRows(LICENSE_PREFIX, 'organization').find((row) => row.names.some((name) => mine.includes(name)));
      if (existing) await fillLicenseFields(session, `자격증 · ${entry.name}`, existing.anchor, entry);
      else pending.push(entry);
    }

    const created = [];
    const capacity = await reserveSearchRows(/^자격증/, LICENSE_SEARCH, pending.length, () => organizations().length, created);
    session.overflow('자격증', 'certificates', pending.slice(capacity), organizations().length + capacity);
    for (const entry of session.chronological('certificates', pending.slice(0, capacity))) {
      const section = `자격증 · ${entry.name}`;
      const chosen = await chooseInRow(session, {
        pattern: /^자격증/,
        search: LICENSE_SEARCH,
        section,
        label: '자격증명',
        value: entry.name,
        anchors: organizations,
        options: { register: 'review', alias: true },
      });
      if (chosen.status === 'limited') {
        session.manual(section, '자격증명', `'${entry.name}'을(를) 넣을 빈 행을 찾지 못했습니다. [추가하기]로 행을 만든 뒤 직접 입력해 주세요.`);
        continue;
      }
      if (chosen.status === STATUS.FAILED) continue;
      if (!chosen.anchor) {
        session.manual(section, '자격증 세부 항목', `'${entry.name}'을(를) 골랐지만 발행 기관·취득일 칸이 나타나지 않았습니다. 직접 입력해 주세요.`);
        continue;
      }
      await fillLicenseFields(session, section, chosen.anchor, entry);
    }
    await removeUnusedRows(created, LICENSE_SEARCH);
  }

  async function fillAwards(session) {
    if (!adderOf('award') && !blocksOf('award').length) return;
    const pairs = await allocate(session, {
      kind: 'award',
      sourceId: 'awards',
      entries: session.list('awards').filter((entry) => !text.isBlank(entry.name)),
      nameOf: (entry) => entry.name,
      identity: inputIdentity('input[name$=".awardName"]'),
    });
    for (const { entry, block } of pairs) {
      const section = `수상 · ${entry.name}`;
      await applyText(session, { section, label: '상훈명', input: block.querySelector('input[name$=".awardName"]'), value: entry.name });
      await applyText(session, { section, label: '수여 기관', input: block.querySelector('input[name$=".organization"]'), value: entry.issuer });
      await applyDate(session, { section, label: '수상일', input: block.querySelector('input[placeholder^="발급"], input[placeholder^="수상"]'), value: text.formatDate(entry.date, 'YYYY.MM.DD') });
      await applyText(session, { section, label: '상세 내용', input: block.querySelector('textarea[name$=".comment"]'), value: entry.description });
    }
  }

  async function fillActivities(session) {
    if (!adderOf('activity') && !blocksOf('activity').length) return;
    const orName = (entry) => entry.organization || entry.name;
    const pairs = await allocate(session, {
      kind: 'activity',
      sourceId: 'activities',
      entries: session.list('activities').filter((entry) => !text.isBlank(orName(entry))),
      nameOf: orName,
      identity: inputIdentity('input[name$=".organization"]'),
    });
    for (const { entry, block } of pairs) {
      const name = orName(entry);
      const section = `학내외활동 · ${name}`;
      await applyDropdown(session, { section, label: '활동 구분', trigger: pickerIn(/^활동\s*구분/, block), candidates: text.candidatesFor('activityType', entry.type) });
      await applyText(session, { section, label: '기관 및 조직명', input: block.querySelector('input[name$=".organization"]'), value: name });
      const period = visibleControls('input[placeholder$="기간"]', block);
      await applyDate(session, { section, label: '활동 시작', input: period[0], value: text.formatDate(entry.startDate, 'YYYY.MM.DD') });
      await applyDate(session, { section, label: '활동 종료', input: period[1], value: endDate(entry.endDate) });
      await applyText(session, { section, label: '역할', input: block.querySelector('input[name$=".role"]'), value: entry.role });
      const contents = [entry.organization && entry.name !== entry.organization ? entry.name : '', entry.description].filter(Boolean).join(' - ');
      await applyText(session, { section, label: '상세 내용', input: block.querySelector('textarea[name$=".contents"]'), value: contents });
    }
  }

  // ---------------------------------------------------------------------------
  // 비어 있는 필수 칸 점검
  // ---------------------------------------------------------------------------

  /** 필수 표시: 입력칸을 감싼 요소의 ::before에 '*'를 그린다. */
  function markedRequired(element) {
    let node = element.parentElement;
    for (let depth = 0; depth < 3 && node; depth += 1) {
      const content = getComputedStyle(node, '::before').content;
      if (content && /\*/.test(content)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /**
   * 칸이 속한 항목의 이름: 반복 행은 선택된 이름 칩(예: '정보처리기사'), 블록은 머리글(예: '수상경력').
   * 칸에서 가까운 조상부터 올라가며 컨트롤이 없는 첫 텍스트 요소를 찾는다.
   */
  function itemName(element) {
    for (const kind of Object.keys(BLOCKS)) {
      if (blocksOf(kind).some((block) => block.contains(element))) return BLOCKS[kind].name;
    }
    let node = element.parentElement;
    for (let depth = 0; depth < 7 && node && node !== document.body; depth += 1) {
      const title = [...node.querySelectorAll('p')].find(
        (candidate) => !candidate.closest('button') && !candidate.querySelector(CONTROL) && dom.textOf(candidate) && dom.textOf(candidate).length < 40 && dom.textOf(candidate) !== '/'
      );
      if (title) return dom.textOf(title).replace(/^-\s*/, '');
      node = node.parentElement;
    }
    return '';
  }

  /** 칸 이름: 항목 이름 · 행 제목 · 안내 문구(placeholder) */
  function fieldName(element) {
    const hint = (element.getAttribute('placeholder') || dom.textOf(element) || '').replace(/(을|를)?\s*(입력|검색|선택)해\s*주세요\.?$/, '').trim();
    const parts = [itemName(element), rowLabel(element), hint].filter(Boolean);
    return [...new Set(parts)].join(' · ') || element.name || '입력 칸';
  }

  /**
   * 입력을 마친 뒤 화면에 비어 있는 필수 칸을 모두 알린다. 프로필에 값이 없거나 K-Apply가 다루지 않는 칸이라
   * 비어 있는 경우에도, 다음 단계 이동·제출 전에 무엇을 채워야 하는지 알 수 있게 한다.
   */
  function reportEmptyRequired(session) {
    const empty = visibleControls('input[type="text"], input[type="number"], textarea').filter(
      (element) => !element.disabled && !element.readOnly && !controls.hasValue(element) && markedRequired(element)
    );
    const pickers = visibleControls('button').filter(
      (button) => button.type === 'button' && !button.disabled && /선택해\s*주세요|^선택$/.test(dom.textOf(button)) && markedRequired(button)
    );
    const names = [...new Set([...empty, ...pickers].map(fieldName))];
    if (!names.length) return;
    session.manual(
      '필수 항목',
      `비어 있는 필수 칸 ${names.length}개`,
      `${names.slice(0, 6).join(', ')}${names.length > 6 ? ` 외 ${names.length - 6}개` : ''}. 프로필에 값이 없거나 K-Apply가 채우지 않는 칸입니다. 다음 단계로 넘어가기 전에 직접 입력해 주세요.`
    );
  }

  const hasStep3Sections = () => !!(rowAdder(/^공인\s*외국어/) || rowAdder(/^자격증/) || adderOf('award') || adderOf('activity') || blocksOf('award').length || blocksOf('activity').length);

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
      await fillResidentAddress(session);
      await fillEmergency(session);
      await fillApplySource(session);
      await fillLinks(session);
      await fillNationality(session);
    }
    const handledFiles = new Set();
    if (entries) {
      await fillEducations(session);
      await fillCareers(session);
      await fillProjects(session);
    }
    if (await fillPortfolio(session)) handledFiles.add('portfolio');
    const extras = hasStep3Sections();
    if (extras) {
      await fillLanguages(session);
      await fillLicenses(session);
      await fillAwards(session);
      await fillActivities(session);
    }
    if (!basics && !entries && !extras) {
      session.report.notice('이 단계는 자동 입력할 항목이 없습니다. 자기소개서 등 서술형 문항은 직접 작성해 주세요.');
    }
    await noticeAttachments(session, handledFiles);
    reportEmptyRequired(session);
    session.report.notice('단계를 이동하면 저장됩니다. 입력 결과를 확인한 뒤 [임시저장] 또는 [다음]을 직접 눌러 주세요.');
  }

  KApply.adapters.midasV1 = { id: 'midas', fill, matches, rowLabel, NAMED_FIELDS };
})();
