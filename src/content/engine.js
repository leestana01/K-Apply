/**
 * 입력 세션: 프로필 조회, 값 변환, 결과 기록, 파일 준비를 한곳에서 담당한다.
 * 각 플랫폼 어댑터는 세션의 apply()/applyFile()을 통해서만 화면을 변경한다.
 */
(function () {
  'use strict';

  const KApply = globalThis.KApply;
  if (KApply.engine) return;

  const { dom, text, storage } = KApply;

  /**
   * filled  : 입력 완료
   * review  : 입력했지만 사용자가 확인해야 함 (목록에 없어 직접 입력, 캠퍼스 자동 선택 등)
   * failed  : 입력하지 못함
   * manual  : 사용자가 직접 해야 하는 항목
   * skipped : 이미 값이 있어 건너뜀
   */
  const STATUS = Object.freeze({
    FILLED: 'filled',
    REVIEW: 'review',
    SKIPPED: 'skipped',
    FAILED: 'failed',
    MANUAL: 'manual',
  });

  const DEFAULT_FAILURE = '선택지를 찾지 못했거나 입력이 거부됨';

  /**
   * 입력기의 반환값을 표준 형태로 바꾼다.
   * boolean 또는 { ok, review?, reason?, detail? }
   */
  function toOutcome(value) {
    if (value && typeof value === 'object') return value;
    return { ok: value === true };
  }

  const CHOICE_DICTIONARIES = {
    'basic.gender': 'gender',
    'military.status': 'militaryStatus',
    'military.discharge': 'discharge',
    'military.veteran': 'targetFlag',
    'military.disability': 'targetFlag',
  };

  /**
   * 실패·확인 안내가 무엇에 대한 것인지 알 수 있도록, 입력하려던 값이 문구에 없으면 덧붙인다.
   * 선택형은 후보 목록의 첫 값(프로필 값)을 쓴다.
   */
  function withValue(message, value) {
    const shown = Array.isArray(value) ? value[0] : value;
    if (shown === undefined || shown === null || typeof shown === 'object') return message;
    const textValue = String(shown).trim();
    if (!textValue || String(message).includes(textValue)) return message;
    const clipped = textValue.length > 40 ? `${textValue.slice(0, 40)}…` : textValue;
    return `${message} (입력값: '${clipped}')`;
  }

  /** 목록 항목의 표시 이름: 스키마의 요약 필드 중 첫 번째 값 */
  function entryTitle(sectionId, entry) {
    const section = (KApply.schema.SECTIONS || []).find((item) => item.id === sectionId);
    const keys = (section && section.summary) || ['name'];
    for (const key of keys) {
      if (!text.isBlank(entry && entry[key])) return String(entry[key]).trim();
    }
    return '';
  }

  /**
   * 정렬에 쓸 날짜 값(YYYYMMDD 숫자). 종료일 기준에서 진행 중(재직 중·종료일 없음)이면 가장 최근으로 본다.
   * 날짜가 없으면 null.
   */
  function dateValue(sectionId, entry, sortKey) {
    const dates = (KApply.schema.SORT_DATES || {})[sectionId] || {};
    const toNumber = (value) => {
      const parsed = text.parseDate(value);
      return parsed ? parsed.y * 10000 + parsed.m * 100 + (parsed.d || 0) : null;
    };
    if (dates.single) return toNumber(entry[dates.single]);
    if (sortKey === 'end') {
      const end = toNumber(entry[dates.end]);
      if (end !== null) return end;
      const ongoing = (dates.ongoing && entry[dates.ongoing] === true) || (toNumber(entry[dates.start]) !== null && text.isBlank(entry[dates.end]));
      return ongoing ? Number.MAX_SAFE_INTEGER : null;
    }
    return toNumber(entry[dates.start]);
  }

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
          review: this.count(STATUS.REVIEW),
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
        const outcome = toOutcome(await run());
        if (!outcome.ok) {
          this.report.add(STATUS.FAILED, section, label, withValue(outcome.reason || DEFAULT_FAILURE, value));
          return STATUS.FAILED;
        }
        if (outcome.review) {
          this.report.add(STATUS.REVIEW, section, label, withValue(outcome.review, value));
          return STATUS.REVIEW;
        }
        this.report.add(STATUS.FILLED, section, label, outcome.detail || '');
        return STATUS.FILLED;
      } catch (error) {
        this.report.add(STATUS.FAILED, section, label, withValue(error && error.message ? error.message : String(error), value));
        return STATUS.FAILED;
      }
    }

    /**
     * 넣을 항목을 날짜로 정렬한 복사본. 어떤 항목을 넣을지는 우선순위(목록 순서)로 먼저 고르고,
     * 고른 항목을 넣는 순서만 설정의 정렬 기준(시작일·종료일, 날짜가 하나인 목록은 그 날짜)과
     * 방향(최신순·오래된순)으로 정한다. 날짜가 없는 항목은 우선순위 순서로 뒤에 둔다.
     */
    chronological(sectionId, entries) {
      const recent = this.settings.entryOrder !== 'oldest';
      const sortKey = this.settings.entrySortKey === 'end' ? 'end' : 'start';
      return entries
        .map((entry, rank) => ({ entry, rank, date: dateValue(sectionId, entry, sortKey) }))
        .sort((a, b) => {
          if (a.date === null || b.date === null) return a.date === null && b.date === null ? a.rank - b.rank : a.date === null ? 1 : -1;
          return a.date === b.date ? a.rank - b.rank : recent ? b.date - a.date : a.date - b.date;
        })
        .map((item) => item.entry);
    }

    manual(section, label, detail) {
      this.report.add(STATUS.MANUAL, section, label, detail);
    }

    /**
     * 지원서가 받는 개수를 넘어 넣지 못한 목록 항목을 한 줄로 알린다.
     * 받는 개수는 기업마다 다르므로(대표 1건, 최대 3건 등) 가정하지 않고, 사이트가 더 받지 않을 때 호출한다.
     * @param {string} section
     * @param {string} sectionId 프로필 목록 id (educations, awards …) — 항목 이름 표시에 사용
     * @param {object[]} entries 넣지 못한 항목
     * @param {number} [accepted] 지원서에 들어간 개수(알 수 있을 때)
     */
    overflow(section, sectionId, entries, accepted) {
      if (!entries.length) return;
      const names = entries.map((entry) => entryTitle(sectionId, entry)).filter(Boolean);
      const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` 외 ${names.length - 3}건` : '');
      // 기업의 규칙을 단정하지 않고 관찰한 사실만 적는다(추가 칸이 사라졌거나 안내 문구의 개수에 이름).
      const limit = Number.isInteger(accepted) && accepted > 0 ? `지원서에 ${accepted}건이 들어가 있고 ` : '';
      this.report.add(
        STATUS.MANUAL,
        section,
        `입력하지 않은 ${entries.length}건`,
        `${limit}더 추가할 수 없어 ${shown ? `${shown}을(를) ` : ''}넣지 않았습니다. 1순위부터 채우므로, 대표로 낼 항목은 옵션 화면에서 [대표로 지정]하거나 순위를 올려 주세요.`
      );
    }

    /** 등록된 첨부 파일의 메타데이터 (없으면 null) */
    async fileMeta(slot) {
      return (await storage.loadFileMeta())[slot] || null;
    }

    /**
     * 첨부 파일을 올리고 서버 수신까지 검증한다.
     *
     * 1. 저장된 파일의 크기·SHA-256을 검증한다. 등록돼 있는데 내용이 없거나 손상됐으면 실패로 보고한다.
     * 2. 페이지 브리지에 업로드 감시를 등록한다.
     * 3. input[type=file]에 직접 넣거나(그리팅), 업로드 버튼이 만드는 임시 input을 가로채 넣는다(나인하이어).
     * 4. 실제 업로드 요청 본문의 크기·SHA-256이 원본과 같고 응답이 2xx일 때만 성공으로 본다.
     * 5. 어댑터가 넘긴 confirm()으로 화면에 첨부 완료 상태가 표시됐는지 확인한다.
     *
     * @param {object} options
     * @param {string} options.section
     * @param {string} options.label
     * @param {string} options.slot resume | portfolio | careerSummary
     * @param {HTMLInputElement} [options.input]
     * @param {HTMLElement} [options.trigger]
     * @param {boolean} [options.filled]
     * @param {(record:object) => (true|string)} [options.confirm] 화면 확인. 실패 시 사유 문자열
     * @param {() => (string|null)} [options.rejected] 사이트가 파일을 거부했다고 표시하면 사유를 돌려준다(빠른 실패)
     * @param {string} [options.hint] 업로드 칸의 안내 문구 (요구 형식 판별용)
     */
    async applyFile({ section, label, slot, input, trigger, filled = false, confirm, rejected, hint = '' }) {
      const meta = (await storage.loadFileMeta())[slot];
      if (!meta) return STATUS.SKIPPED;
      return this.apply({
        section,
        label,
        value: meta.name,
        filled,
        run: async () => {
          let record;
          try {
            record = await storage.loadFile(slot);
          } catch (error) {
            return { ok: false, reason: error.message };
          }
          if (!record) return { ok: false, reason: '저장된 파일을 찾을 수 없습니다. 옵션 화면에서 다시 등록해 주세요.' };
          if (!input && !trigger) return { ok: false, reason: '파일 업로드 칸을 찾지 못했습니다.' };
          const mismatch = text.fileFormatMismatch(record, { accept: input ? input.getAttribute('accept') || '' : '', hint });
          if (mismatch) return { ok: false, reason: `'${record.name}': ${mismatch}` };

          const upload = await watchUpload(record);
          if (!upload) return { ok: false, reason: '업로드 검증 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };

          let attached;
          if (input) attached = await attachToInput(input, record);
          else attached = await uploadViaBridge(trigger, record);
          if (!attached.ok) {
            upload.cancel();
            return attached;
          }

          const result = await Promise.race([upload.result, watchRejection(rejected)]);
          if (result.rejected) {
            upload.cancel();
            return { ok: false, reason: result.rejected };
          }
          if (!result.ok) {
            return {
              ok: false,
              reason:
                result.reason === 'timeout'
                  ? '서버로 파일이 전송되는 것을 확인하지 못했습니다. 첨부 상태를 직접 확인해 주세요.'
                  : `서버가 파일을 받지 않았습니다 (HTTP ${result.status || '오류'}). 파일 형식·용량을 확인해 주세요.`,
            };
          }
          if (confirm) {
            await dom.sleep(400);
            const shown = confirm(record);
            if (shown !== true) return { ok: false, reason: typeof shown === 'string' ? shown : '화면에 첨부 완료 상태가 표시되지 않았습니다.' };
          }
          return { ok: true, detail: `서버 업로드 확인 · ${formatBytes(record.size)} · SHA-256 일치` };
        },
      });
    }
  }

  /** 업로드를 기다리는 동안 사이트의 거부 표시를 감시한다. 거부되지 않으면 끝나지 않는다. */
  function watchRejection(rejected) {
    if (!rejected) return new Promise(() => {});
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const reason = rejected();
        if (reason) {
          clearInterval(timer);
          resolve({ rejected: reason });
        }
      }, 300);
    });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }

  function toFile(record) {
    return new File([record.bytes], record.name, { type: record.type, lastModified: record.updatedAt || Date.now() });
  }

  /**
   * input에 파일을 넣고, 들어간 파일이 원본과 같은지 확인한 뒤 변경 이벤트를 보낸다.
   * 페이지가 change 처리 후 input을 비우는 경우가 있어 이벤트 전에 확인한다.
   */
  async function attachToInput(input, record) {
    const transfer = new DataTransfer();
    transfer.items.add(toFile(record));
    input.files = transfer.files;
    const attached = input.files && input.files[0];
    if (!attached) return { ok: false, reason: '파일을 업로드 칸에 넣지 못했습니다.' };
    const hash = await storage.sha256Hex(new Uint8Array(await attached.arrayBuffer()));
    if (attached.size !== record.size || hash !== record.sha256) return { ok: false, reason: '업로드 칸에 들어간 파일이 원본과 다릅니다.' };
    dom.fire(input, 'input');
    dom.fire(input, 'change');
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // 페이지(MAIN world) 파일 브리지
  // ---------------------------------------------------------------------------

  const BRIDGE_SOURCE = 'kapply-bridge';

  /** 조건에 맞는 브리지 메시지를 기다린다. 시간이 지나면 null. */
  function waitForBridgeMessage(type, token, timeout) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(null);
      }, timeout);
      function onMessage(event) {
        const data = event.data;
        if (event.source !== window || !data || data.source !== BRIDGE_SOURCE) return;
        if (data.type !== type || data.token !== token) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(data);
      }
      window.addEventListener('message', onMessage);
    });
  }

  function postToBridge(message, transfer) {
    window.postMessage({ source: BRIDGE_SOURCE, ...message }, location.origin, transfer || []);
  }

  async function ensureBridge() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'kapply:inject-bridge' });
      return !!(response && response.ok);
    } catch (error) {
      return false;
    }
  }

  /** 업로드 크기에 비례한 대기 시간 (최소 30초, 1MB당 5초 추가) */
  function uploadTimeout(size) {
    return 30000 + Math.ceil(size / (1024 * 1024)) * 5000;
  }

  /**
   * 서버 업로드 감시를 시작한다.
   * @returns {Promise<{result: Promise<{ok:boolean,status?:number,reason?:string}>, cancel: () => void}|null>}
   */
  async function watchUpload(record) {
    if (!(await ensureBridge())) return null;
    const token = crypto.randomUUID();
    const timeoutMs = uploadTimeout(record.size);
    const watching = waitForBridgeMessage('watching', token, 1500);
    postToBridge({ type: 'watch', token, size: record.size, sha256: record.sha256, timeoutMs });
    if (!(await watching)) return null;
    const result = waitForBridgeMessage('upload-result', token, timeoutMs + 2000).then(
      (data) => data || { ok: false, reason: 'timeout' }
    );
    return { result, cancel: () => postToBridge({ type: 'unwatch', token }) };
  }

  /**
   * 업로드 버튼이 클릭 시점에 임시 input을 만드는 경우: 브리지가 다음 파일 선택 1회를 가로채 파일을 넣는다.
   */
  async function uploadViaBridge(trigger, record) {
    if (!(await ensureBridge())) return { ok: false, reason: '파일 첨부 모듈을 불러오지 못했습니다.' };
    const token = crypto.randomUUID();
    const buffer = record.bytes.slice().buffer;
    const armed = waitForBridgeMessage('armed', token, 1500);
    postToBridge({ type: 'arm', token, name: record.name, mime: record.type, buffer }, [buffer]);
    if (!(await armed)) return { ok: false, reason: '파일 첨부 모듈이 응답하지 않습니다.' };
    const consumed = waitForBridgeMessage('consumed', token, 4000);
    trigger.click();
    if (!(await consumed)) return { ok: false, reason: '업로드 버튼이 파일 선택을 요청하지 않았습니다.' };
    return { ok: true };
  }

  /**
   * 카카오 우편번호 위젯을 여는 버튼을 누르되, 위젯 대신 저장된 주소로 선택 결과를 전달한다.
   * @param {HTMLElement} trigger 주소 검색 버튼
   * @param {{zonecode:string, roadAddress:string, jibunAddress:string}} result
   */
  async function postcodeViaBridge(trigger, result) {
    if (!(await ensureBridge())) return { ok: false, reason: '주소 입력 모듈을 불러오지 못했습니다.' };
    const token = crypto.randomUUID();
    const armed = waitForBridgeMessage('postcode-armed', token, 1500);
    postToBridge({ type: 'arm-postcode', token, result });
    if (!(await armed)) return { ok: false, reason: '주소 입력 모듈이 응답하지 않습니다.' };
    const consumed = waitForBridgeMessage('postcode-consumed', token, 5000);
    trigger.click();
    if (!(await consumed)) return { ok: false, reason: '주소 검색 창(카카오 우편번호)이 열리지 않았습니다.' };
    await dom.sleep(300);
    return { ok: true };
  }

  /**
   * 외부 인증 창(새 창)을 막은 채로 action을 실행한다. 막은 횟수를 돌려준다.
   * 브리지를 쓸 수 없으면 action을 실행하지 않고 null을 돌려준다(창이 열릴 위험을 피한다).
   * @param {() => Promise<*>} action
   * @returns {Promise<{value:*, blocked:(number|null)}|null>}
   */
  async function withPopupGuard(action) {
    if (!(await ensureBridge())) return null;
    const token = crypto.randomUUID();
    const armed = waitForBridgeMessage('popup-guard-armed', token, 1500);
    postToBridge({ type: 'arm-popup-guard', token });
    if (!(await armed)) return null;
    let value;
    let result;
    try {
      value = await action();
    } finally {
      result = waitForBridgeMessage('popup-guard-result', token, 1500);
      postToBridge({ type: 'release-popup-guard', token });
    }
    const released = await result;
    // 결과를 받지 못하면(차단 시간 초과로 먼저 해제됨) 창이 열렸는지 알 수 없으므로 null
    return { value, blocked: released ? Number(released.blocked) || 0 : null };
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

  KApply.engine = { STATUS, Session, Report, run, toOutcome, uploadTimeout, postcodeViaBridge, withPopupGuard };
})();
