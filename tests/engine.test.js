'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/shared/text.js');
require('../src/shared/schema.js');
require('../src/shared/storage.js');
require('../src/content/dom.js');
require('../src/content/engine.js');

const { Session } = globalThis.KApply.engine;

const awards = [
  { name: '1순위(2024)', date: '2024-10-31' },
  { name: '2순위(날짜 없음)', date: '' },
  { name: '3순위(2026)', date: '2026-07-25' },
  { name: '4순위(2025)', date: '2025-08-01' },
];
const names = (entries) => entries.map((entry) => entry.name);

test('chronological: 기본은 최신순, 날짜 없는 항목은 우선순위 순서로 뒤에 둔다', () => {
  const session = new Session({}, { entryOrder: 'recent' });
  assert.deepEqual(names(session.chronological('awards', awards)), ['3순위(2026)', '4순위(2025)', '1순위(2024)', '2순위(날짜 없음)']);
});

test('chronological: 오래된순 설정', () => {
  const session = new Session({}, { entryOrder: 'oldest' });
  assert.deepEqual(names(session.chronological('awards', awards)), ['1순위(2024)', '4순위(2025)', '3순위(2026)', '2순위(날짜 없음)']);
});

test('chronological: 우선순위로 고른 뒤 날짜로 배치한다(선택과 배치의 분리)', () => {
  const session = new Session({}, { entryOrder: 'recent' });
  const byPriority = [
    { name: 'A(1순위, 2024)', date: '2024-01-01' },
    { name: 'B(2순위, 2026)', date: '2026-01-01' },
    { name: 'C(3순위, 2025)', date: '2025-01-01' },
  ];
  // 지원서가 2건만 받으면 우선순위 상위 2건(A, B)을 고른다. C가 A보다 최근이어도 고르지 않는다.
  const capacity = 2;
  assert.deepEqual(names(session.chronological('awards', byPriority.slice(0, capacity))), ['B(2순위, 2026)', 'A(1순위, 2024)']);
});

test('chronological: 목록별 날짜 기준(경력은 시작일, 자격증은 취득일)', () => {
  const session = new Session({}, {});
  const careers = [
    { company: 'A', startDate: '2019-07' },
    { company: 'B', startDate: '2020-03' },
  ];
  assert.deepEqual(session.chronological('careers', careers).map((entry) => entry.company), ['B', 'A']);
  const certificates = [
    { name: 'X', date: '2025-01-01' },
    { name: 'Y', date: '2026-05-31' },
  ];
  assert.deepEqual(session.chronological('certificates', certificates).map((entry) => entry.name), ['Y', 'X']);
});
