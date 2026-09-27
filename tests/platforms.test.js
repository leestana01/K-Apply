'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/shared/platforms.js');

const { platforms } = globalThis.KApply;

/** 셀렉터 → 존재 여부 규칙으로 동작하는 최소한의 가짜 document */
function fakeDocument({ selectors = [], resources = [] } = {}) {
  return {
    querySelector(selector) {
      return selectors.some((item) => selector.includes(item)) ? {} : null;
    },
    querySelectorAll() {
      return resources.map((url) => ({ getAttribute: (name) => (name === 'src' ? url : null) }));
    },
  };
}

test('도메인으로 각 솔루션을 감지한다', () => {
  assert.equal(platforms.detect(fakeDocument(), { hostname: 'musinsa.career.greetinghr.com' }).id, 'greeting');
  assert.equal(platforms.detect(fakeDocument(), { hostname: 'codit.ninehire.site' }).id, 'ninehire');
  assert.equal(platforms.detect(fakeDocument(), { hostname: 'nhqv.recruiter.co.kr' }).id, 'midas');
});

test('커스텀 도메인은 리소스 출처로 감지한다', () => {
  const doc = fakeDocument({ resources: ['https://profiles.greetinghr.com/group/abc'] });
  assert.equal(platforms.detect(doc, { hostname: 'www.musinsacareers.com' }).id, 'greeting');
});

test('커스텀 도메인은 DOM 시그니처로 감지한다', () => {
  const doc = fakeDocument({ selectors: ['ApplicationFormInput__Layout'] });
  const result = platforms.detect(doc, { hostname: 'careers.example.com' });
  assert.equal(result.id, 'ninehire');
  assert.equal(result.formReady, true);
});

test('마이다스인 리소스 경로를 감지한다', () => {
  const doc = fakeDocument({ selectors: ['/mit-common/'] });
  assert.equal(platforms.detect(doc, { hostname: 'recruit.example.co.kr' }).id, 'midas');
});

test('관련 없는 페이지는 null', () => {
  assert.equal(platforms.detect(fakeDocument(), { hostname: 'www.google.com' }), null);
});

test('describe: 배지 정보를 돌려준다', () => {
  assert.deepEqual(Object.keys(platforms.describe('greeting')).sort(), ['badge', 'color', 'id', 'name']);
  assert.equal(platforms.describe('unknown'), null);
});

test('마이다스인 새 지원서 화면(/v1/applicant)을 입력 양식으로 인식한다', () => {
  const doc = fakeDocument({ selectors: ['[name^="basicInfoGroupAnswers."]'] });
  const result = platforms.detect(doc, { hostname: 'iprovest.recruiter.co.kr' });
  assert.equal(result.id, 'midas');
  assert.equal(result.formReady, true);
  assert.equal(platforms.detect(fakeDocument(), { hostname: 'iprovest.recruiter.co.kr' }).formReady, false);
});

test('마이다스인 새 화면의 학력·경력 단계는 입력칸이 없어도 경로로 입력 양식을 인식한다', () => {
  const result = platforms.detect(fakeDocument(), { hostname: 'iprovest.recruiter.co.kr', pathname: '/v1/applicant/resume-form/266891' });
  assert.equal(result.formReady, true);
  assert.equal(platforms.detect(fakeDocument(), { hostname: 'iprovest.recruiter.co.kr', pathname: '/v1/applicant/notice/266891' }).formReady, false);
});
