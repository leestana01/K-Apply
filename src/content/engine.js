/**
 * 입력 세션: 프로필 조회, 값 변환, 결과 기록, 파일 준비를 한곳에서 담당한다.
 * 각 플랫폼 어댑터는 세션의 apply()/applyFile()을 통해서만 화면을 변경한다.
 */
(function () {
  'use strict';

  const KApply = globalThis.KApply;
  if (KApply.engine) return;

  const { dom, text, controls, storage } = KApply;

  const STATUS = Object.freeze({
    FILLED: 'filled',
    SKIPPED: 'skipped',
    FAILED: 'failed',
    MANUAL: 'manual',
  });

  const CHOICE_DICTIONARIES = {
    'basic.gender': 'gender',
    'military.status': 'militaryStatus',
    'military.veteran': 'targetFlag',
    'military.disability': 'targetFlag',
  };

  class Report {
    constructor() {
      this.entries = [];
      this.notices = [];
    }

    add(status, section, label, detail = '') {
      this.entries.push({ status, section, label: text.cleanLabel(label), detail });
    }

    notice(message) {
      if (!this.notices.includes(message)) this.notices.push(message);
    }

    count(status) {
      return this.entries.filter((entry) => entry.status === status).length;
    }

    toJSON() {
      return {
        entries: this.entries,
        notices: this.notices,
        counts: {
          filled: this.count(STATUS.FILLED),
          skipped: this.count(STATUS.SKIPPED),
          failed: this.count(STATUS.FAILED),
          manual: this.count(STATUS.MANUAL),
        },
      };
    }
  }

  class Session {
    constructor(profile, settings) {
      this.profile = profile;
      this.settings = settings;
      this.report = new Report();
      this.fileCache = new Map();
    }

    /** 'basic.name' 형태의 경로로 단일 섹션 값을 읽는다. */
    get(path) {
      const [section, key] = path.split('.');
      const holder = this.profile[section];
      return holder && !Array.isArray(holder) ? holder[key] : '';
    }

    list(sectionId) {
      return Array.isArray(this.profile[sectionId]) ? this.profile[sectionId] : [];
    }

    /** 선택형 컨트롤에 넘길 후보 표현 목록 */
    candidates(path, value = this.get(path)) {
      const dictionary = CHOICE_DICTIONARIES[path];
      if (dictionary) return text.candidatesFor(dictionary, value);
      if (path === 'application.source') return text.splitCandidates(value);
      return text.isBlank(value) ? [] : [String(value)];
    }

    /**
     * 텍스트 입력칸에 넣을 값. 입력칸의 placeholder를 보고 전화번호·날짜 표기를 맞춘다.
     */
    textValue(path, element, value = this.get(path)) {
      if (text.isBlank(value)) return '';
      const hint = element ? element.getAttribute('placeholder') || '' : '';
      if (path === 'basic.phone') {
        return /\d-\d/.test(hint) ? text.formatPhone(value) : text.digitsOnly(value) || String(value);
      }
      // 숫자 전용 입력칸(희망 연봉 등)에는 숫자만 넣고, 숫자가 없는 값("회사 내규에 따름")은 건너뛴다.
      if ((element && element.type === 'number') || /숫자|number|정수/i.test(hint)) {
        return text.digitsOnly(value);
      }
      if (path === 'basic.birthdate' || /date$/i.test(path)) {
        if (/\d{4}\.\d{2}/.test(hint) || /YYYY\.MM/i.test(hint)) return text.formatDate(value, 'YYYY.MM.DD');
        if (/\d{8}/.test(hint) || /YYYYMMDD/i.test(hint)) return text.formatDate(value, 'YYYYMMDD');
        return text.formatDate(value, 'YYYY-MM-DD') || String(value);
      }
      return String(value);
    }

    /**
     * 화면의 한 항목을 채운다.
     * @param {object} task
     * @param {string} task.section 결과 화면에 보일 섹션명
     * @param {string} task.label 결과 화면에 보일 항목명
     * @param {*} task.value 넣을 값(비어 있으면 건너뜀)
     * @param {boolean} [task.filled] 화면에 이미 값이 있는지
     * @param {() => Promise<boolean>} task.run 실제 입력 동작
     */
    async apply({ section, label, value, filled = false, run }) {
      const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
      if (empty) return STATUS.SKIPPED;
      if (filled && !this.settings.overwrite) {
        this.report.add(STATUS.SKIPPED, section, label, '이미 입력됨');
        return STATUS.SKIPPED;
      }
      try {
        const ok = await run();
        this.report.add(ok ? STATUS.FILLED : STATUS.FAILED, section, label, ok ? '' : '선택지를 찾지 못했거나 입력이 거부됨');
        return ok ? STATUS.FILLED : STATUS.FAILED;
      } catch (error) {
        this.report.add(STATUS.FAILED, section, label, error && error.message ? error.message : String(error));
        return STATUS.FAILED;
      }
    }

    manual(section, label, detail) {
      this.report.add(STATUS.MANUAL, section, label, detail);
    }

    async file(slot) {
      if (!this.fileCache.has(slot)) this.fileCache.set(slot, await storage.loadFile(slot));
      return this.fileCache.get(slot);
    }

    /**
     * 첨부 파일을 올린다. input[type=file]이 DOM에 있으면 직접 넣고,
     * 없으면(나인하이어처럼 클릭 시점에 임시 input을 만드는 경우) 페이지 브리지를 사용한다.
     */
    async applyFile({ section, label, slot, input, trigger, filled = false }) {
      const record = await this.file(slot);
      if (!record) return STATUS.SKIPPED;
      return this.apply({
        section,
        label,
        value: record.name,
        filled,
        run: async () => {
          if (input) return controls.fillFileInput(input, record);
          if (trigger) return uploadViaBridge(trigger, record);
          return false;
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 페이지(MAIN world) 파일 브리지
  // ---------------------------------------------------------------------------

  const BRIDGE_SOURCE = 'kapply-bridge';

  function waitForBridgeMessage(type, token, timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(false);
      }, timeout);
      function onMessage(event) {
        const data = event.data;
        if (event.source !== window || !data || data.source !== BRIDGE_SOURCE) return;
        if (data.type !== type || data.token !== token) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(true);
      }
      window.addEventListener('message', onMessage);
    });
  }

  async function uploadViaBridge(trigger, record) {
    const injected = await chrome.runtime.sendMessage({ type: 'kapply:inject-bridge' });
    if (!injected || !injected.ok) return false;
    const token = crypto.randomUUID();
    const bytes = dom.base64ToBytes(record.data);
    const armed = waitForBridgeMessage('armed', token, 1500);
    window.postMessage(
      { source: BRIDGE_SOURCE, type: 'arm', token, name: record.name, mime: record.type, buffer: bytes.buffer },
      location.origin,
      [bytes.buffer]
    );
    if (!(await armed)) return false;
    const consumed = waitForBridgeMessage('consumed', token, 4000);
    trigger.click();
    const ok = await consumed;
    await dom.sleep(800);
    return ok;
  }

  // ---------------------------------------------------------------------------
  // 실행 진입점
  // ---------------------------------------------------------------------------

  KApply.adapters = KApply.adapters || {};

  async function run() {
    const detected = KApply.platforms.detect(document, location);
    if (!detected) return { ok: false, code: 'UNSUPPORTED', message: '지원하지 않는 페이지입니다.' };
    const adapter = KApply.adapters[detected.id];
    if (!adapter) return { ok: false, code: 'UNSUPPORTED', message: `${detected.name} 입력 모듈을 찾을 수 없습니다.` };
    if (!detected.formReady) {
      return { ok: false, code: 'NO_FORM', platform: detected.id, message: `${detected.name} 지원서 작성 화면에서 실행해 주세요.` };
    }

    const [profile, settings] = await Promise.all([storage.loadProfile(), storage.loadSettings()]);
    const fileMeta = await storage.loadFileMeta();
    if (KApply.schema.isProfileEmpty(profile) && Object.keys(fileMeta).length === 0) {
      return { ok: false, code: 'EMPTY_PROFILE', platform: detected.id, message: '먼저 옵션 화면에서 프로필을 입력해 주세요.' };
    }

    const session = new Session(profile, settings);
    await adapter.fill(session);
    return { ok: true, platform: detected.id, platformName: detected.name, report: session.report.toJSON() };
  }

  KApply.engine = { STATUS, Session, Report, run, uploadViaBridge };
})();
