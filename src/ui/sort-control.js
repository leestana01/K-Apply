/**
 * 목록 항목 정렬 설정 버튼(정렬 기준 · 방향). 옵션 화면과 툴바 팝업이 함께 쓴다.
 * 설정은 바로 저장되며, 다음 자동 입력부터 적용된다.
 */
(function (root) {
  'use strict';

  const KApply = (root.KApply = root.KApply || {});
  if (KApply.sortControl) return;

  const GROUPS = [
    {
      key: 'entrySortKey',
      label: '정렬 기준',
      hint: '수상·자격증·어학은 수상일·취득일·응시일 기준',
      options: [
        ['start', '시작일'],
        ['end', '종료일'],
      ],
    },
    {
      key: 'entryOrder',
      label: '정렬 방향',
      hint: '',
      options: [
        ['recent', '최신순'],
        ['oldest', '오래된순'],
      ],
    },
  ];

  function node(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    Object.entries(attributes).forEach(([name, value]) => {
      if (name === 'className') element.className = value;
      else if (name === 'textContent') element.textContent = value;
      else element.setAttribute(name, value);
    });
    [].concat(children).forEach((child) => child && element.append(child));
    return element;
  }

  /**
   * @param {HTMLElement} container
   * @param {object} settings 현재 설정
   * @param {(patch:object) => Promise<object>} save 설정 저장(저장된 전체 설정을 돌려줌)
   * @param {(settings:object) => void} [onChange]
   */
  function render(container, settings, save, onChange) {
    container.replaceChildren();
    GROUPS.forEach((group) => {
      const labelId = `sort-${group.key}`;
      const buttons = group.options.map(([value, text]) =>
        node('button', {
          type: 'button',
          className: 'seg-button',
          role: 'radio',
          'aria-checked': String(settings[group.key] === value),
          'data-value': value,
          textContent: text,
        })
      );
      const bar = node('div', { className: 'seg-group', role: 'radiogroup', 'aria-labelledby': labelId }, buttons);
      buttons.forEach((button) =>
        button.addEventListener('click', async () => {
          if (button.getAttribute('aria-checked') === 'true') return;
          const next = await save({ [group.key]: button.dataset.value });
          buttons.forEach((other) => other.setAttribute('aria-checked', String(other === button)));
          if (onChange) onChange(next);
        })
      );
      // 방향키로 선택을 옮길 수 있게 한다(라디오 그룹 관례).
      bar.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const index = buttons.indexOf(document.activeElement);
        if (index < 0) return;
        const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
        next.focus();
        next.click();
      });
      container.append(
        node('div', { className: 'sort-row' }, [
          node('div', {}, [
            node('span', { id: labelId, className: 'sort-label', textContent: group.label }),
            group.hint ? node('span', { className: 'sort-hint', textContent: group.hint }) : null,
          ]),
          bar,
        ])
      );
    });
  }

  KApply.sortControl = { render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
