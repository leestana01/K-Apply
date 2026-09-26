/**
 * chrome.storage.local 래퍼. 모든 데이터는 사용자의 브라우저 안에만 저장되며 외부로 전송하지 않는다.
 *
 * 키 구성
 *  - kapply.profile        : 스키마를 따르는 프로필
 *  - kapply.settings       : 동작 설정
 *  - kapply.fileMeta       : 첨부 파일 메타데이터 { [slot]: { name, type, size, updatedAt } }
 *  - kapply.file.<slot>    : 첨부 파일 본문(base64)
 */
(function (root) {
  'use strict';

  const KApply = (root.KApply = root.KApply || {});
  if (KApply.storage) return;

  const KEYS = {
    profile: 'kapply.profile',
    settings: 'kapply.settings',
    fileMeta: 'kapply.fileMeta',
    filePrefix: 'kapply.file.',
  };

  const DEFAULT_SETTINGS = Object.freeze({
    /** 지원서 화면에 플로팅 버튼 표시 */
    showLauncher: true,
    /** 이미 값이 있는 칸도 덮어쓰기 */
    overwrite: false,
  });

  function area() {
    return root.chrome.storage.local;
  }

  async function loadProfile() {
    const result = await area().get(KEYS.profile);
    return KApply.schema.sanitizeProfile(result[KEYS.profile]);
  }

  async function saveProfile(profile) {
    const clean = KApply.schema.sanitizeProfile(profile);
    await area().set({ [KEYS.profile]: clean });
    return clean;
  }

  async function loadSettings() {
    const result = await area().get(KEYS.settings);
    const stored = result[KEYS.settings] || {};
    return {
      showLauncher: typeof stored.showLauncher === 'boolean' ? stored.showLauncher : DEFAULT_SETTINGS.showLauncher,
      overwrite: typeof stored.overwrite === 'boolean' ? stored.overwrite : DEFAULT_SETTINGS.overwrite,
    };
  }

  async function saveSettings(settings) {
    const current = await loadSettings();
    const next = { ...current, ...settings };
    await area().set({ [KEYS.settings]: next });
    return next;
  }

  async function loadFileMeta() {
    const result = await area().get(KEYS.fileMeta);
    return result[KEYS.fileMeta] || {};
  }

  /** @returns {Promise<{name:string,type:string,size:number,updatedAt:number,data:string}|null>} */
  async function loadFile(slot) {
    const key = KEYS.filePrefix + slot;
    const [meta, result] = await Promise.all([loadFileMeta(), area().get(key)]);
    if (!meta[slot] || !result[key]) return null;
    return { ...meta[slot], data: result[key] };
  }

  async function saveFile(slot, file) {
    const meta = await loadFileMeta();
    meta[slot] = { name: file.name, type: file.type || 'application/octet-stream', size: file.size, updatedAt: Date.now() };
    await area().set({ [KEYS.filePrefix + slot]: file.data, [KEYS.fileMeta]: meta });
    return meta[slot];
  }

  async function removeFile(slot) {
    const meta = await loadFileMeta();
    delete meta[slot];
    await area().remove(KEYS.filePrefix + slot);
    await area().set({ [KEYS.fileMeta]: meta });
  }

  async function clearAll() {
    await area().clear();
  }

  KApply.storage = {
    KEYS,
    DEFAULT_SETTINGS,
    loadProfile,
    saveProfile,
    loadSettings,
    saveSettings,
    loadFileMeta,
    loadFile,
    saveFile,
    removeFile,
    clearAll,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
