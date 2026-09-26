/**
 * 마이다스인(옛 마이다스아이티) 채용 솔루션 어댑터 — *.recruiter.co.kr 및 커스텀 도메인.
 *
 * 지원서는 여러 단계로 나뉘며, 각 단계 화면에 있는 항목만 채운다.
 *   등록   : 성명, 휴대전화(3칸), 이메일(+확인)
 *   1단계  : 영문이름, 성별, 생년월일, 국적, 주소, 장애·보훈, 병역, 지원경로 등
 *   2단계  : 고교, 대학/대학원(+전공), 직장경력, 프로젝트
 *   3단계  : 공인어학, 자격증, 수상, 교육이수, 학내외활동, 봉사활동
 *
 * 반복 항목은 div[data-loop="<이름>"] 행으로 렌더링되고 name="<이름>[i].<필드>" 형식을 쓴다.
 * 행 안의 [data-button="add"] 버튼으로 행을 추가한다.
 * 학교·전공·자격증·어학시험명은 검색창(input[type=search][data-type])으로만 입력할 수 있다.
 * 일부 필드는 대표 항목을 고르기 전까지 disabled 이므로 순서대로 입력하며 활성화를 기다린다.
 */
(function () {
  'use strict';

  const KApply = globalThis.KApply;
  KApply.adapters = KApply.adapters || {};
  if (KApply.adapters.midas) return;

  const { dom, text, controls, matcher } = KApply;
  const { STATUS } = KApply.engine;

  const SECTION_TITLE = {
    basic: '기본 정보',
    links: '링크',
    application: '지원 정보',
    military: '병역 · 보훈 · 장애',
  };

  const DEGREE = {
    university: ['학사', '대학교(4년)', '4년제'],
    college: ['전문학사', '대학교(2,3년)', '전문대'],
    master: ['석사'],
    doctor: ['박사'],
  };

  const byName = (name, scope = document) => scope.querySelector(`[name="${CSS.escape(name)}"]`);

  function midasLabel(element) {
    // 라디오의 자체 라벨은 선택지명(예: "비대상")이므로 행 제목을 쓴다.
    const own = element.type === 'radio' ? '' : dom.labelOf(element);
    if (own && own !== element.getAttribute('placeholder')) return text.cleanLabel(own);
    const row = element.closest('.row');
    const title = row && row.querySelector('label.title, .title');
    if (title && dom.textOf(title)) return text.cleanLabel(dom.textOf(title));
    const subject = element.closest('.subject');
    const heading = subject && subject.querySelector('h2');
    return text.cleanLabel(heading ? dom.textOf(heading) : own);
  }

  async function waitEnabled(resolve, timeout = 1200) {
    return dom.waitFor(() => {
      const element = resolve();
      return element && !element.disabled ? element : null;
    }, { timeout });
  }

  // ---------------------------------------------------------------------------
  // 공통 입력기: 요소 종류에 따라 알맞은 컨트롤을 사용한다.
  // ---------------------------------------------------------------------------

  /**
   * @param {HTMLElement} element
   * @param {{text?:string, choice?:string[], checked?:boolean, date?:string}} spec
   */
  async function setElement(element, spec) {
    if (element.type === 'radio') {
      return controls.fillRadio([...document.getElementsByName(element.name)], spec.choice || [spec.text]);
    }
    if (element.type === 'checkbox') return controls.fillCheckbox(element, spec.checked === true);
    if (element.tagName === 'SELECT') return controls.fillSelect(element, spec.choice || [spec.text]);
    if (element.hasAttribute('data-dates')) return controls.fillMidasDate(element, spec.date || spec.text);
    return controls.fillText(element, spec.text != null ? spec.text : (spec.choice || [])[0]);
  }

  function specEmpty(spec) {
    if (!spec) return true;
    if ('checked' in spec) return false;
    const choices = (spec.choice || []).filter(Boolean);
    return text.isBlank(spec.text) && text.isBlank(spec.date) && choices.length === 0;
  }

  function isFilled(element) {
    if (element.type === 'radio') return [...document.getElementsByName(element.name)].some((radio) => radio.checked);
    return controls.hasValue(element);
  }

  // ---------------------------------------------------------------------------
  // 등록 단계 · 1단계 (단일 항목)
  // ---------------------------------------------------------------------------

  async function fillRegistration(session) {
    const section = SECTION_TITLE.basic;
    const nameInput = document.getElementById('name');
    if (nameInput && nameInput.type === 'text') {
      const value = session.get('basic.name');
      await session.apply({ section, label: '성명', value, filled: controls.hasValue(nameInput), run: () => controls.fillText(nameInput, value) });
    }

    const mobile = ['mobile1', 'mobile2', 'mobile3'].map((id) => document.getElementById(id));
    if (mobile.every(Boolean)) {
      const parts = text.splitPhone(session.get('basic.phone'));
      await session.apply({
        section,
        label: '휴대전화',
        value: parts ? parts.join('-') : '',
        filled: mobile.every(controls.hasValue),
        run: async () => {
          for (let index = 0; index < 3; index += 1) await controls.fillText(mobile[index], parts[index]);
          return mobile.every((input, index) => input.value === parts[index]);
        },
      });
    }

    const email = session.get('basic.email');
    for (const id of ['email', 'emailConfirm']) {
      const input = document.getElementById(id);
      if (!input || input.type === 'hidden') continue;
      await session.apply({
        section,
        label: id === 'email' ? '이메일' : '이메일 확인',
        value: email,
        filled: controls.hasValue(input),
        run: () => controls.fillText(input, email),
      });
    }
  }

  async function fillAddress(session) {
    const zip = byName('currentAddress.zipCode');
    const address = byName('currentAddress.address');
    const detail = byName('currentAddress.detailAddress');
    if (!zip || !address) return;
    const values = [session.get('basic.postalCode'), session.get('basic.address'), session.get('basic.addressDetail')];
    if (text.isBlank(values[0]) || text.isBlank(values[1])) {
      if (!text.isBlank(values[1])) session.manual(SECTION_TITLE.basic, '주소', '우편번호가 없어 주소 검색으로 직접 입력해야 합니다.');
      return;
    }
    await session.apply({
      section: SECTION_TITLE.basic,
      label: '주소',
      value: values.join(' '),
      filled: controls.hasValue(address),
      run: async () => {
        await controls.fillText(zip, values[0]);
        await controls.fillText(address, values[1]);
        if (detail && values[2]) await controls.fillText(detail, values[2]);
        return controls.hasValue(address);
      },
    });
  }

  async function fillMilitary(session) {
    const military = session.profile.military;
    const section = SECTION_TITLE.military;
    const type = byName('military.militaryTypeCode');
    if (type) {
      await session.apply({
        section,
        label: '병역 구분',
        value: military.status,
        filled: isFilled(type),
        run: () => setElement(type, { choice: text.candidatesFor('militaryStatus', military.status) }),
      });
    }
    if (!['군필', '복무중'].includes(military.status) && military.status !== '면제') return;

    const plan = [
      ['military.militaryBranchCode', '군별', { choice: [military.branch] }],
      ['military.militaryPositionCode', '계급', { choice: [military.rank] }],
      ['military.militaryStartDate', '입대일', { date: military.startDate }],
      ['military.militaryEndDate', '전역일', { date: military.endDate }],
      ['military.militaryDischargeCode', '제대 구분', { choice: [military.discharge] }],
      ['military.exemptionReason', '면제 사유', { text: military.exemptionReason }],
    ];
    for (const [name, label, spec] of plan) {
      if (specEmpty(spec)) continue;
      const element = await waitEnabled(() => byName(name), 800);
      if (!element) continue;
      await session.apply({ section, label, value: spec, filled: isFilled(element), run: () => setElement(element, spec) });
    }
  }

  /** name → 프로필 경로 (1단계 단일 항목) */
  const NAMED_FIELDS = {
    englishName: 'basic.englishName',
    genderFlag: 'basic.gender',
    birthday: 'basic.birthdate',
    nationality: 'basic.nationality',
    'handicap.handicapYn': 'military.disability',
    'patriot.patriotYn': 'military.veteran',
    'applyChannel.applyChannelCodeSn': 'application.source',
    hopeSalary: 'application.desiredSalary',
    joinPossibleDate: 'application.availableFrom',
  };

  // 전용 로직이 처리하거나 자동 입력 대상이 아닌 항목. 장애·보훈은 여부(…Yn)만 채우고 세부 정보는 건너뛴다.
  const SKIP_NAMES =
    /^(military\.|currentAddress\.|applySector|pictureFile|password|privatePassword|g-recaptcha|resumeOath|step$|(handicap|patriot|lowIncome)\.(?!\w+Yn$))/;
  const LOOP_NAME = /\[\d+\]/;

  async function fillSingles(session) {
    const handled = new Set();
    const elements = [...document.querySelectorAll('input[name], select[name]')].filter(
      (element) =>
        element.type !== 'hidden' &&
        element.type !== 'password' &&
        element.type !== 'file' &&
        element.type !== 'search' &&
        !SKIP_NAMES.test(element.name) &&
        !LOOP_NAME.test(element.name) &&
        !['name', 'email'].includes(element.id)
    );
    for (const element of elements) {
      if (handled.has(element.name)) continue;
      handled.add(element.name);
      const label = midasLabel(element);
      const path = NAMED_FIELDS[element.name] || matcher.matchField(label);
      if (!path) continue;
      const raw = session.get(path);
      if (text.isBlank(raw)) continue;
      const spec = element.hasAttribute('data-dates')
        ? { date: raw }
        : element.tagName === 'SELECT' || element.type === 'radio'
          ? { choice: path === 'basic.nationality' ? [raw, '대한민국', '한국'] : session.candidates(path) }
          : { text: session.textValue(path, element) };
      if (element.hasAttribute('data-dates') && !text.parseDate(raw)) continue;
      await session.apply({
        section: SECTION_TITLE[path.split('.')[0]] || '기타',
        label,
        value: spec,
        filled: isFilled(element),
        run: () => setElement(element, spec),
      });
    }
  }

  function checkApplySector(session) {
    const sectors = [...document.querySelectorAll('select[name^="applySector"]')];
    if (sectors.length && sectors.every((select) => !select.value)) {
      session.manual('지원 정보', '지원분야', '지원분야는 직접 선택해 주세요. 선택하지 않으면 다음 단계로 이동할 수 없습니다.');
    }
  }

  // ---------------------------------------------------------------------------
  // 반복 항목 (2·3단계)
  // ---------------------------------------------------------------------------

  function rowsOf(loop, scope = document) {
    return [...scope.querySelectorAll(`div[data-loop="${loop}"]`)].filter((row) => {
      const parentLoop = row.parentElement && row.parentElement.closest('div[data-loop]');
      return scope === document ? !parentLoop : parentLoop === scope;
    });
  }

  async function ensureRow(loop, index, scope = document) {
    let rows = rowsOf(loop, scope);
    if (rows.length > index) return rows[index];
    for (let attempt = rows.length; attempt <= index; attempt += 1) {
      rows = rowsOf(loop, scope);
      const last = rows[rows.length - 1];
      // 일반 반복 항목은 행 안의 [data-button=add], 대학/대학원은 행 밖의 [data-button=addCollege][data-loopName]를 쓴다.
      const add =
        (last && [...last.querySelectorAll('[data-button="add"]')].find((button) => button.closest('div[data-loop]') === last)) ||
        document.querySelector(`[data-button="addCollege"][data-loopname="${CSS.escape(loop)}"]`);
      if (!add) return null;
      const before = rows.length;
      add.click();
      const grown = await dom.waitFor(() => rowsOf(loop, scope).length > before, { timeout: 2000 });
      if (!grown) return null;
    }
    return rowsOf(loop, scope)[index] || null;
  }

  /** 행 안에서 필드 요소를 찾는다. search:<type> 은 검색창을 뜻한다. */
  function findInRow(row, loop, index, field) {
    if (field.startsWith('search:')) {
      return row.querySelector(`input[type="search"][data-type="${field.slice(7)}"]`);
    }
    const exact = byName(`${loop}[${index}].${field}`, row);
    if (exact) return exact;
    // 행 번호와 name 인덱스가 어긋난 경우: 이 행에 직접 속한 요소 중 필드명이 같은 것을 쓴다.
    return (
      [...row.querySelectorAll(`[name$="].${CSS.escape(field)}"]`)].find((element) => element.closest('div[data-loop]') === row) || null
    );
  }

  function searchFilled(row) {
    const hidden = row.querySelector('input[type="hidden"][name$="Name"]');
    return !!(hidden && hidden.value);
  }

  /**
   * @param {object} session
   * @param {object} options
   * @param {string} options.loop
   * @param {string} options.title
   * @param {object[]} options.entries
   * @param {(entry:object)=>Array<[string,string,object]>} options.plan [필드, 라벨, spec] 배열
   * @param {(row:HTMLElement, entry:object, index:number)=>Promise<void>} [options.after]
   */
  async function fillLoop(session, { loop, title, entries, plan, after }) {
    if (!entries.length || rowsOf(loop).length === 0) return;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const rowLabel = `${title} ${index + 1}`;
      const row = await ensureRow(loop, index);
      if (!row) {
        session.manual(title, rowLabel, '행을 추가하지 못했습니다. [+] 버튼으로 직접 추가해 주세요.');
        break;
      }
      const steps = plan(entry);
      const [firstField] = steps[0];
      const first = findInRow(row, loop, index, firstField);
      const alreadyFilled = first && (firstField.startsWith('search:') ? searchFilled(row) : isFilled(first));
      if (alreadyFilled && !session.settings.overwrite) {
        session.report.add(STATUS.SKIPPED, title, rowLabel, '이미 입력됨');
        continue;
      }
      for (const [field, label, spec] of steps) {
        if (specEmpty(spec)) continue;
        const element = await waitEnabled(() => findInRow(row, loop, index, field));
        if (!element) continue;
        await session.apply({
          section: title,
          label: `${rowLabel} · ${label}`,
          value: spec,
          filled: field.startsWith('search:') ? searchFilled(row) && !session.settings.overwrite : isFilled(element),
          run: () => (field.startsWith('search:') ? controls.fillMidasSearch(element, spec.text) : setElement(element, spec)),
        });
      }
      if (after) await after(row, entry, index);
    }
  }

  async function fillHighschool(session) {
    const entry = session.list('educations').find((item) => item.level === 'highschool');
    const search = document.querySelector('input[type="search"][data-type="highschool"]');
    if (!entry || !search) return;
    const section = '학력(고등학교)';
    await session.apply({
      section,
      label: '학교명',
      value: entry.school,
      filled: !!(byName('highschool.academyName') && byName('highschool.academyName').value),
      run: () => controls.fillMidasSearch(search, entry.school),
    });
    const plan = [
      ['highschool.entranceDate', '입학', { date: entry.startDate }],
      ['highschool.graduationDate', '졸업', { date: entry.endDate }],
      ['highschool.graduationTypeCode', '졸업 구분', { choice: [entry.status] }],
    ];
    for (const [name, label, spec] of plan) {
      if (specEmpty(spec)) continue;
      const element = await waitEnabled(() => byName(name));
      if (!element) continue;
      await session.apply({ section, label, value: spec, filled: isFilled(element), run: () => setElement(element, spec) });
    }
  }

  function collegeLoops() {
    const loops = new Set();
    document.querySelectorAll('div[data-loop]').forEach((row) => {
      if (row.querySelector('input[type="search"][data-type="college"]') && !row.parentElement.closest('div[data-loop]')) {
        loops.add(row.getAttribute('data-loop'));
      }
    });
    return [...loops];
  }

  function collegePlan(entry) {
    return [
      ['search:college', '학교명', { text: entry.school }],
      ['degreeTypeCode', '학위', { choice: DEGREE[entry.level] || [] }],
      ['headOrBranch', '본교/분교', { choice: [entry.campus] }],
      ['entranceDate', '입학', { date: entry.startDate }],
      ['graduationDate', '졸업', { date: entry.endDate }],
      ['graduationTypeCode', '졸업 구분', { choice: [entry.status] }],
      ['perfectScore', '만점 기준', { choice: entry.gpa ? [entry.gpaScale] : [], text: entry.gpa ? entry.gpaScale : '' }],
      ['score', '학점', { text: entry.gpa }],
    ];
  }

  async function fillCollegeMajor(session, row, entry, index, title) {
    if (!entry.major) return;
    const majorRow = [...row.querySelectorAll('div[data-loop]')].find((node) => node.querySelector('input[type="search"][data-type="major"]'));
    if (!majorRow) return;
    const search = majorRow.querySelector('input[type="search"][data-type="major"]');
    const hidden = majorRow.querySelector('input[type="hidden"][name$=".majorName"]');
    if (search) {
      await session.apply({
        section: title,
        label: `${title} ${index + 1} · 전공`,
        value: entry.major,
        filled: !!(hidden && hidden.value),
        run: () => controls.fillMidasSearch(search, entry.major),
      });
    }
    const type = majorRow.querySelector('select[name$=".majorTypeCode"]');
    if (type && !type.disabled) await controls.fillSelect(type, ['주전공', '전공']);
    if (entry.minor || entry.doubleMajor) {
      session.manual(title, `${title} ${index + 1} · 부/복수전공`, '부전공·복수전공은 [+] 버튼으로 전공 행을 추가해 직접 입력해 주세요.');
    }
  }

  async function fillColleges(session) {
    const educations = session.list('educations');
    for (const loop of collegeLoops()) {
      const graduate = loop !== 'college';
      const entries = educations.filter((entry) =>
        graduate ? entry.level === 'master' || entry.level === 'doctor' : entry.level === 'university' || entry.level === 'college'
      );
      const title = graduate ? '학력(대학원)' : '학력(대학교)';
      await fillLoop(session, {
        loop,
        title,
        entries,
        plan: collegePlan,
        after: (row, entry, index) => fillCollegeMajor(session, row, entry, index, title),
      });
    }
  }

  const orName = (entry) => entry.organization || entry.name;
  const describe = (entry) => [entry.name, entry.description].filter(Boolean).join(' - ');
  const WORKING = { current: ['재직', '재직중'], left: ['퇴직', '퇴사'] };

  const LOOPS = [
    {
      loop: 'career',
      title: '경력',
      source: 'careers',
      plan: (e) => [
        ['careerCriteriaCodeSn', '고용 형태', { choice: [e.employmentType] }],
        ['company', '회사명', { text: e.company }],
        ['workingStatusCode', '재직 상태', { choice: e.current ? WORKING.current : WORKING.left }],
        ['entranceDate', '입사', { date: e.startDate }],
        ['leavingDate', '퇴사', { date: e.current ? '' : e.endDate }],
        ['department', '부서', { text: e.department }],
        ['position', '직급', { text: e.position }],
        ['assignedTask', '담당 업무', { text: e.duties }],
        ['retirementReason', '퇴직 사유', { text: e.resignReason }],
      ],
    },
    {
      loop: 'project',
      title: '프로젝트',
      source: 'projects',
      plan: (e) => [
        ['projectName', '프로젝트명', { text: e.name }],
        ['clientName', '발주처', { text: e.organization }],
        ['workplace', '근무처', { text: e.organization }],
        ['startDate', '시작', { date: e.startDate }],
        ['endDate', '종료', { date: e.endDate }],
        ['contributionRate', '기여도', { text: e.contribution }],
        ['role', '역할', { text: e.role }],
        ['performWork', '수행 업무', { text: e.description }],
        ['comment', '비고', { text: e.url }],
      ],
    },
    {
      loop: 'languageExam',
      title: '공인어학',
      source: 'languages',
      plan: (e) => [
        ['search:foreignExam', '시험명', { text: e.test }],
        ['examDate', '응시일', { date: e.date }],
        ['registNumber', '등록 번호', { text: e.number }],
        ['gradeCode', '등급', { choice: [e.grade] }],
        ['score', '점수', { text: e.score }],
      ],
    },
    {
      loop: 'license',
      title: '자격증',
      source: 'certificates',
      plan: (e) => [
        ['search:license', '자격증명', { text: e.name }],
        ['organization', '발행 기관', { text: e.issuer }],
        ['registNumber', '자격 번호', { text: e.number }],
        ['acquireDate', '취득일', { date: e.date }],
        ['score', '점수', { text: e.grade }],
      ],
    },
    {
      loop: 'award',
      title: '수상',
      source: 'awards',
      plan: (e) => [
        ['awardName', '수상명', { text: e.name }],
        ['organization', '수여 기관', { text: e.issuer }],
        ['awardDate', '수상일', { date: e.date }],
        ['comment', '수상 내역', { text: e.description }],
      ],
    },
    {
      loop: 'education',
      title: '교육 이수',
      source: 'trainings',
      plan: (e) => [
        ['educationName', '과정명', { text: e.course }],
        ['organization', '교육 기관', { text: e.institution }],
        ['startDate', '시작', { date: e.startDate }],
        ['endDate', '종료', { date: e.endDate }],
        ['time', '이수 시간', { text: e.hours }],
        ['comment', '주요 내용', { text: e.description }],
      ],
    },
    {
      loop: 'activity',
      title: '학내외활동',
      source: 'activities',
      filter: (e) => e.type !== '봉사활동' && e.type !== '해외경험',
      plan: (e) => [
        ['activityCategorySn', '활동 구분', { choice: [e.type] }],
        ['organization', '기관', { text: orName(e) }],
        ['startDate', '시작', { date: e.startDate }],
        ['endDate', '종료', { date: e.endDate }],
        ['role', '역할', { text: e.role }],
        ['contents', '활동 내용', { text: describe(e) }],
      ],
    },
    {
      loop: 'volunteerActivity',
      title: '봉사활동',
      source: 'activities',
      filter: (e) => e.type === '봉사활동',
      plan: (e) => [
        ['organization', '기관', { text: orName(e) }],
        ['startDate', '시작', { date: e.startDate }],
        ['endDate', '종료', { date: e.endDate }],
        ['time', '봉사 시간', { text: e.hours }],
        ['comment', '내용', { text: describe(e) }],
      ],
    },
  ];

  // ---------------------------------------------------------------------------

  async function fill(session) {
    await fillRegistration(session);
    await fillSingles(session);
    await fillAddress(session);
    await fillMilitary(session);
    checkApplySector(session);

    await fillHighschool(session);
    await fillColleges(session);
    for (const definition of LOOPS) {
      const entries = session.list(definition.source).filter(definition.filter || (() => true));
      await fillLoop(session, { loop: definition.loop, title: definition.title, entries, plan: definition.plan });
    }

    if (document.querySelector('button[data-step]')) {
      session.report.notice('마이다스인은 단계별로 저장됩니다. [임시저장] 또는 [다음]으로 이동한 뒤 다음 단계에서 다시 실행해 주세요.');
    }
    if (document.getElementById('password')) {
      session.report.notice('비밀번호는 보안을 위해 자동 입력하지 않습니다.');
    }
  }

  KApply.adapters.midas = { id: 'midas', fill, LOOPS, NAMED_FIELDS };
})();
