/**
 * 지원 채용 솔루션 정의와 자동 감지 규칙.
 *
 * 각 솔루션은 자체 도메인 외에 기업 커스텀 도메인(예: 그리팅의 musinsacareers.com)으로도 서비스되므로
 * 호스트명뿐 아니라 DOM 구조·리소스 출처 시그니처를 함께 본다.
 *  - platform: 이 페이지가 해당 솔루션으로 만든 채용 사이트인가
 *  - form: 지금 화면에 자동 입력할 지원서 양식이 떠 있는가
 */
(function (root) {
  'use strict';

  const KApply = (root.KApply = root.KApply || {});
  if (KApply.platforms) return;

  function hostMatches(host, suffixes) {
    return suffixes.some((suffix) => host === suffix || host.endsWith('.' + suffix));
  }

  function referencesHost(doc, pattern) {
    const nodes = doc.querySelectorAll('script[src], link[href], img[src], meta[content]');
    for (const node of nodes) {
      const value = node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('content') || '';
      if (pattern.test(value)) return true;
    }
    return false;
  }

  const PLATFORMS = [
    {
      id: 'greeting',
      name: '그리팅',
      badge: 'G',
      color: '#16a34a',
      isPlatform(doc, host) {
        return (
          hostMatches(host, ['greetinghr.com']) ||
          !!doc.querySelector('[name^="basicInformation."]') ||
          referencesHost(doc, /(^|\/\/|\.)greetinghr\.com/i)
        );
      },
      hasForm(doc) {
        return !!doc.querySelector(
          '[data-scope="field"][data-part="root"] [name^="basicInformation."], [name^="applicationDocument."], [name^="educationalBackground."]'
        );
      },
    },
    {
      id: 'ninehire',
      name: '나인하이어',
      badge: '9',
      color: '#7c3aed',
      isPlatform(doc, host) {
        return (
          hostMatches(host, ['ninehire.site', 'ninehire.com']) ||
          !!doc.querySelector('[class*="ApplicationFormInput__Layout"]') ||
          referencesHost(doc, /(^|\/\/|\.)ninehire\.(site|com)/i)
        );
      },
      hasForm(doc) {
        return !!doc.querySelector('[class*="ApplicationFormInput__Layout"]');
      },
    },
    {
      id: 'midas',
      name: '마이다스인',
      badge: 'M',
      color: '#2563eb',
      isPlatform(doc, host) {
        return (
          hostMatches(host, ['recruiter.co.kr']) ||
          !!doc.querySelector('script[src*="/mit-common/"], script[src*="midas."], script[src*="/mrs2/"]')
        );
      },
      hasForm(doc) {
        return !!doc.querySelector(
          '#emailConfirm, #mobile1, [name="genderFlag"], [name="englishName"], [data-loop], [data-wrap], [name^="highschool."], [name^="military."]'
        );
      },
    },
  ];

  const BY_ID = Object.fromEntries(PLATFORMS.map((platform) => [platform.id, platform]));

  /**
   * @param {Document} doc
   * @param {{hostname:string}} loc
   * @returns {{id:string,name:string,formReady:boolean}|null}
   */
  function detect(doc, loc) {
    const host = String((loc && loc.hostname) || '').toLowerCase();
    for (const platform of PLATFORMS) {
      if (platform.isPlatform(doc, host)) {
        return { id: platform.id, name: platform.name, formReady: platform.hasForm(doc) };
      }
    }
    return null;
  }

  function describe(id) {
    const platform = BY_ID[id];
    return platform ? { id: platform.id, name: platform.name, badge: platform.badge, color: platform.color } : null;
  }

  KApply.platforms = { PLATFORMS, detect, describe };
})(typeof globalThis !== 'undefined' ? globalThis : this);
