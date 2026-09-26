'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/shared/text.js');
require('../src/shared/schema.js');

const { schema } = globalThis.KApply;

test('emptyProfile: 모든 섹션을 포함하고 비어 있다', () => {
  const profile = schema.emptyProfile();
  schema.SECTIONS.forEach((section) => assert.ok(section.id in profile, section.id));
  assert.equal(schema.isProfileEmpty(profile), true);
});

test('sanitizeProfile: 알 수 없는 키와 잘못된 타입을 제거한다', () => {
  const profile = schema.sanitizeProfile({
    basic: { name: '  홍길동  ', gender: 'unknown', injected: '<script>' },
    careers: [{ company: '케이어플라이', current: 'yes', employmentType: '정규직' }, 'not-an-object'],
    extra: { anything: true },
  });
  assert.equal(profile.basic.name, '홍길동');
  assert.equal(profile.basic.gender, '');
  assert.equal('injected' in profile.basic, false);
  assert.equal('extra' in profile, false);
  assert.equal(profile.careers.length, 1);
  assert.equal(profile.careers[0].current, false);
  assert.equal(profile.careers[0].employmentType, '정규직');
  assert.equal(schema.isProfileEmpty(profile), false);
});

test('sanitizeProfile: 목록은 최대 30건까지만 유지한다', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({ name: `자격증 ${index}` }));
  assert.equal(schema.sanitizeProfile({ certificates: many }).certificates.length, 30);
});

test('emptyEntry: 목록형 select는 첫 선택지를 기본값으로 쓴다', () => {
  const entry = schema.emptyEntry(schema.SECTION_BY_ID.educations);
  assert.equal(entry.level, 'university');
  assert.equal(entry.school, '');
});
