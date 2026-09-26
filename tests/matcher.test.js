'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/shared/matcher.js');

const { matcher } = globalThis.KApply;

const cases = [
  ['이름', 'basic.name'],
  ['성명*', 'basic.name'],
  ['영문이름', 'basic.englishName'],
  ['영문 이름 (여권)', 'basic.englishName'],
  ['이메일주소', 'basic.email'],
  ['이메일', 'basic.email'],
  ['연락처', 'basic.phone'],
  ['휴대전화', 'basic.phone'],
  ['비상 연락처', null],
  ['생년월일', 'basic.birthdate'],
  ['성별', 'basic.gender'],
  ['상세 주소', 'basic.addressDetail'],
  ['주소', 'basic.address'],
  ['이메일 주소', 'basic.email'],
  ['GitHub 주소', 'links.github'],
  ['블로그', 'links.blog'],
  ['URL', 'links.portfolio'],
  ['포트폴리오 링크', 'links.portfolio'],
  ['해당 공고를 처음 접한 경로를 선택해주세요.', 'application.source'],
  ['지원경로', 'application.source'],
  ['희망 연봉', 'application.desiredSalary'],
  ['입사 가능 시점을 알려주세요', 'application.availableFrom'],
  ['병역사항', 'military.status'],
  ['보훈여부', 'military.veteran'],
  ['보훈번호', null],
  ['장애여부', 'military.disability'],
  ['장애정도', null],
  ['회사명', null],
  ['패스트뷰와 해당 포지션에 지원한 이유를 들려주세요.', null],
];

for (const [label, expected] of cases) {
  test(`matchField("${label}") → ${expected}`, () => {
    assert.equal(matcher.matchField(label), expected);
  });
}

test('matchField: 긴 서술형 질문은 매칭하지 않는다', () => {
  assert.equal(matcher.matchField('이메일로 연락드려도 되는지 여부와 함께 본인의 강점을 자세히 소개해 주시고 그 이유도 함께 적어 주세요.'), null);
});

test('matchFile: 파일 슬롯을 구분한다', () => {
  assert.equal(matcher.matchFile('이력서'), 'resume');
  assert.equal(matcher.matchFile('포트폴리오 (선택)'), 'portfolio');
  assert.equal(matcher.matchFile('경력기술서&기타 서류'), 'careerSummary');
  assert.equal(matcher.matchFile('자기소개서'), null);
});
