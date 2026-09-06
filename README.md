# FinanceAI

HTML / CSS / JavaScript 기반 MVP 프론트엔드입니다. 정적 서버에서 `frontend/index.html`을 열어 사용합니다.

- API 주소는 `frontend/js/common.js`의 `API_BASE_URL`에서 설정합니다. 기본값은 `http://localhost:3000`입니다.
- 거래 화면은 시연 사용자 U002의 거래를 표시하고, 헤더와 회원정보는 로그인한 회원을 표시합니다.
- 거래 분석은 `GET /api/transactions`의 `analysis.risk` 및 `analysis.rule.detectedRules`를 사용합니다.
- 홈페이지와 대시보드는 U002의 최신 거래가 존재하는 월을 대상으로 월간 위험도를 계산합니다. 현재 달과 다를 수 있습니다.
- 거래별로 정상 ×1.0, 관찰 ×1.2, 주의 ×1.5, 위험 ×2.0을 적용하고 최대 100점으로 제한합니다. 이 점수의 합계를 분석 가능한 거래 수로 나누어 정수로 반올림합니다. 가중치 합으로 나누는 방식이 아닙니다.
- 유효한 0점은 포함하고 분석 불가·유효하지 않은 점수는 제외합니다. 개별 상세 화면에는 백엔드의 원점수를 표시합니다.
- 대시보드 탐지 건수는 전체 기간, 거래내역 페이지 탐지 건수는 한국 시간 기준 현재 달입니다. 주의·위험만 집계하고 관찰은 제외합니다.
- 로그인 응답의 `user.userId`, `user.name`, `user.birthDate`, `user.phone`을 사용합니다.
- 회원정보 수정과 결제 신고는 현재 API에 없어 지원하지 않습니다. 회원정보는 조회만 가능합니다.

## 검증

추가 패키지 없이 Node.js 18 이상에서 실행합니다.

```powershell
node --test tests/frontend.test.cjs
```

실행 중인 백엔드의 거래 응답까지 검증하려면:

```powershell
$env:FINANCEAI_LIVE_TESTS = '1'
node --test tests/frontend.test.cjs
Remove-Item Env:\FINANCEAI_LIVE_TESTS
```

테스트는 간단한 DOM 모형으로 페이지의 데이터 흐름을 검증합니다. 실제 브라우저 레이아웃 검증은 포함하지 않습니다. 인증 요청은 모의 응답을 사용하므로 계정을 생성하거나 변경하지 않습니다.
