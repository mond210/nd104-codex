# ND104 Codex Panel

ND104 키보드의 **320×172 LCD**에 **OpenAI Codex 사용량(남은 비율과 초기화까지 남은 시간)**을 표시하는 작은 Node.js 프로그램입니다.

기반 프로젝트: [libingtong/nd104-panel](https://github.com/libingtong/nd104-panel). 원본의 **USB HID / JPEG 다중 프레임 전송 코드**를 재사용하고, Claude Code 사용량 조회를 **Codex app-server**의 `account/rateLimits/read`로 대체했습니다.

## 표시 내용

- Codex 기본(`codex`) 사용량 버킷의 **primary / secondary** 제한 창(보통 **5시간 / 주간**) 남은 비율
- 각 창의 초기화까지 남은 시간. 실제 제한 창 길이가 바뀌면 `15M`, `5H`, `1W`처럼 서버가 알려준 기간을 표시
- 색상 막대(50% 이상 초록, 20~49% 노랑, 20% 미만 빨강)
- (선택) 원본의 날씨 / 2시간 강수 경고 프레임. `CAIYUN_TOKEN`을 설정하지 않으면 사용하지 않음

Codex CLI의 **기존 ChatGPT 로그인**을 이용하므로 이 프로젝트는 `auth.json`을 읽거나 토큰을 복사하지 않습니다. 별도 모델 추론 요청도 하지 않습니다. 다만 `app-server`의 응답 및 동작은 설치한 Codex 버전과 계정에 따라 달라질 수 있습니다.

## 요구 사항

- [ND104 키보드](https://chilkey.com/products/nd104-keyboard)를 USB로 연결(원본이 확인한 HID VID/PID: `0x5542/0x0001`)
- **Node.js 18 이상**, npm
- **Codex CLI** (`npm install -g @openai/codex`) 및 ChatGPT 계정 로그인 (`codex login`)
- 원본 HID 통신은 macOS에서 테스트됨. Windows/Linux에서도 Node.js와 `node-hid`의 장치 접근이 가능하면 시도할 수 있지만, 이 포트에서는 실기기 검증하지 않았음
- 공식 ND104 설정 웹사이트/앱이 HID 장치를 점유하고 있다면 종료

## 빠른 시작

```bash
git clone https://github.com/mond210/nd104-codex.git
cd nd104-codex
npm install

# Codex CLI 최초 한 번 설치/로그인 (기존 설정이 있으면 생략)
npm install -g @openai/codex
codex login

# API와 계정이 사용량을 반환하는지 확인(하드웨어 불필요)
npm run check

# 로그인이나 하드웨어 없이 예시 화면을 panel-1.jpg로 생성
npm run demo

# 실제 Codex 사용량으로 panel-1.jpg 생성(장치에 쓰지 않음)
npm run dry

# 실제 ND104 키보드에 한 번 전송
npm run once

# 주기 갱신(기본 30분, 평일 09~12시 및 14~19시)
npm start
```

`npm run dry` 실행 시 화면이 `panel-1.jpg`로 저장됩니다. 먼저 JPEG를 열어 레이아웃을 확인한 뒤 `npm run once`로 HID 전송하는 것을 권장합니다.

## 옵션

| 명령/옵션 | 동작 |
|---|---|
| `npm run check` | Codex 계정 사용량을 텍스트로 확인 |
| `npm run demo` | 샘플 비율로 JPEG 미리보기(인증/하드웨어 불필요) |
| `npm run dry` | 실제 Codex 사용량 JPEG 미리보기(HID 미사용) |
| `npm run once` | 활성 시간과 무관하게 한 번 전송 |
| `npm start` | 기본 30분 간격, 평일 정해진 시간에만 전송 |
| `node push-daemon.js --force` | 활성 요일/시간 제약 없이 주기 전송 |
| `node push-daemon.js --interval 60` | 전송 주기 60분 |
| `node push-daemon.js --skip-unchanged` | 사용량/날씨 데이터가 같으면 HID 재전송 생략(화면 시계도 유지) |
| `node push-daemon.js --dwell 8` | 각 화면 약 8초 표시(반복 JPEG 프레임 이용) |
| `node push-daemon.js --no-weather` | `CAIYUN_TOKEN`이 설정돼 있어도 날씨 제외 |
| `node nd104-push.js my.jpg` | 커스텀 이미지 전송(원본 유틸리티) |
| `node push-gif.js animation.gif` | GIF 프레임 전송(원본 유틸리티) |
| `npm test` | Codex 데이터 파싱 및 통신 시뮬레이션 테스트 |

환경변수:

| 이름 | 기본값 | 의미 |
|---|---|---|
| `CODEX_BIN` | `codex` | Codex CLI 실행 파일의 경로. 앱 시작 경로에 Codex가 없다면 절대 경로 입력 |
| `CODEX_LIMIT_ID` | `codex` | `rateLimitsByLimitId` 버킷 ID(다른 모델용 버킷을 보려면 변경) |
| `ND_INTERVAL_MIN` | `30` | 업데이트 간격(분) |
| `ND_DWELL_SEC` | `6` | 화면별 표시 시간(초) |
| `ND_ACTIVE_DAYS` | `1,2,3,4,5` | 활성 요일(일요일 0, 토요일 6) |
| `ND_ACTIVE_RANGES` | `9-12,14-19` | 로컬 시간 기준 활성 시간대 |
| `CAIYUN_TOKEN` | 미설정 | 설정한 경우에만 원본의 날씨 화면 추가 |
| `WEATHER_CITY` | `北京` | 날씨 도시에 표시할 이름 |
| `WEATHER_COORD` | `116.4074,39.9042` | 날씨 경도,위도(설정하지 않으면 베이징 기본값) |
| `RAIN_PROB` | `30` | 강수 확률 알림 기준(%) |

예: 날씨 추가(macOS / Linux)

```bash
CAIYUN_TOKEN='YOUR_TOKEN' WEATHER_CITY='Seoul' WEATHER_COORD='126.9780,37.5665' npm run once
```

**주의:** ND104 이미지 업로드는 장치 플래시 메모리에 기록될 *가능성*이 있어 과도한 빈도(예: 초 단위) 갱신을 권장하지 않습니다. 주기 기본값은 30분입니다. 사용량 데이터가 바뀌지 않을 때는 `--skip-unchanged`를 사용하세요.

## macOS 자동 시작(선택)

`nd104-codex.plist` 템플릿의 `__NODE__`(예: `which node` 출력)와 `__PROJECT_DIR__`를 본인 경로로 바꾼 뒤:

```bash
cp nd104-codex.plist ~/Library/LaunchAgents/com.mond210.nd104-codex.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mond210.nd104-codex.plist
```

출력/오류 로그: `<프로젝트>/nd104.log`. LaunchAgent의 PATH에서 `codex`를 찾지 못하면 `CODEX_BIN`을 절대 경로로 지정하세요.

## 기술 구성

```text
lib/quota.js       Codex app-server JSONL RPC 클라이언트 → 사용량 정규화
lib/render.js      잔여율 SVG → baseline JFIF JPEG (원본 날씨 렌더링 유지)
lib/nd104.js       ND104 USB HID 패킷/다중 프레임 전송 (원본)
lib/weather.js     선택형 날씨 API (원본)
lib/icons.js       날씨 SVG 아이콘 (원본)
push-daemon.js     주기 갱신/미리보기/전송
check-quota.js     디버그용 계정 사용량 조회
nd104-push.js      JPEG 단일 전송 (원본)
push-gif.js        GIF 애니메이션 전송 (원본)
protocol-spec.md   원 저자의 HID 프로토콜 분석 기록
```

## 오류 점검

- `Codex CLI not found` → `codex --version`을 확인. 자동 시작 시 `CODEX_BIN`에 CLI의 절대 경로 지정
- `rate-limit ... unavailable` → `codex login`으로 **ChatGPT 계정 로그인**을 확인. API 키만 설정한 환경에서는 ChatGPT 구독 한도 정보가 나오지 않을 수 있음
- `device ... not found` → ND104 USB 연결 및 다른 앱의 HID 장치 점유 여부 확인
- `npm install`의 `node-hid` 오류 → OS별 네이티브 빌드 도구 또는 USB 관련 라이브러리 필요할 수 있음
- 실패 시 예전에 성공한 데이터를 계속 보여줄 수 있으므로 터미널 로그의 오류와 화면 갱신 시점을 확인

## 출처 및 라이선스

[libingtong/nd104-panel](https://github.com/libingtong/nd104-panel)의 MIT 라이선스 코드와 HID 프로토콜 문서를 기반으로 작성했습니다. 원 저작권 표시를 [`LICENSE`](./LICENSE)에 보존했습니다. 이 프로젝트 역시 MIT 라이선스이며 ND104 제조사, Anthropic, OpenAI와 무관한 개인용 프로젝트입니다.