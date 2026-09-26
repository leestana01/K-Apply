# 새 채용 솔루션 추가하기

새 솔루션(ATS)을 추가하는 작업은 보통 다음 네 단계로 끝납니다.

## 1. 화면 구조 조사

로그인 없이 열 수 있는 공개 공고의 지원서 화면에서 개발자 도구로 다음을 확인합니다. **실제로 제출하지 마세요.**

- 입력 요소에 `name`·`id`가 있는지, 없다면 항목 제목은 어느 요소에 있는지
- 선택형·날짜·검색형 입력이 어떤 UI 라이브러리로 만들어졌는지 (Ark UI, Ant Design, MUI, jQuery 플러그인 등)
- 반복 항목을 추가하는 방법 (추가 버튼, 하위 폼 저장 버튼 등)
- 기업 전용 도메인에서도 유지되는 시그니처 (리소스 호스트, 고유 클래스명, 스크립트 경로)

## 2. 감지 규칙 추가 — `src/shared/platforms.js`

```js
{
  id: 'example',
  name: '예시 ATS',
  badge: 'E',
  color: '#0ea5e9',
  isPlatform(doc, host) {
    return hostMatches(host, ['example-ats.com']) || referencesHost(doc, /example-ats\.com/i);
  },
  hasForm(doc) {
    return !!doc.querySelector('form[data-example-apply]');
  },
}
```

`tests/platforms.test.js`에 도메인·커스텀 도메인 감지 테스트를 추가합니다.

## 3. 어댑터 작성 — `src/content/adapters/<id>.js`

```js
(function () {
  'use strict';
  const KApply = globalThis.KApply;
  KApply.adapters = KApply.adapters || {};
  if (KApply.adapters.example) return;

  const { controls, matcher } = KApply;

  async function fill(session) {
    for (const input of document.querySelectorAll('form input[type="text"]')) {
      const path = matcher.matchField(input.labels[0]?.textContent || '');
      if (!path) continue;
      const value = session.textValue(path, input);
      await session.apply({
        section: '기본 정보',
        label: input.labels[0].textContent,
        value,
        filled: controls.hasValue(input),
        run: () => controls.fillText(input, value),
      });
    }
  }

  KApply.adapters.example = { id: 'example', fill };
})();
```

원칙:

- 화면 변경은 반드시 `session.apply()` / `session.applyFile()`을 거칩니다. 덮어쓰기 설정과 결과 리포트가 여기서 처리됩니다.
- 제출·동의·비밀번호·인증 요소는 건드리지 않습니다.
- 사용자가 직접 해야 하는 일은 `session.manual()` 또는 `session.report.notice()`로 알립니다.
- 새 UI 컴포넌트 입력 방식이 필요하면 `src/content/controls.js`에 일반화된 함수로 추가합니다.

## 4. 등록

- `src/background/service-worker.js`의 `ENGINE_FILES`에 어댑터 파일을 추가합니다(`runner.js`보다 앞).
- README의 지원 범위 표와 `CHANGELOG.md`를 갱신합니다.
- `npm test`, `npm run check`를 통과시키고, 실제 지원서 화면에서의 확인 결과를 PR에 적습니다.
