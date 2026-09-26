/**
 * 화면의 항목 라벨을 프로필 경로(section.key)로 연결하는 규칙.
 * 이름(name) 속성이 없는 양식(나인하이어, 커스텀 질문 등)에서 사용한다.
 */
(function (root) {
  'use strict';

  const KApply = (root.KApply = root.KApply || {});
  if (KApply.matcher) return;

  /**
   * 순서가 중요하다. 더 구체적인 규칙이 앞에 온다. (영문 이름 → 이름, 링크 → 주소, 상세 주소 → 주소)
   */
  const FIELD_RULES = [
    { path: 'basic.englishName', test: /영문\s*(이름|성명|명)|english\s*name|name\s*\(?\s*english|영문\s*성함/i },
    { path: 'basic.name', test: /^(지원자\s*)?(이름|성명|성함|한글\s*(이름|성명))(\s*\(한글\))?$|^(full\s*)?name$/i },
    { path: 'basic.email', test: /이메일|e-?mail|메일\s*주소/i, exclude: /인증\s*(번호|코드)|verification\s*code|추천인|보조|secondary/i },
    {
      path: 'basic.phone',
      test: /휴대\s*(폰|전화)|핸드폰|연락처|전화\s*번호|phone|mobile|cell/i,
      exclude: /비상|긴급|emergency|보호자|추천인|자택|home|회사|직장|유선/i,
    },
    { path: 'basic.birthdate', test: /생년월일|생일|birth/i },
    { path: 'basic.gender', test: /^(성별|gender|sex)$/i },
    { path: 'basic.nationality', test: /^(국적|nationality)$/i },
    { path: 'links.github', test: /github|깃허브|깃헙/i },
    { path: 'links.linkedin', test: /linkedin|링크드인/i, exclude: /경로|알게|접한/ },
    { path: 'links.blog', test: /블로그|blog|velog|tistory|brunch|medium/i },
    {
      path: 'links.portfolio',
      test: /포트폴리오|portfolio|웹\s*사이트|website|홈페이지|homepage|개인\s*(url|링크|사이트)|^url$|^링크$|^sns$/i,
    },
    { path: 'basic.postalCode', test: /우편\s*번호|zip\s*code|postal/i },
    { path: 'basic.addressDetail', test: /상세\s*주소|나머지\s*주소|detail(ed)?\s*address|address\s*detail/i },
    { path: 'basic.address', test: /주소|거주지|address/i, exclude: /이메일|메일|email|url|웹|web|ip|링크|link|사이트/i },
    {
      path: 'application.source',
      test: /지원\s*경로|접한\s*경로|알게\s*(된|되신)\s*(경로|계기)|유입\s*경로|how did you (hear|find)|referral source|application source/i,
    },
    { path: 'application.desiredSalary', test: /희망\s*(연봉|급여|처우)|desired\s*salary|expected\s*salary/i },
    { path: 'application.availableFrom', test: /입사\s*가능|근무\s*가능\s*(일|시점|일자)|입사\s*예정|available\s*(from|start)|start\s*date/i },
    { path: 'military.status', test: /^(병역(\s*(사항|구분|여부))?|군필\s*여부|military(\s*service)?)$/i },
    { path: 'military.veteran', test: /^보훈\s*(대상|여부|사항|대상\s*여부)?$/i },
    { path: 'military.disability', test: /^장애\s*(여부|사항|대상|대상\s*여부)?$/i },
  ];

  const FILE_RULES = [
    { slot: 'careerSummary', test: /경력\s*기술서|career\s*(summary|description)|경력\s*소개서/i },
    { slot: 'portfolio', test: /포트폴리오|portfolio/i },
    { slot: 'resume', test: /이력서|resume|\bcv\b/i, exclude: /자기\s*소개서|경력\s*기술서/i },
  ];

  const MAX_LABEL_LENGTH = 40;

  function prepare(label) {
    return String(label == null ? '' : label)
      .replace(/\*/g, '')
      .replace(/\((선택|필수|optional|required)\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * @param {string} label 화면 라벨
   * @returns {string|null} 'section.key' 형태의 프로필 경로
   */
  function matchField(label) {
    const text = prepare(label);
    if (!text || text.length > MAX_LABEL_LENGTH) return null;
    for (const rule of FIELD_RULES) {
      if (rule.exclude && rule.exclude.test(text)) continue;
      if (rule.test.test(text)) return rule.path;
    }
    return null;
  }

  /** @returns {'resume'|'portfolio'|'careerSummary'|null} */
  function matchFile(label) {
    const text = prepare(label);
    if (!text || text.length > MAX_LABEL_LENGTH) return null;
    for (const rule of FILE_RULES) {
      if (rule.exclude && rule.exclude.test(text)) continue;
      if (rule.test.test(text)) return rule.slot;
    }
    return null;
  }

  KApply.matcher = { matchField, matchFile, FIELD_RULES, FILE_RULES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
