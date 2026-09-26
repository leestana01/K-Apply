/**
 * 그리팅(greetinghr.com) 지원서 어댑터.
 *
 * 그리팅 지원서는 Ark UI 기반이며 입력 요소에 폼 경로가 name 속성으로 붙는다.
 *   basicInformation.name, workHistory.workExperiences.0.companyName ...
 * name이 있는 항목은 경로로 정확히 매핑하고, name이 없거나 회사별 커스텀 질문은 라벨로 매칭한다.
 */
(function () {
  'use strict';

  const KApply = globalThis.KApply;
  KApply.adapters = KApply.adapters || {};
  if (KApply.adapters.greeting) return;

  const { dom, text, controls, matcher } = KApply;

  const FIELD_ROOT = '[data-scope="field"][data-part="root"]';
  const LC = 'languagesCertificationsAndOtherActivity';

  const SECTION_TITLE = {
    basic: '기본 정보',
    links: '링크',
    application: '지원 정보',
    military: '병역',
    documents: '제출 서류',
  };

  /** name 경로 → 프로필 경로 (단일 항목) */
  const NAMED_FIELDS = {
    'basicInformation.name': 'basic.name',
    'basicInformation.englishName': 'basic.englishName',
    'basicInformation.emailAddress': 'basic.email',
    'basicInformation.phoneNumber.nationalNumber': 'basic.phone',
    'basicInformation.gender': 'basic.gender',
    'basicInformation.birthdate': 'basic.birthdate',
    'basicInformation.nationalityCode': 'basic.nationality',
    'personalInformation.currentAddress.postalCode': 'basic.postalCode',
    'personalInformation.currentAddress.address': 'basic.address',
    'personalInformation.currentAddress.detailedAddress': 'basic.addressDetail',
    'applicationDetail.applicationSource': 'application.source',
    'applicationDetail.desiredSalary.salary': 'application.desiredSalary',
  };

  const isUniversity = (entry) => entry.level === 'university' || entry.level === 'college';
  const isGraduate = (entry) => entry.level === 'master' || entry.level === 'doctor';
  const isVolunteer = (entry) => entry.type === '봉사활동';
  const isExtracurricular = (entry) => entry.type !== '봉사활동' && entry.type !== '해외경험';
  const orName = (entry) => entry.organization || entry.name;
  const describe = (entry) => [entry.name, entry.description].filter(Boolean).join(' - ');
  /** 코드 목록에서 골라야 하는 값: 목록에 없어 직접 입력하면 "확인 필요"로 알린다. */
  const coded = (value, lookup = {}) => (value ? { text: value, lookup: { reviewDirect: true, ...lookup } } : '');
  /** 학교명: 캠퍼스까지 맞는 코드 항목을 고른다. */
  const school = (entry) => coded(entry.school, { campus: entry.campus });

  /**
   * 반복 섹션 정의. fields의 값은 (entry) => 값 | { choice: 후보배열 } | { checked: boolean }
   * base가 배열이 아닌 단일 객체(고등학교)인 경우 single: true
   */
  const LISTS = [
    {
      base: 'educationalBackground.highSchool',
      single: true,
      source: 'educations',
      title: '학력(고등학교)',
      filter: (entry) => entry.level === 'highschool',
      key: 'schoolName',
      fields: {
        schoolName: school,
        completionStatus: (e) => ({ choice: [e.status] }),
        'enrollmentPeriod.startDate': (e) => e.startDate,
        'enrollmentPeriod.endDate': (e) => e.endDate,
      },
    },
    {
      base: 'educationalBackground.universities',
      source: 'educations',
      title: '학력(대학교)',
      filter: isUniversity,
      key: 'schoolName',
      fields: {
        schoolName: school,
        'enrollmentPeriod.startDate': (e) => e.startDate,
        'enrollmentPeriod.endDate': (e) => e.endDate,
        completionStatus: (e) => ({ choice: [e.status] }),
        'gpa.scoreScale': (e) => (e.gpa ? { choice: [e.gpaScale] } : ''),
        'gpa.score': (e) => e.gpa,
        'majors.0.majorClassification': (e) => (e.major ? { choice: ['주전공'] } : ''),
        'majors.0': (e) => coded(e.major),
      },
    },
    {
      base: 'educationalBackground.graduateSchools',
      source: 'educations',
      title: '학력(대학원)',
      filter: isGraduate,
      key: 'schoolName',
      fields: {
        degreeLevel: (e) => ({ choice: text.candidatesFor('graduateDegree', e.level) }),
        schoolName: school,
        'enrollmentPeriod.startDate': (e) => e.startDate,
        'enrollmentPeriod.endDate': (e) => e.endDate,
        completionStatus: (e) => ({ choice: [e.status] }),
        'gpa.scoreScale': (e) => (e.gpa ? { choice: [e.gpaScale] } : ''),
        'gpa.score': (e) => e.gpa,
        'majors.0.majorClassification': (e) => (e.major ? { choice: ['주전공'] } : ''),
        'majors.0': (e) => coded(e.major),
      },
    },
    {
      base: 'workHistory.workExperiences',
      source: 'careers',
      title: '경력',
      key: 'companyName',
      fields: {
        companyName: (e) => e.company,
        employmentType: (e) => ({ choice: [e.employmentType] }),
        'employmentPeriod.startDate': (e) => e.startDate,
        employmentStatus: (e) => ({ checked: e.current === true }),
        'employmentPeriod.endDate': (e) => (e.current ? '' : e.endDate),
        department: (e) => e.department,
        positionRank: (e) => e.position,
        dutiesResponsibility: (e) => e.duties,
        reasonForResignation: (e) => e.resignReason,
      },
    },
    {
      base: 'workHistory.projects',
      source: 'projects',
      title: '프로젝트',
      key: 'projectName',
      fields: {
        projectName: (e) => e.name,
        placeOfEmployment: (e) => e.organization,
        client: (e) => e.organization,
        roleParticipationRole: (e) => e.role,
        'projectPeriod.startDate': (e) => e.startDate,
        'projectPeriod.endDate': (e) => e.endDate,
        contribution: (e) => e.contribution,
        projectDescription: (e) => [e.description, e.url].filter(Boolean).join('\n'),
      },
    },
    {
      base: `${LC}.extracurricularActivities`,
      source: 'activities',
      title: '대외활동',
      filter: isExtracurricular,
      key: 'institutionOrganizationName',
      fields: {
        activityClassification: (e) => ({ choice: [e.type] }),
        institutionOrganizationName: orName,
        role: (e) => e.role,
        'activityPeriod.startDate': (e) => e.startDate,
        'activityPeriod.endDate': (e) => e.endDate,
        activityDescription: describe,
      },
    },
    {
      base: `${LC}.volunteerExperiences`,
      source: 'activities',
      title: '봉사활동',
      filter: isVolunteer,
      key: 'hostOrganization',
      fields: {
        hostOrganization: orName,
        'activityPeriod.startDate': (e) => e.startDate,
        'activityPeriod.endDate': (e) => e.endDate,
        volunteerHours: (e) => e.hours,
        serviceDescription: describe,
      },
    },
    {
      base: `${LC}.completedCoursesTrainings`,
      source: 'trainings',
      title: '교육 이수',
      key: 'courseName',
      fields: {
        courseName: (e) => e.course,
        educationalInstitution: (e) => e.institution,
        'completionPeriod.startDate': (e) => e.startDate,
        'completionPeriod.endDate': (e) => e.endDate,
        trainingHours: (e) => e.hours,
        mainContent: (e) => e.description,
      },
    },
    {
      base: `${LC}.certifiedLanguageTests`,
      source: 'languages',
      title: '어학',
      key: 'testName',
      fields: {
        foreignLanguage: (e) => (e.language ? { choice: [e.language] } : ''),
        testName: (e) => (e.test ? { choice: [e.test], text: e.test, lookup: { reviewDirect: true } } : ''),
        'score.score': (e) => e.score,
        grade: (e) => (e.grade ? { choice: [e.grade], text: e.grade } : ''),
        acquisitionDate: (e) => e.date,
        registrationNumber: (e) => e.number,
      },
    },
    {
      base: `${LC}.certificatesLicenses`,
      source: 'certificates',
      title: '자격증',
      key: 'credentials',
      fields: {
        credentials: (e) => coded(e.name),
        issuingAgency: (e) => e.issuer,
        acquisitionDate: (e) => e.date,
        registrationNumber: (e) => e.number,
        rating: (e) => e.grade,
      },
    },
    {
      base: `${LC}.awards`,
      source: 'awards',
      title: '수상',
      key: 'awardName',
      fields: {
        awardName: (e) => e.name,
        awardingInstitution: (e) => e.issuer,
        awardDate: (e) => e.date,
        awardDetail: (e) => e.description,
      },
    },
  ];

  const LIST_PREFIXES = LISTS.map((list) => list.base + '.');

  // ---------------------------------------------------------------------------
  // 컨트롤 판별·입력
  // ---------------------------------------------------------------------------

  function kindOf(element) {
    if (element.matches('button[data-scope="select"][data-part="trigger"]')) return 'select';
    if (element.matches('button[data-scope="date-picker"][data-part="trigger"]')) return 'date';
    if (element.type === 'checkbox') return 'checkbox';
    if (element.type === 'radio') return 'radio';
    if (element.type === 'file') return 'file';
    if (element.getAttribute('role') === 'combobox') return 'combobox';
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') return 'text';
    return null;
  }

  function isFilled(element, kind) {
    if (kind === 'select') return !element.hasAttribute('data-placeholder-shown');
    if (kind === 'date') return element.getAttribute('data-placeholder') === 'false';
    if (kind === 'radio') return [...document.getElementsByName(element.name)].some((radio) => radio.checked);
    return controls.hasValue(element);
  }

  /** 가장 가까운 필드 루트부터 바깥쪽으로 올라가며 라벨을 찾는다(기간 입력처럼 중첩된 필드 대응). */
  function fieldLabel(element) {
    let root = element.closest(FIELD_ROOT);
    while (root) {
      const label = [...root.querySelectorAll('label[data-part="label"]')].find((node) => node.closest(FIELD_ROOT) === root);
      if (label && text.cleanLabel(label.textContent)) return text.cleanLabel(label.textContent);
      root = root.parentElement && root.parentElement.closest(FIELD_ROOT);
    }
    return '';
  }

  /**
   * spec: 문자열 값 | { choice: [...], text?: string } | { checked: boolean }
   */
  async function setControl(element, kind, spec) {
    const value = typeof spec === 'object' && spec !== null ? spec : { text: spec, choice: [spec] };
    switch (kind) {
      case 'select':
        return controls.fillArkSelect(element, value.choice || []);
      case 'date':
        return controls.fillArkDate(element, value.text);
      case 'checkbox':
        return controls.fillCheckbox(element, value.checked === true);
      case 'radio':
        return controls.fillRadio([...document.getElementsByName(element.name)], value.choice || []);
      case 'combobox':
        return controls.fillArkCombobox(element, value.text != null ? value.text : (value.choice || [])[0], value.lookup || {});
      case 'text':
        return controls.fillText(element, value.text != null ? value.text : (value.choice || [])[0]);
      default:
        return false;
    }
  }

  function specIsEmpty(spec) {
    if (spec === undefined || spec === null || spec === '') return true;
    if (typeof spec !== 'object') return false;
    if ('checked' in spec) return false;
    return (!spec.choice || spec.choice.filter(Boolean).length === 0) && text.isBlank(spec.text);
  }

  /** 프로필 경로의 값을 컨트롤 종류에 맞는 spec으로 변환 */
  function specForPath(session, path, element, kind) {
    const raw = session.get(path);
    if (text.isBlank(raw)) return '';
    if (kind === 'select' || kind === 'radio') {
      const choice = session.candidates(path);
      if (path === 'basic.nationality') choice.push('대한민국', '한국');
      return { choice };
    }
    if (kind === 'date') return { text: raw };
    // 기본 정보의 콤보박스(이메일 도메인 제안 등)는 입력값 자체가 유효하다.
    return { text: session.textValue(path, element), lookup: { freeText: true } };
  }

  // ---------------------------------------------------------------------------
  // 단일 항목
  // ---------------------------------------------------------------------------

  function formControls() {
    const seenRadioGroups = new Set();
    return [...document.querySelectorAll(`${FIELD_ROOT} input, ${FIELD_ROOT} textarea, ${FIELD_ROOT} button[data-part="trigger"]`)].filter(
      (element) => {
        const kind = kindOf(element);
        if (!kind || kind === 'file') return false;
        if (kind === 'radio') {
          if (seenRadioGroups.has(element.name)) return false;
          seenRadioGroups.add(element.name);
        }
        return dom.isVisible(element) || kind === 'radio';
      }
    );
  }

  async function fillSingles(session) {
    const handled = new Set();
    for (const element of formControls()) {
      const name = element.getAttribute('name') || '';
      if (LIST_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
      const kind = kindOf(element);
      const label = fieldLabel(element);
      // 긴 서술형 질문(자기소개서 등)은 채우지 않는다.
      if (element.tagName === 'TEXTAREA' && !NAMED_FIELDS[name]) continue;
      const path = NAMED_FIELDS[name] || matcher.matchField(label);
      if (!path || handled.has(path + name)) continue;
      handled.add(path + name);
      const spec = specForPath(session, path, element, kind);
      const section = SECTION_TITLE[path.split('.')[0]] || '기타';
      const status = await session.apply({
        section,
        label: label || name,
        value: specIsEmpty(spec) ? '' : spec,
        filled: isFilled(element, kind),
        run: () => setControl(element, kind, spec),
      });
      if (status === KApply.engine.STATUS.FILLED && kind === 'radio') {
        const checked = [...document.getElementsByName(element.name)].find((radio) => radio.checked);
        if (checked && /직접\s*입력|기타/.test(controls.radioLabel(checked))) {
          session.manual(section, `${label} 상세`, '선택한 항목의 상세 내용을 직접 입력해 주세요.');
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 반복 섹션
  // ---------------------------------------------------------------------------

  function entryPrefix(list, index) {
    return list.single ? `${list.base}.` : `${list.base}.${index}.`;
  }

  function entryExists(list, index) {
    return !!document.querySelector(`[name^="${CSS.escape(entryPrefix(list, index))}"]`);
  }

  function findAddButton(list, index) {
    const anchor = document.querySelector(`[name^="${CSS.escape(entryPrefix(list, index - 1))}"]`);
    let node = anchor;
    while (node && node !== document.body) {
      const buttons = [...node.querySelectorAll('button')].filter((button) => dom.textOf(button) === '항목 추가');
      if (buttons.length) return buttons[buttons.length - 1];
      node = node.parentElement;
    }
    return null;
  }

  async function ensureEntry(list, index) {
    if (entryExists(list, index)) return true;
    if (list.single || index === 0) return false;
    const button = findAddButton(list, index);
    if (!button) return false;
    button.click();
    return !!(await dom.waitFor(() => entryExists(list, index), { timeout: 2000 }));
  }

  async function fillList(session, list) {
    const entries = session.list(list.source).filter(list.filter || (() => true));
    if (!entries.length || !entryExists(list, 0)) return;
    const limit = list.single ? 1 : entries.length;
    for (let index = 0; index < limit; index += 1) {
      const entry = entries[index];
      const label = `${list.title} ${list.single ? '' : index + 1}`.trim();
      if (!(await ensureEntry(list, index))) {
        session.manual(list.title, label, '항목을 추가하지 못했습니다. 직접 추가해 주세요.');
        continue;
      }
      const prefix = entryPrefix(list, index);
      const keyElement = document.querySelector(`[name="${CSS.escape(prefix + list.key)}"]`);
      if (keyElement && isFilled(keyElement, kindOf(keyElement)) && !session.settings.overwrite) {
        session.report.add(KApply.engine.STATUS.SKIPPED, list.title, label, '이미 입력됨');
        continue;
      }
      for (const [field, derive] of Object.entries(list.fields)) {
        const element = document.querySelector(`[name="${CSS.escape(prefix + field)}"]`);
        if (!element) continue;
        const kind = kindOf(element);
        const spec = derive(entry);
        if (specIsEmpty(spec)) continue;
        await session.apply({
          section: list.title,
          label: `${label} · ${fieldLabel(element) || field}`,
          value: spec,
          filled: kind === 'checkbox' ? false : isFilled(element, kind),
          run: () => setControl(element, kind, spec),
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 제출 서류
  // ---------------------------------------------------------------------------

  const UPLOAD_ITEM = '[data-scope="file-upload"][data-part="item"]';

  function uploadItems(root) {
    return [...root.querySelectorAll(UPLOAD_ITEM)];
  }

  /** 서버 업로드 후 그리팅 화면에 해당 파일이 "accepted" 상태로 표시됐는지 확인한다. */
  function confirmUploaded(root, record) {
    const items = uploadItems(root);
    if (items.some((item) => item.getAttribute('data-type') === 'rejected')) {
      return '그리팅이 파일을 거부했습니다. 허용 형식(예: PDF)과 용량을 확인해 주세요.';
    }
    const accepted = items.find((item) => {
      if (item.getAttribute('data-type') !== 'accepted') return false;
      const name = item.querySelector('[data-part="item-name"]');
      return name && dom.textOf(name) === record.name;
    });
    return accepted ? true : '화면에 첨부된 파일이 표시되지 않았습니다.';
  }

  async function fillDocuments(session) {
    // 업로드 영역이 직접 속한(중첩된 하위 필드가 아닌) 필드 루트만 대상으로 한다.
    const roots = [...document.querySelectorAll(FIELD_ROOT)].filter((root) => {
      const uploader = root.querySelector('input[type="file"], [data-scope="file-upload"], [data-scope="toggle-group"]');
      return uploader && uploader.closest(FIELD_ROOT) === root;
    });
    for (const root of roots) {
      const label = text.cleanLabel(root.querySelector('label[data-part="label"]')?.textContent || '');
      const slot = matcher.matchFile(label);
      if (!slot) continue;
      const meta = await session.fileMeta(slot);
      const toggles = [...root.querySelectorAll('[data-scope="toggle-group"][data-part="item"]')];
      const urlToggle = toggles.find((toggle) => /url|링크/i.test(dom.textOf(toggle)));
      const fileToggle = toggles.find((toggle) => /파일|file/i.test(dom.textOf(toggle)));

      if (meta) {
        if (fileToggle && fileToggle.getAttribute('data-state') !== 'on') {
          fileToggle.click();
          await dom.sleep(200);
        }
        // 이미 첨부된 파일은 삭제에 확인 창이 필요한 파괴적 동작이므로, 덮어쓰기 설정과 관계없이 유지한다.
        if (uploadItems(root).length > 0) {
          session.report.add(KApply.engine.STATUS.SKIPPED, SECTION_TITLE.documents, label, '이미 첨부된 파일이 있음 (교체하려면 직접 삭제 후 다시 실행)');
          continue;
        }
        const input = await dom.waitFor(() => root.querySelector('input[type="file"]'), { timeout: 1500 });
        await session.applyFile({
          section: SECTION_TITLE.documents,
          label,
          slot,
          input,
          hint: dom.textOf(root.querySelector('[data-part="helper-text"]')),
          confirm: (record) => confirmUploaded(root, record),
          rejected: () =>
            uploadItems(root).some((item) => item.getAttribute('data-type') === 'rejected')
              ? '그리팅이 파일을 거부했습니다. 허용 형식(예: PDF)과 용량을 확인해 주세요.'
              : null,
        });
        continue;
      }

      const link = slot === 'portfolio' ? session.get('links.portfolio') : '';
      if (link && urlToggle) {
        if (urlToggle.getAttribute('data-state') !== 'on') {
          urlToggle.click();
          await dom.sleep(150);
        }
        const urlInput = await dom.waitFor(() => root.querySelector('input[name$=".url"], input[type="url"]'));
        if (urlInput) {
          await session.apply({
            section: SECTION_TITLE.documents,
            label: `${label} (URL)`,
            value: link,
            filled: controls.hasValue(urlInput),
            run: () => controls.fillText(urlInput, link),
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------

  async function fill(session) {
    await fillSingles(session);
    for (const list of LISTS) {
      await fillList(session, list);
    }
    await fillDocuments(session);

    if (document.querySelector('[name^="applicationDetail.desiredJobPositions."]')) {
      session.report.notice('지원 부문·직무는 직접 선택해 주세요.');
    }
    session.report.notice('이메일 인증, 개인정보 동의, 자기소개 문항은 직접 확인 후 제출해 주세요.');
  }

  KApply.adapters.greeting = { id: 'greeting', fill, LISTS, NAMED_FIELDS };
})();
