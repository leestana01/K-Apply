/**
 * 텍스트 정규화·선택지 매칭·날짜/전화번호 포맷 등 DOM에 의존하지 않는 순수 유틸리티.
 * 콘텐츠 스크립트, 확장 페이지, Node 테스트에서 동일하게 사용한다.
 */
(function (root) {
  'use strict';

  const KApply = (root.KApply = root.KApply || {});
  if (KApply.text) return;

  /** 비교용 정규화: 소문자화, 공백·필수표시(*)·구두점 제거 */
  function normalize(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[\s*·•:：\-_/\\.,'"`~!?()[\]{}<>]/g, '');
  }

  /** 라벨 표시용 정리: 필수표시 제거, 연속 공백 축약 */
  function cleanLabel(value) {
    return String(value == null ? '' : value)
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isBlank(value) {
    return value == null || String(value).trim() === '';
  }

  function digitsOnly(value) {
    return String(value == null ? '' : value).replace(/\D/g, '');
  }

  /**
   * 국내 휴대전화/유선 번호를 [앞, 중간, 끝]으로 분리한다.
   * +82 로 시작하면 0을 복원한다.
   */
  function splitPhone(value) {
    let digits = digitsOnly(value);
    if (digits.startsWith('82') && digits.length >= 11) digits = '0' + digits.slice(2);
    if (digits.length < 9) return null;
    if (digits.startsWith('02')) {
      const middleLength = digits.length - 6;
      return [digits.slice(0, 2), digits.slice(2, 2 + middleLength), digits.slice(2 + middleLength)];
    }
    const middleLength = digits.length - 7;
    return [digits.slice(0, 3), digits.slice(3, 3 + middleLength), digits.slice(3 + middleLength)];
  }

  function formatPhone(value) {
    const parts = splitPhone(value);
    return parts ? parts.join('-') : String(value || '');
  }

  /**
   * 'YYYY-MM-DD' 또는 'YYYY-MM' 문자열을 {y, m, d}로 파싱한다.
   * 구분자는 -, ., / 를 모두 허용한다.
   */
  function parseDate(value) {
    const match = String(value == null ? '' : value)
      .trim()
      .match(/^(\d{4})[-./]?(\d{1,2})(?:[-./]?(\d{1,2}))?$/);
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = match[3] ? Number(match[3]) : null;
    if (m < 1 || m > 12) return null;
    if (d !== null && (d < 1 || d > 31)) return null;
    return { y, m, d };
  }

  /**
   * 날짜를 패턴(YYYY, MM, DD, M, D)에 맞춰 출력한다. 일자가 없으면 1일로 간주한다.
   * @example formatDate('2020-03', 'YYYY.MM') === '2020.03'
   */
  function formatDate(value, pattern) {
    const parsed = parseDate(value);
    if (!parsed) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const day = parsed.d || 1;
    return pattern
      .replace('YYYY', String(parsed.y))
      .replace('MM', pad(parsed.m))
      .replace('DD', pad(day))
      .replace(/\bM\b/, String(parsed.m))
      .replace(/\bD\b/, String(day));
  }

  /**
   * 선택지 목록에서 후보 표현과 가장 잘 맞는 항목의 인덱스를 찾는다.
   * 후보 배열의 앞쪽일수록 우선순위가 높다.
   * @param {string[]} options 화면에 보이는 선택지 텍스트
   * @param {string[]} candidates 선호 표현(동의어 포함)
   * @returns {number} 일치 인덱스, 없으면 -1
   */
  function pickOption(options, candidates) {
    const normalizedOptions = options.map(normalize);
    const list = (Array.isArray(candidates) ? candidates : [candidates])
      .map(normalize)
      .filter(Boolean);

    let best = { index: -1, score: 0 };
    list.forEach((candidate, rank) => {
      const rankBonus = (list.length - rank) / (list.length + 1);
      normalizedOptions.forEach((option, index) => {
        if (!option) return;
        let score = 0;
        if (option === candidate) score = 4;
        else if (option.startsWith(candidate) || candidate.startsWith(option)) score = 2;
        else if (option.includes(candidate) || candidate.includes(option)) score = 1;
        if (score === 0) return;
        const total = score + rankBonus;
        if (total > best.score) best = { index, score: total };
      });
    });
    return best.index;
  }

  /** 쉼표·줄바꿈으로 구분된 선호값 목록을 배열로 */
  function splitCandidates(value) {
    return String(value == null ? '' : value)
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  /** 프로필 코드값 → 화면 선택지 동의어 사전 */
  const SYNONYMS = {
    gender: {
      male: ['남성', '남자', '남', 'Male', 'M'],
      female: ['여성', '여자', '여', 'Female', 'F'],
    },
    educationLevel: {
      highschool: ['고등학교', '고교', '고졸'],
      ged: ['검정고시'],
      college: ['전문대학', '대학교(2,3년)', '2,3년제', '2~3년', '전문대', '초대졸'],
      university: ['대학교(4년)', '대학교(4년이상)', '4년제', '대학교', '학사', '대졸'],
      master: ['대학원(석사)', '석사', '석박사통합'],
      doctor: ['대학원(박사)', '박사'],
    },
    graduateDegree: {
      master: ['석사'],
      doctor: ['박사', '석박사통합'],
    },
    militaryStatus: {
      비대상: ['비대상', '해당없음', '해당 없음', '대상아님'],
      군필: ['군필', '병역필', '필', '만기전역', '전역'],
      미필: ['미필'],
      면제: ['면제'],
      복무중: ['복무중', '복무 중', '재복무'],
    },
    targetFlag: {
      비대상: ['비대상', '해당없음', '아니오', '없음', 'N'],
      대상: ['대상', '해당', '예', '있음', 'Y'],
    },
  };

  /** 동의어 사전을 조회해 후보 표현 목록을 만든다. 사전에 없으면 값 자체를 후보로 쓴다. */
  function candidatesFor(dictionary, value) {
    if (isBlank(value)) return [];
    const table = SYNONYMS[dictionary] || {};
    return table[value] ? table[value].slice() : splitCandidates(value);
  }

  KApply.text = {
    normalize,
    cleanLabel,
    isBlank,
    digitsOnly,
    splitPhone,
    formatPhone,
    parseDate,
    formatDate,
    pickOption,
    splitCandidates,
    candidatesFor,
    SYNONYMS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
