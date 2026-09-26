'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/shared/text.js');

const { text } = globalThis.KApply;

test('normalize: 공백·필수표시·구두점을 제거하고 소문자로 만든다', () => {
  assert.equal(text.normalize(' 이메일 주소 * '), '이메일주소');
  assert.equal(text.normalize('E-Mail'), 'email');
});

test('splitPhone: 휴대전화·서울 지역번호·국가번호를 분리한다', () => {
  assert.deepEqual(text.splitPhone('010-1234-5678'), ['010', '1234', '5678']);
  assert.deepEqual(text.splitPhone('01012345678'), ['010', '1234', '5678']);
  assert.deepEqual(text.splitPhone('+82 10-1234-5678'), ['010', '1234', '5678']);
  assert.deepEqual(text.splitPhone('02-123-4567'), ['02', '123', '4567']);
  assert.deepEqual(text.splitPhone('011-123-4567'), ['011', '123', '4567']);
  assert.equal(text.splitPhone('1234'), null);
});

test('formatPhone: 하이픈 표기로 통일한다', () => {
  assert.equal(text.formatPhone('01012345678'), '010-1234-5678');
});

test('parseDate: 다양한 구분자와 연월 형식을 받는다', () => {
  assert.deepEqual(text.parseDate('2020-03-15'), { y: 2020, m: 3, d: 15 });
  assert.deepEqual(text.parseDate('2020.03'), { y: 2020, m: 3, d: null });
  assert.deepEqual(text.parseDate('20200315'), { y: 2020, m: 3, d: 15 });
  assert.equal(text.parseDate('2020-13-01'), null);
  assert.equal(text.parseDate(''), null);
});

test('formatDate: 패턴에 맞춰 출력하고 일자가 없으면 1일로 채운다', () => {
  assert.equal(text.formatDate('1995-03-15', 'YYYY.MM.DD'), '1995.03.15');
  assert.equal(text.formatDate('2020-03', 'YYYY.MM'), '2020.03');
  assert.equal(text.formatDate('2020-03', 'YYYY-MM-DD'), '2020-03-01');
  assert.equal(text.formatDate('1995-03-15', 'YYYYMMDD'), '19950315');
  assert.equal(text.formatDate('invalid', 'YYYY.MM.DD'), '');
});

test('pickOption: 정확히 일치하는 선택지를 우선한다', () => {
  const options = ['졸업', '졸업예정', '재학', '휴학'];
  assert.equal(text.pickOption(options, ['졸업']), 0);
  assert.equal(text.pickOption(options, ['졸업예정']), 1);
});

test('pickOption: 후보 순서가 우선순위가 된다', () => {
  const options = ['회사 홈페이지', '채용 포털', 'SNS', '기타'];
  assert.equal(text.pickOption(options, ['링크드인', '채용 포털', '기타']), 1);
});

test('pickOption: 부분 일치를 허용하고 없으면 -1', () => {
  assert.equal(text.pickOption(['검정고시', '고등학교', '전문대학', '대학교(4년이상)'], text.candidatesFor('educationLevel', 'university')), 3);
  assert.equal(text.pickOption(['남성', '여성'], text.candidatesFor('gender', 'female')), 1);
  assert.equal(text.pickOption(['남', '여'], text.candidatesFor('gender', 'male')), 0);
  assert.equal(text.pickOption(['A', 'B'], ['없는값']), -1);
});

test('candidatesFor: 사전에 없는 값은 쉼표로 분리해 그대로 쓴다', () => {
  assert.deepEqual(text.candidatesFor('unknown', '링크드인, 원티드'), ['링크드인', '원티드']);
  assert.deepEqual(text.candidatesFor('gender', ''), []);
  assert.ok(text.candidatesFor('militaryStatus', '군필').includes('병역필'));
});

test('matchListed: 정확히 일치하는 코드 항목을 고른다', () => {
  const options = ['남서울대학교', '서울대학교', '서울과학기술대학교'];
  assert.deepEqual(text.matchListed(options, '서울대학교'), { index: 1, exact: true });
});

