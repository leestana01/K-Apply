#!/usr/bin/env node
/**
 * 배포 전 정적 점검
 *  1. manifest.json 과 package.json 의 버전 일치
 *  2. manifest·서비스 워커·HTML 이 참조하는 모든 파일 존재
 *  3. 모든 JavaScript 파일 문법 검사 (node --check)
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const read = (path) => readFileSync(join(root, path), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));

if (manifest.version !== pkg.version) {
  errors.push(`버전 불일치: manifest ${manifest.version} / package.json ${pkg.version}`);
}

const referenced = new Set();
Object.values(manifest.icons || {}).forEach((path) => referenced.add(path));
Object.values(manifest.action?.default_icon || {}).forEach((path) => referenced.add(path));
referenced.add(manifest.action.default_popup);
referenced.add(manifest.options_ui.page);
referenced.add(manifest.background.service_worker);
manifest.content_scripts.forEach((script) => script.js.forEach((path) => referenced.add(path)));

// 서비스 워커가 동적으로 주입하는 파일
const worker = read(manifest.background.service_worker);
for (const match of worker.matchAll(/'(src\/[^']+\.js)'/g)) referenced.add(match[1]);
for (const match of worker.matchAll(/importScripts\('([^']+)'\)/g)) {
  referenced.add(relative(root, resolve(root, dirname(manifest.background.service_worker), match[1])));
}

// 확장 페이지가 불러오는 스크립트·스타일
for (const page of [manifest.action.default_popup, manifest.options_ui.page]) {
  const html = read(page);
  for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png))"/g)) {
    referenced.add(relative(root, resolve(root, dirname(page), match[1])));
  }
}

for (const path of referenced) {
  if (!existsSync(join(root, path))) errors.push(`참조 파일 없음: ${path}`);
}

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const scripts = [...walk(join(root, 'src')), ...walk(join(root, 'tests')), ...walk(join(root, 'scripts'))].filter((path) =>
  /\.(m?js)$/.test(path)
);
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    errors.push(`문법 오류: ${relative(root, file)}\n${error.stderr.toString()}`);
  }
}

if (errors.length) {
  console.error(errors.map((message) => `✖ ${message}`).join('\n'));
  process.exit(1);
}
console.log(`✔ manifest v${manifest.version} · 참조 파일 ${referenced.size}개 · 스크립트 ${scripts.length}개 점검 완료`);
