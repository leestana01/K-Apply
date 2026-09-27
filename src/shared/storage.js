/**
 * chrome.storage.local 래퍼. 모든 데이터는 사용자의 브라우저 안에만 저장되며 외부로 전송하지 않는다.
 *
 * 키 구성
 *  - kapply.profile        : 스키마를 따르는 프로필
 *  - kapply.settings       : 동작 설정
 *  - kapply.fileMeta       : 첨부 파일 메타데이터 { [slot]: { name, type, size, sha256, updatedAt } }
 *  - kapply.file.<slot>    : 첨부 파일 본문(base64)
 *
 * 첨부 파일은 저장할 때 SHA-256을 기록하고, 꺼낼 때마다 크기와 해시를 다시 검증한다.
 * 손상·누락된 파일이 빈 파일이나 다른 내용으로 제출되는 일을 막기 위함이다.
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
    /** 목록 항목을 지원서에 넣는 순서: recent(최신순) | oldest(오래된순). 어떤 항목을 넣을지는 우선순위로 정한다. */
    entryOrder: 'recent',
    /** 정렬 기준 날짜: start(시작일) | end(종료일). 날짜가 하나인 항목(수상·자격증·어학)은 그 날짜를 쓴다. */
    entrySortKey: 'start',
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
      entryOrder: stored.entryOrder === 'oldest' || stored.entryOrder === 'recent' ? stored.entryOrder : DEFAULT_SETTINGS.entryOrder,
      entrySortKey: stored.entrySortKey === 'end' || stored.entrySortKey === 'start' ? stored.entrySortKey : DEFAULT_SETTINGS.entrySortKey,
    };
  }

  async function saveSettings(settings) {
    const current = await loadSettings();
    const next = { ...current, ...settings };
    await area().set({ [KEYS.settings]: next });
    return next;
  }

  class FileIntegrityError extends Error {
    constructor(message) {
      super(message);
      this.name = 'FileIntegrityError';
    }
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  }

  async function sha256Hex(bytes) {
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function loadFileMeta() {
    const result = await area().get(KEYS.fileMeta);
    return result[KEYS.fileMeta] || {};
  }

  /**
   * 첨부 파일을 꺼내고 무결성을 검증한다.
   * @returns {Promise<{name:string,type:string,size:number,sha256:string,updatedAt:number,bytes:Uint8Array}|null>}
   *   등록되지 않은 슬롯이면 null
   * @throws {FileIntegrityError} 등록은 되어 있으나 내용이 없거나 크기·해시가 다를 때
   */
  async function loadFile(slot) {
    const key = KEYS.filePrefix + slot;
    const [meta, result] = await Promise.all([loadFileMeta(), area().get(key)]);
    const info = meta[slot];
    if (!info) return null;
    const data = result[key];
    if (typeof data !== 'string' || data.length === 0) {
      throw new FileIntegrityError(`저장된 '${info.name}' 파일 내용이 없습니다. 옵션 화면에서 다시 등록해 주세요.`);
    }
    let bytes;
    try {
      bytes = base64ToBytes(data);
    } catch (error) {
      throw new FileIntegrityError(`저장된 '${info.name}' 파일이 손상되었습니다. 다시 등록해 주세요.`);
    }
    if (bytes.length === 0 || bytes.length !== info.size) {
      throw new FileIntegrityError(`저장된 '${info.name}' 파일 크기가 등록 당시와 다릅니다. 다시 등록해 주세요.`);
    }
    const hash = await sha256Hex(bytes);
    if (info.sha256 && hash !== info.sha256) {
      throw new FileIntegrityError(`저장된 '${info.name}' 파일 내용이 등록 당시와 다릅니다. 다시 등록해 주세요.`);
    }
    return { ...info, sha256: hash, bytes };
  }

  /**
   * @param {string} slot
   * @param {{name:string,type:string,bytes:Uint8Array}} file
   */
  async function saveFile(slot, file) {
    const bytes = file.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      throw new FileIntegrityError('빈 파일은 등록할 수 없습니다.');
    }
    const meta = await loadFileMeta();
    meta[slot] = {
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: bytes.length,
      sha256: await sha256Hex(bytes),
      updatedAt: Date.now(),
    };
    await area().set({ [KEYS.filePrefix + slot]: bytesToBase64(bytes), [KEYS.fileMeta]: meta });
    // 저장 직후 다시 읽어 검증해, 저장소 오류로 손상된 파일이 남지 않게 한다.
    try {
      await loadFile(slot);
    } catch (error) {
      await removeFile(slot);
      throw error;
    }
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
    sha256Hex,
    FileIntegrityError,
    clearAll,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
