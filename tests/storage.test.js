'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/shared/text.js');
require('../src/shared/schema.js');
require('../src/shared/storage.js');

const { storage } = globalThis.KApply;

/** chrome.storage.local 대역 */
function installFakeStorage() {
  const data = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = keys == null ? Object.keys(data) : [].concat(keys);
          return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
        },
        async set(values) {
          Object.assign(data, structuredClone(values));
        },
        async remove(keys) {
          [].concat(keys).forEach((key) => delete data[key]);
        },
        async clear() {
          Object.keys(data).forEach((key) => delete data[key]);
        },
      },
    },
  };
  return data;
}

const bytesOf = (text) => new TextEncoder().encode(text);

test('saveFile/loadFile: 크기와 SHA-256을 기록하고 같은 바이트를 돌려준다', async () => {
  installFakeStorage();
  const bytes = bytesOf('%PDF-1.4 테스트 이력서');
  const meta = await storage.saveFile('resume', { name: '이력서.pdf', type: 'application/pdf', bytes });
  assert.equal(meta.size, bytes.length);
  assert.match(meta.sha256, /^[0-9a-f]{64}$/);
  const loaded = await storage.loadFile('resume');
  assert.deepEqual([...loaded.bytes], [...bytes]);
  assert.equal(loaded.sha256, meta.sha256);
});

test('loadFile: 등록하지 않은 슬롯은 null', async () => {
  installFakeStorage();
  assert.equal(await storage.loadFile('portfolio'), null);
});

test('loadFile: 메타데이터만 있고 내용이 없으면 오류', async () => {
  const data = installFakeStorage();
  await storage.saveFile('resume', { name: 'a.pdf', type: 'application/pdf', bytes: bytesOf('abc') });
  delete data['kapply.file.resume'];
  await assert.rejects(storage.loadFile('resume'), (error) => error instanceof storage.FileIntegrityError && /내용이 없습니다/.test(error.message));
});

test('loadFile: 내용이 바뀌면 오류', async () => {
  const data = installFakeStorage();
  await storage.saveFile('resume', { name: 'a.pdf', type: 'application/pdf', bytes: bytesOf('abc') });
  data['kapply.file.resume'] = Buffer.from('abd').toString('base64');
  await assert.rejects(storage.loadFile('resume'), /등록 당시와 다릅니다/);
});

test('loadFile: 크기가 다르면 오류', async () => {
  const data = installFakeStorage();
  await storage.saveFile('resume', { name: 'a.pdf', type: 'application/pdf', bytes: bytesOf('abc') });
  data['kapply.file.resume'] = Buffer.from('abcd').toString('base64');
  await assert.rejects(storage.loadFile('resume'), /크기가 등록 당시와 다릅니다/);
});

test('saveFile: 빈 파일은 거부한다', async () => {
  installFakeStorage();
  await assert.rejects(storage.saveFile('resume', { name: 'empty.pdf', type: 'application/pdf', bytes: new Uint8Array(0) }), /빈 파일/);
  assert.deepEqual(await storage.loadFileMeta(), {});
});

test('saveFile: 큰 파일도 손실 없이 저장한다', async () => {
  installFakeStorage();
  const bytes = new Uint8Array(3 * 1024 * 1024);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31) % 256;
  await storage.saveFile('portfolio', { name: 'big.pdf', type: 'application/pdf', bytes });
  const loaded = await storage.loadFile('portfolio');
  assert.equal(loaded.bytes.length, bytes.length);
  assert.equal(Buffer.compare(Buffer.from(loaded.bytes), Buffer.from(bytes)), 0);
});
