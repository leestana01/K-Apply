/**
 * 저수준 DOM 헬퍼. React/jQuery 등 프레임워크가 값 변경을 인식하도록 실제 사용자 입력과
 * 같은 순서로 이벤트를 발생시킨다.
 */
(function () {
  'use strict';

  const KApply = globalThis.KApply;
  if (KApply.dom) return;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** predicate가 truthy 값을 돌려줄 때까지 기다린다. 시간이 지나면 null. */
  async function waitFor(predicate, { timeout = 2500, interval = 50 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = predicate();
      if (value) return value;
      if (Date.now() > deadline) return null;
      await sleep(interval);
    }
  }

  function prototypeOf(element) {
    if (element instanceof HTMLTextAreaElement) return HTMLTextAreaElement.prototype;
    if (element instanceof HTMLSelectElement) return HTMLSelectElement.prototype;
    return HTMLInputElement.prototype;
  }

  /**
   * React는 input의 value 프로퍼티를 가로채 변경 여부를 추적하므로
   * 프로토타입의 setter로 값을 넣은 뒤 input 이벤트를 보내야 onChange가 실행된다.
   */
  function setNativeValue(element, value) {
    const descriptor = Object.getOwnPropertyDescriptor(prototypeOf(element), 'value');
    descriptor.set.call(element, value);
  }

  function fire(element, type, init = {}) {
    const EventType = type.startsWith('key') ? KeyboardEvent : type.startsWith('focus') || type === 'blur' ? FocusEvent : Event;
    element.dispatchEvent(new EventType(type, { bubbles: type !== 'blur' && type !== 'focus', cancelable: true, ...init }));
  }

  function keyInit(key) {
    const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40 };
    const keyCode = codes[key] || 0;
    return { key, code: key, keyCode, which: keyCode };
  }

  function press(element, key) {
    const init = keyInit(key);
    fire(element, 'keydown', init);
    if (key === 'Enter') fire(element, 'keypress', init);
    fire(element, 'keyup', init);
  }

  /** 텍스트 입력: 값 설정 → input/change → keyup → blur 순으로 이벤트를 보낸다. */
  function typeValue(element, value, { blur = true } = {}) {
    setNativeValue(element, value);
    fire(element, 'input');
    fire(element, 'change');
    fire(element, 'keyup', keyInit(''));
    if (blur) {
      fire(element, 'focusout');
      fire(element, 'blur');
    }
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    if (element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return element.getClientRects().length > 0;
  }

  function isEditable(element) {
    return !!element && !element.disabled && !element.readOnly && isVisible(element);
  }

  function textOf(element) {
    return element ? String(element.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  /** 범용 라벨 추출: aria → label[for] → 감싼 label → title → placeholder */
  function labelOf(element) {
    if (!element) return '';
    const aria = element.getAttribute('aria-label');
    if (aria) return aria;
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => textOf(document.getElementById(id)))
        .join(' ')
        .trim();
      if (text) return text;
    }
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label && textOf(label)) return textOf(label);
    }
    const wrapping = element.closest('label');
    if (wrapping) {
      // 라벨이 컨트롤을 감싼 경우 select의 선택지 등 컨트롤 자체의 텍스트는 제외한다.
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll('select, option, input, textarea, button').forEach((node) => node.remove());
      if (textOf(clone)) return textOf(clone);
    }
    return element.getAttribute('title') || element.getAttribute('placeholder') || '';
  }

  /** 가장 가까운 공통 조상 중 selector에 해당하는 요소를 포함하는 최소 컨테이너 */
  function closestContaining(element, selector, stop = document.body) {
    let node = element;
    while (node && node !== stop) {
      if (node.querySelector(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  KApply.dom = {
    sleep,
    waitFor,
    setNativeValue,
    fire,
    press,
    typeValue,
    isVisible,
    isEditable,
    textOf,
    labelOf,
    closestContaining,
  };
})();