test('matchListed: 캠퍼스를 지정하면 해당 캠퍼스 항목을 고른다', () => {
  const options = ['남서울대학교', '서울대학교 (관악)', '서울대학교 (연건)', '서울대학교 (평창)'];
  assert.deepEqual(text.matchListed(options, '서울대학교', { campus: '관악' }), { index: 1, exact: true });
  assert.deepEqual(text.matchListed(options, '서울대학교', { campus: '관악캠퍼스' }), { index: 1, exact: true });
  assert.deepEqual(text.matchListed(['연세대학교(신촌캠퍼스)'], '연세대학교', { campus: '신촌' }), { index: 0, exact: true });
});

test('matchListed: 캠퍼스 항목이 여럿이면 추측하지 않는다', () => {
  const options = ['남서울대학교', '서울대학교 (관악)', '서울대학교 (연건)'];
  const result = text.matchListed(options, '서울대학교');
  assert.equal(result.index, -1);
  assert.equal(result.ambiguous, true);
  assert.deepEqual(result.choices, ['서울대학교 (관악)', '서울대학교 (연건)']);
});

test('matchListed: 지정한 캠퍼스가 목록에 없으면 다른 캠퍼스를 고르지 않는다', () => {
  const result = text.matchListed(['서울대학교 (관악)', '서울대학교'], '서울대학교', { campus: '평창' });
  assert.equal(result.index, -1);
  assert.equal(result.ambiguous, true);
});

test('matchListed: 캠퍼스 구분 항목이 하나뿐이면 고르되 확인 메모를 남긴다', () => {
  const result = text.matchListed(['한국공학대학교', '한국대학교 (본교)'], '한국대학교');
  assert.equal(result.index, 1);
  assert.equal(result.exact, false);
  assert.match(result.note, /한국대학교 \(본교\)/);
});

test('matchListed: 부분 일치로 다른 학교를 고르지 않는다', () => {
  assert.deepEqual(text.matchListed(['남서울대학교', '서울대학교병원'], '서울대학교'), { index: -1 });
  assert.deepEqual(text.matchListed(['TOEIC Speaking'], 'TOEIC'), { index: -1 });
});

test('fileFormatMismatch: accept 속성을 따른다', () => {
  assert.equal(text.fileFormatMismatch({ name: 'cv.pdf', type: 'application/pdf' }, { accept: '.pdf' }), null);
  assert.match(text.fileFormatMismatch({ name: 'cv.docx', type: '' }, { accept: '.pdf,.hwp' }), /\.pdf, \.hwp/);
  assert.equal(text.fileFormatMismatch({ name: 'photo.png', type: 'image/png' }, { accept: 'image/*' }), null);
});

test('fileFormatMismatch: 요구 문구를 따른다', () => {
  const hint = 'PDF 형식으로 제출해주세요.';
  assert.equal(text.fileFormatMismatch({ name: '이력서.pdf', type: 'application/pdf' }, { hint }), null);
  assert.match(text.fileFormatMismatch({ name: '이력서.txt', type: 'text/plain' }, { hint }), /PDF 형식을 요구/);
  assert.match(text.fileFormatMismatch({ name: 'a.docx', type: '' }, { hint: 'PDF 또는 HWP 파일만 업로드 가능합니다' }), /PDF 또는 한글\(HWP\)/);
});

test('fileFormatMismatch: 요구가 아닌 안내 문구는 무시한다', () => {
  const hint = '파일 첨부 (50MB 이하, 업로드한 문서는 PDF 파일로 자동 변환됩니다.)';
  assert.equal(text.fileFormatMismatch({ name: 'a.docx', type: '' }, { hint }), null);
  assert.equal(text.fileFormatMismatch({ name: 'a.docx', type: '' }, { hint: '포트폴리오를 첨부해 주세요' }), null);
  assert.equal(text.fileFormatMismatch({ name: 'a.docx', type: '' }, {}), null);
});
