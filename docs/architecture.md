# 아키텍처

K-Apply는 빌드 도구와 런타임 의존성이 없는 Manifest V3 확장프로그램입니다. 모든 스크립트는 `globalThis.KApply` 네임스페이스에 모듈을 등록하는 IIFE 형태로, 콘텐츠 스크립트·확장 페이지·서비스 워커·Node 테스트에서 같은 파일을 그대로 불러옵니다.

## 실행 흐름

```
┌──────────────────────── 모든 http(s) 페이지 ─────────────────────────┐
│ content_scripts: shared/platforms.js + content/detector.js           │
│   · 호스트명 / DOM 시그니처 / 리소스 출처로 솔루션 판별                    │
│   · SPA 화면 전환은 MutationObserver로 재평가 (700ms 디바운스)            │
│   · 결과만 서비스 워커로 보고: { platform, formReady }                   │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────── background/service-worker.js ─────────────────────┐
│ · 탭별 배지(G/9/M)와 제목 갱신                                          │
│ · 입력 엔진 주입 (chrome.scripting.executeScript, ISOLATED world)        │
│ · 팝업·단축키의 실행 요청을 탭으로 전달                                   │
│ · 파일 브리지 주입 (MAIN world, 요청 시에만)                              │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────── 입력 엔진 (ISOLATED) ─────────────────────────┐
│ runner.js   메시지 처리 · 플로팅 버튼 · 결과 토스트 (Shadow DOM)          │
│ engine.js   Session: 프로필 조회 · 값 변환 · 결과 기록 · 파일 준비          │
│ adapters/*  솔루션별 화면 구조 해석 → Session.apply()로만 값 변경           │
│ controls.js 네이티브 / Ark UI / Ant Design / 마이다스인 컨트롤 입력기       │
│ dom.js      React·jQuery가 인식하는 이벤트 시퀀스                          │
└──────────────────────────────────────────────────────────────────────┘
```

자동 입력은 **항상 사용자 동작(버튼·팝업·단축키)으로만 시작**합니다. 감지 스크립트는 입력값을 읽지 않고, 엔진은 제출·동의 버튼을 누르지 않습니다.

## 데이터 모델

`src/shared/schema.js`가 단일 기준입니다. 옵션 화면은 이 정의로 폼을 그리고, 저장소는 이 정의로 데이터를 정제(`sanitizeProfile`)하며, 어댑터는 섹션·필드 키로 값을 읽습니다.

| 종류 | 섹션 |
| --- | --- |
| 단일(`single`) | `basic`, `links`, `application`, `military` |
| 목록(`list`) | `educations`, `careers`, `projects`, `activities`, `trainings`, `languages`, `certificates`, `awards` |

날짜는 `YYYY-MM-DD`(일자) 또는 `YYYY-MM`(연월)로 저장하고, 입력 시점에 대상 컨트롤의 포맷으로 변환합니다. 선택형 값은 `shared/text.js`의 동의어 사전(`SYNONYMS`)으로 화면 선택지와 맞춥니다.

## 값을 확정하는 방법

프레임워크마다 "값이 바뀌었다"를 인식하는 방식이 달라, 단순히 `input.value`를 바꾸는 것으로는 부족합니다.

| 대상 | 방법 |
| --- | --- |
| React 제어 입력 | 프로토타입 setter로 값을 넣고 `input` 이벤트 발생 (값 추적기 우회) |
| jQuery 핸들러 | `input` · `change` · `keyup` · `blur`를 순서대로 발생 |
| Ark UI Select | 트리거 클릭 → 목록 항목 클릭 |
| Ark UI DatePicker | 팝오버 안의 입력창에 `YYYY-MM-DD` 입력 후 Enter |
| Ark UI Combobox | `focusin` → `InputEvent` → 비동기 제안 목록에서 일치 항목 또는 "직접 입력하기"(`[[new]]`) 선택 → `focusout` |
| Ant Design Dropdown | 이전 메뉴가 닫힐 때까지 기다린 뒤 새로 열린 메뉴에서 선택 |
| Ant Design DatePicker | 설정 포맷을 읽을 수 없으므로 흔한 포맷을 차례로 입력하고, 포커스를 뺀 뒤 값이 남는지로 확정 여부 판단 |
| 마이다스인 검색 입력 | 키워드 입력 → Enter(`keypress`) → 결과 버튼 또는 "직접 등록하기" 클릭 |

브라우저 창이 포커스를 잃은 상태에서는 `element.focus()`가 포커스 이벤트를 만들지 않으므로, 포커스가 필요한 컨트롤에는 `focus`/`focusin` 이벤트를 직접 보냅니다.

## 파일 첨부

- 문서에 `input[type=file]`이 있으면 `DataTransfer`로 파일을 넣고 `change` 이벤트를 보냅니다(그리팅).
- 나인하이어는 업로드 버튼을 누를 때 **문서에 붙지 않은 임시 input**을 만들고 `click()`으로 파일 선택창을 엽니다. 콘텐츠 스크립트는 페이지 쪽 프로토타입을 바꿀 수 없으므로, 서비스 워커가 `src/main/file-bridge.js`를 MAIN world에 주입합니다. 브리지는 `arm` 메시지를 받은 뒤 5초 안의 **첫 파일 선택 1회만** 가로채 파일을 넣고 즉시 원래 동작으로 복구합니다.

## 솔루션별 특징

### 그리팅

- 입력 요소의 `name`이 폼 경로입니다. 예: `basicInformation.name`, `workHistory.workExperiences.0.companyName`.
- 반복 항목은 인덱스로 구분되며, 섹션 안의 `항목 추가` 버튼으로 행을 늘립니다.
- 기업 커스텀 도메인은 `*.greetinghr.com` 리소스 참조로 감지합니다.

### 나인하이어

- `name`이 없어 항목 블록(`ApplicationFormInput__Layout`)의 제목(`EditableLabel__Input`)으로 의미를 판별합니다.
- 학력·경력 등 일반 항목은 하위 입력 폼을 채우고 `입력사항 저장`을 눌러 한 건씩 추가합니다. 저장된 목록에 같은 이름이 있으면 건너뜁니다.

### 마이다스인

- 단계별로 저장되는 다단계 지원서입니다. 각 단계 화면에 있는 항목만 채웁니다.
- 반복 항목은 `div[data-loop="<이름>"]` 행과 `name="<이름>[i].<필드>"`를 쓰며, 행 안의 `[data-button="add"]`(대학은 `[data-button="addCollege"]`)로 행을 추가합니다.
- 대표 항목을 고르기 전에는 연동 필드가 `disabled`이므로, 정해진 순서로 입력하며 활성화를 기다립니다.
- 날짜 포맷은 `data-dates="<그룹>:<YMD|YM|END>"`에서 결정합니다.

## 테스트 전략

- `tests/`는 DOM에 의존하지 않는 순수 로직(정규화, 선택지 매칭, 날짜·전화번호 변환, 스키마 정제, 라벨 매칭, 감지 규칙)을 `node:test`로 검증합니다.
- 어댑터는 실제 채용 사이트 화면 구조에 의존하므로, 변경 시 공개 공고의 지원서 화면에서 **제출하지 않고** 동작을 확인한 결과를 PR에 기록합니다.
