/**
 * 프로필 스키마 — 옵션 화면 렌더링, 저장 데이터 정제, 입력 엔진이 모두 이 정의를 따른다.
 *
 * kind: 'single' 은 한 벌의 값, 'list' 는 여러 건(학력·경력 등)을 가진다.
 * type: text | email | tel | url | date(YYYY-MM-DD) | month(YYYY-MM) | select | textarea | checkbox | number
 */
(function (root) {
  'use strict';

  const KApply = (root.KApply = root.KApply || {});
  if (KApply.schema) return;

  const MONTH_HINT = '예: 2020-03';

  const SECTIONS = [
    {
      id: 'basic',
      title: '기본 정보',
      kind: 'single',
      fields: [
        { key: 'name', label: '이름', type: 'text', placeholder: '홍길동', autocomplete: 'name' },
        { key: 'englishName', label: '영문 이름', type: 'text', placeholder: 'Gildong Hong', hint: '여권 표기와 동일하게 입력하세요.' },
        { key: 'email', label: '이메일', type: 'email', placeholder: 'name@example.com', autocomplete: 'email' },
        { key: 'phone', label: '휴대전화', type: 'tel', placeholder: '010-1234-5678', autocomplete: 'tel' },
        { key: 'birthdate', label: '생년월일', type: 'date' },
        {
          key: 'gender',
          label: '성별',
          type: 'select',
          options: [
            ['', '선택 안 함'],
            ['male', '남성'],
            ['female', '여성'],
          ],
        },
        { key: 'nationality', label: '국적', type: 'text', placeholder: '대한민국' },
        { key: 'postalCode', label: '우편번호', type: 'text', placeholder: '06236' },
        { key: 'address', label: '주소', type: 'text', placeholder: '서울특별시 강남구 테헤란로 000' },
        { key: 'addressDetail', label: '상세 주소', type: 'text', placeholder: '000동 000호' },
      ],
    },
    {
      id: 'links',
      title: '링크',
      kind: 'single',
      fields: [
        { key: 'portfolio', label: '포트폴리오 / 웹사이트', type: 'url', placeholder: 'https://' },
        { key: 'github', label: 'GitHub', type: 'url', placeholder: 'https://github.com/username' },
        { key: 'blog', label: '블로그', type: 'url', placeholder: 'https://' },
        { key: 'linkedin', label: 'LinkedIn', type: 'url', placeholder: 'https://www.linkedin.com/in/username' },
      ],
    },
    {
      id: 'application',
      title: '지원 정보',
      kind: 'single',
      fields: [
        {
          key: 'source',
          label: '지원 경로',
          type: 'text',
          placeholder: '링크드인, 채용 포털, 기타',
          hint: '쉼표로 여러 후보를 적으면 선택지에 있는 첫 번째 항목을 고릅니다.',
        },
        { key: 'desiredSalary', label: '희망 연봉', type: 'text', placeholder: '회사 내규에 따름' },
        { key: 'availableFrom', label: '입사 가능 시점', type: 'text', placeholder: '즉시 가능 / 합격 후 2주' },
      ],
    },
    {
      id: 'military',
      title: '병역 · 보훈 · 장애',
      kind: 'single',
      fields: [
        {
          key: 'status',
          label: '병역 구분',
          type: 'select',
          options: [
            ['', '선택 안 함'],
            ['비대상', '비대상'],
            ['군필', '군필'],
            ['미필', '미필'],
            ['면제', '면제'],
            ['복무중', '복무 중'],
          ],
        },
        { key: 'branch', label: '군별', type: 'text', placeholder: '육군' },
        { key: 'rank', label: '계급', type: 'text', placeholder: '병장' },
        { key: 'startDate', label: '입대일', type: 'date' },
        { key: 'endDate', label: '전역일', type: 'date' },
        { key: 'discharge', label: '제대 구분', type: 'text', placeholder: '만기제대' },
        { key: 'exemptionReason', label: '면제 사유', type: 'text' },
        {
          key: 'veteran',
          label: '보훈 대상',
          type: 'select',
          options: [
            ['', '선택 안 함'],
            ['비대상', '비대상'],
            ['대상', '대상'],
          ],
        },
        {
          key: 'disability',
          label: '장애 여부',
          type: 'select',
          options: [
            ['', '선택 안 함'],
            ['비대상', '비대상'],
            ['대상', '대상'],
          ],
        },
      ],
    },
    {
      id: 'educations',
      title: '학력',
      kind: 'list',
      itemLabel: '학교',
      summary: ['school', 'major'],
      fields: [
        {
          key: 'level',
          label: '학력 구분',
          type: 'select',
          options: [
            ['university', '대학교(4년)'],
            ['college', '전문대학(2·3년)'],
            ['master', '대학원(석사)'],
            ['doctor', '대학원(박사)'],
            ['highschool', '고등학교'],
            ['ged', '검정고시'],
          ],
        },
        { key: 'school', label: '학교명', type: 'text', placeholder: '서울대학교', hint: '공식 명칭으로 입력하세요. 지원서의 학교 목록(학교 코드)과 정확히 같은 이름을 고릅니다.' },
        {
          key: 'campus',
          label: '캠퍼스',
          type: 'text',
          placeholder: '관악',
          hint: '학교 목록이 캠퍼스별로 나뉜 경우(예: 서울대학교 (관악)) 입력하지 않으면 자동으로 고르지 않습니다. 학교명에는 캠퍼스를 붙이지 마세요.',
        },
        {
          key: 'campusType',
          label: '본교 / 분교',
          type: 'select',
          options: [
            ['', '선택 안 함'],
            ['본교', '본교'],
            ['분교', '분교'],
          ],
          hint: '이원화 캠퍼스(예: 한국외국어대학교 글로벌캠퍼스)는 본교입니다. 본교·분교를 따로 묻는 지원서에 사용합니다.',
        },
        { key: 'major', label: '전공', type: 'text', placeholder: '컴퓨터공학과' },
        { key: 'minor', label: '부전공', type: 'text' },
        { key: 'doubleMajor', label: '복수전공', type: 'text' },
        {
          key: 'status',
          label: '졸업 구분',
          type: 'select',
          options: [
            ['졸업', '졸업'],
            ['졸업예정', '졸업예정'],
            ['재학', '재학'],
            ['휴학', '휴학'],
            ['수료', '수료'],
            ['중퇴', '중퇴'],
          ],
        },
        { key: 'startDate', label: '입학', type: 'month', hint: MONTH_HINT },
        { key: 'endDate', label: '졸업(예정)', type: 'month', hint: MONTH_HINT },
        { key: 'gpa', label: '학점', type: 'text', placeholder: '3.8' },
        {
          key: 'gpaScale',
          label: '만점 기준',
          type: 'select',
          options: [
            ['4.5', '4.5'],
            ['4.3', '4.3'],
            ['4.0', '4.0'],
            ['100', '100'],
          ],
        },
      ],
    },
    {
      id: 'careers',
      title: '경력',
      kind: 'list',
      itemLabel: '경력',
      summary: ['company', 'position'],
      fields: [
        { key: 'company', label: '회사명', type: 'text' },
        { key: 'department', label: '부서', type: 'text' },
        { key: 'position', label: '직급 / 직책', type: 'text' },
        {
          key: 'employmentType',
          label: '고용 형태',
          type: 'select',
          options: [
            ['정규직', '정규직'],
            ['계약직', '계약직'],
            ['인턴', '인턴'],
            ['파견직', '파견직'],
            ['프리랜서', '프리랜서'],
            ['아르바이트', '아르바이트'],
            ['기타', '기타'],
          ],
        },
        { key: 'startDate', label: '입사', type: 'month', hint: MONTH_HINT },
        { key: 'endDate', label: '퇴사', type: 'month', hint: '재직 중이면 비워 두세요.' },
        { key: 'current', label: '재직 중', type: 'checkbox' },
        { key: 'duties', label: '담당 업무', type: 'textarea' },
        { key: 'resignReason', label: '퇴직 사유', type: 'text' },
      ],
    },
    {
      id: 'projects',
      title: '프로젝트',
      kind: 'list',
      itemLabel: '프로젝트',
      summary: ['name', 'organization'],
      fields: [
        { key: 'name', label: '프로젝트명', type: 'text' },
        { key: 'organization', label: '소속 / 발주처', type: 'text' },
        { key: 'role', label: '역할', type: 'text' },
        { key: 'startDate', label: '시작', type: 'month', hint: MONTH_HINT },
        { key: 'endDate', label: '종료', type: 'month', hint: MONTH_HINT },
        { key: 'contribution', label: '기여도(%)', type: 'number' },
        { key: 'description', label: '내용', type: 'textarea' },
        { key: 'url', label: '링크', type: 'url', placeholder: 'https://' },
      ],
    },
    {
      id: 'activities',
      title: '대외활동 · 동아리 · 봉사',
      kind: 'list',
      itemLabel: '활동',
      summary: ['name', 'organization'],
      fields: [
        {
          key: 'type',
          label: '활동 구분',
          type: 'select',
          options: [
            ['대외활동', '대외활동'],
            ['동아리', '동아리'],
            ['봉사활동', '봉사활동'],
            ['해외경험', '해외경험'],
            ['기타', '기타'],
          ],
        },
        { key: 'name', label: '활동명', type: 'text' },
        { key: 'organization', label: '기관 / 단체', type: 'text' },
        { key: 'role', label: '역할', type: 'text' },
        { key: 'startDate', label: '시작', type: 'month', hint: MONTH_HINT },
        { key: 'endDate', label: '종료', type: 'month', hint: MONTH_HINT },
        { key: 'hours', label: '활동 시간', type: 'number' },
        { key: 'description', label: '내용', type: 'textarea' },
      ],
    },
    {
      id: 'trainings',
      title: '교육 이수',
      kind: 'list',
      itemLabel: '교육',
      summary: ['course', 'institution'],
      fields: [
        { key: 'course', label: '과정명', type: 'text' },
        { key: 'institution', label: '교육 기관', type: 'text' },
        { key: 'startDate', label: '시작', type: 'month', hint: MONTH_HINT },
        { key: 'endDate', label: '종료', type: 'month', hint: MONTH_HINT },
        { key: 'hours', label: '이수 시간', type: 'number' },
        { key: 'description', label: '주요 내용', type: 'textarea' },
      ],
    },
    {
      id: 'languages',
      title: '어학',
      kind: 'list',
      itemLabel: '어학 시험',
      summary: ['test', 'score'],
      fields: [
        { key: 'language', label: '언어', type: 'text', placeholder: '영어' },
        { key: 'test', label: '시험명', type: 'text', placeholder: 'TOEIC' },
        { key: 'score', label: '점수', type: 'text', placeholder: '900' },
        { key: 'grade', label: '등급', type: 'text', placeholder: 'IH' },
        { key: 'date', label: '취득일', type: 'date' },
        { key: 'number', label: '등록 번호', type: 'text' },
      ],
    },
    {
      id: 'certificates',
      title: '자격증',
      kind: 'list',
      itemLabel: '자격증',
      summary: ['name', 'issuer'],
      fields: [
        { key: 'name', label: '자격증명', type: 'text', placeholder: '정보처리기사' },
        { key: 'issuer', label: '발행 기관', type: 'text', placeholder: '한국산업인력공단' },
        { key: 'date', label: '취득일', type: 'date' },
        { key: 'number', label: '자격 번호', type: 'text' },
        { key: 'grade', label: '등급 / 점수', type: 'text' },
      ],
    },
    {
      id: 'awards',
      title: '수상',
      kind: 'list',
      itemLabel: '수상',
      summary: ['name', 'issuer'],
      fields: [
        { key: 'name', label: '수상명', type: 'text' },
        { key: 'issuer', label: '수여 기관', type: 'text' },
        { key: 'date', label: '수상일', type: 'date' },
        { key: 'description', label: '수상 내용', type: 'textarea' },
      ],
    },
  ];

  const FILE_SLOTS = [
    { key: 'resume', label: '이력서', hint: 'PDF 권장' },
    { key: 'portfolio', label: '포트폴리오', hint: 'PDF 권장' },
    { key: 'careerSummary', label: '경력기술서', hint: 'PDF 권장' },
  ];

  /** 파일 1개 최대 크기 (각 채용 솔루션의 업로드 한도 중 가장 보수적인 값에 맞춤) */
  const MAX_FILE_BYTES = 20 * 1024 * 1024;

  const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((section) => [section.id, section]));

  function emptyEntry(section) {
    const entry = {};
    section.fields.forEach((field) => {
      entry[field.key] = field.type === 'checkbox' ? false : field.type === 'select' && section.kind === 'list' ? field.options[0][0] : '';
    });
    return entry;
  }

  function emptyProfile() {
    const profile = { version: 1 };
    SECTIONS.forEach((section) => {
      if (section.kind === 'list') profile[section.id] = [];
      else {
        profile[section.id] = {};
        section.fields.forEach((field) => {
          profile[section.id][field.key] = '';
        });
      }
    });
    return profile;
  }

  function sanitizeValue(field, value) {
    if (field.type === 'checkbox') return value === true;
    if (value == null) return '';
    const text = String(value).slice(0, 5000);
    if (field.type === 'select') {
      const allowed = field.options.map((option) => option[0]);
      return allowed.includes(text) ? text : '';
    }
    return field.type === 'textarea' ? text : text.trim();
  }

  /** 저장소·가져오기 파일에서 읽은 임의의 객체를 스키마에 맞게 정제한다. */
  function sanitizeProfile(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const profile = emptyProfile();
    SECTIONS.forEach((section) => {
      const input = source[section.id];
      if (section.kind === 'list') {
        profile[section.id] = (Array.isArray(input) ? input : [])
          .slice(0, 30)
          .filter((item) => item && typeof item === 'object')
          .map((item) => {
            const entry = {};
            section.fields.forEach((field) => {
              entry[field.key] = sanitizeValue(field, item[field.key]);
            });
            return entry;
          });
      } else {
        const values = input && typeof input === 'object' ? input : {};
        section.fields.forEach((field) => {
          profile[section.id][field.key] = sanitizeValue(field, values[field.key]);
        });
      }
    });
    return profile;
  }

  function isProfileEmpty(profile) {
    return SECTIONS.every((section) => {
      const value = profile[section.id];
      if (section.kind === 'list') return !value || value.length === 0;
      return Object.values(value || {}).every((item) => item === '' || item === false);
    });
  }

  KApply.schema = {
    SECTIONS,
    SECTION_BY_ID,
    FILE_SLOTS,
    MAX_FILE_BYTES,
    emptyEntry,
    emptyProfile,
    sanitizeProfile,
    isProfileEmpty,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
