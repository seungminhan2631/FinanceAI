
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
# DB 모듈 안내 (database/)
 
청소년 금융 이상행동 조기경보 AI의 데이터베이스 모듈입니다.
Supabase(PostgreSQL)에 연결해서 거래 데이터를 조회하고, 탐지 결과를 저장합니다.
 
담당: 한승민 / 문의는 팀 채널로
 
---
 
## 1. 빠른 시작 (5분)
 
```bash
git clone <저장소 주소>
cd FinanceAI/database
npm install pg dotenv
```
 
`database/` 폴더에 `.env` 파일을 만들고, 팀 채널에서 받은 접속 정보를 붙여넣습니다.
 
```
DATABASE_URL=postgresql://postgres.xxxxx:비밀번호@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres
DB_DEBUG=false
```
 
> `.env`는 깃에 올라가지 않습니다. 담당자에게 개별로 받으세요.
> 이 주소는 **관리자 권한**이라 유출되면 데이터 전체가 삭제될 수 있습니다. 절대 커밋하지 마세요.
 
연결 확인:
 
```bash
node check-db.js
```
 
마지막에 `✅ 모두 정상입니다.` 가 나오면 준비 끝입니다.
 
---
 
## 2. 파일 구조
 
```
database/
├── db.js                     DB 연결 (직접 수정할 일 없음)
├── transactionRepository.js  거래 조회 함수 모음  ← 이것만 쓰면 됩니다
├── check-db.js               연결/데이터 점검 스크립트
├── .env                      접속 정보 (깃에 없음, 개별 전달)
└── db_files/
    ├── 01_schema.sql         테이블 설계도
    └── 02_seed_data.sql      더미 데이터 312건
```
 
| 파일 | 역할 | 실행 시점 |
|---|---|---|
| `db.js` | Supabase 커넥션 풀 관리. `query()` 하나만 export | 앱 시작 시 자동 |
| `transactionRepository.js` | SQL을 감싼 함수 12개 | 탐지 로직에서 호출 |
| `check-db.js` | 연결·데이터·타임존 점검 | 처음 세팅할 때 1회 |
| `db_files/*.sql` | Supabase 웹에서 복붙하는 용도 | DB 초기화할 때만 |
 
**SQL 파일 두 개는 코드가 아닙니다.** Node가 읽지 않습니다. DB를 새로 만들거나 초기화할 때 Supabase SQL Editor에 붙여넣는 용도입니다.
 
---
 
## 3. DB 구조
 
### 테이블
 
**`transactions`** — 거래 원본 (312건)
 
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `transaction_id` | VARCHAR PK | `'T0001'` |
| `user_id` | VARCHAR FK | `'U001'` |
| `amount` | INTEGER | 결제 금액(원) |
| `transaction_datetime` | TIMESTAMPTZ | 결제 일시 (KST +09:00) |
| `merchant_category` | VARCHAR | 업종 (아래 10종) |
| `transaction_status` | VARCHAR | `APPROVED` / `CANCELLED` / `REFUNDED` / `FAILED` |
| `merchant_name` | VARCHAR | 가맹점명 (UI 표시용, 선택) |
| `transaction_type` | VARCHAR | `CARD` / `TRANSFER` / `PREPAID` |
 
업종 표준값 10종 — 이 값만 사용합니다:
`FOOD` `CAFE` `CONVENIENCE` `SHOPPING` `TRANSPORT` `GAME_DIGITAL` `EDUCATION` `BOOK_STATIONERY` `GIFT_CARD` `ETC`
 
**`users`** — 사용자 + 로그인 (4명)
 
`user_id`, `login_id`, `password_hash`, `name`, `age`, `role`, `guardian_name`, `guardian_contact`, `is_active`, `last_login_at`
 
> `password_hash`는 형식만 맞춘 더미 문자열입니다. 로그인 기능을 붙일 때 bcrypt로 새로 만들어 UPDATE 하세요.
 
**`risk_alerts`** — 탐지 결과 (현재 0건, 탐지 코드가 채움)
 
`transaction_id`, `user_id`, `detected_types[]`, `rule_score`, `ai_score`, `final_score`, `risk_level`(`NORMAL`/`WARNING`/`DANGER`), `reason_message`, `is_low_confidence`
 
거래 1건당 결과 1건만 저장됩니다(UNIQUE). 재분석하면 덮어쓰기 됩니다.
 
**`user_sessions`** — 로그인 세션 (현재 0건, 로그인 기능이 채움)
 
### 뷰 2개
 
| 뷰 | 용도 |
|---|---|
| `approved_transactions` | 승인 거래만. **모든 집계(평균/합계/건수)는 이걸 기준으로** |
| `transactions_api` | 탐지 코드가 쓰는 JSON 형태 그대로 반환 |
 
---
 
## 4. 데이터 형태
 
`transactions_api`를 통해 조회하면 이 형태로 나옵니다.
 
```json
{
  "user_id": "U001",
  "transaction_id": "T0312",
  "amount": 25700,
  "transaction_datetime": "2026-08-27T20:42:32+09:00",
  "merchant_category": "CAFE",
  "transaction_status": "APPROVED"
}
```
 
`transaction_datetime`은 ISO8601 문자열(KST +09:00 고정)입니다. Date 객체가 아니라 문자열이니 필요하면 직접 파싱하세요.
 
---
 
## 5. 더미 데이터 구성
 
사용자 4명, 40~60일치, 총 312건. 전원 최근 30일 승인 거래 43건 이상이라 콜드스타트에 걸리지 않습니다.
 
| 사용자 | 이름 | 소비 패턴 | 승인 | 30일 평균 |
|---|---|---|---|---|
| U001 | 정민지(17) | FOOD·CAFE, 점심~저녁 | 76건 | 약 23,000원 |
| U002 | 박지훈(18) | SHOPPING·FOOD, 오후 | 71건 | 약 49,000원 |
| U003 | 김하늘(16) | TRANSPORT·CONVENIENCE, 등하교 | 91건 | 약 13,600원 |
| U004 | 이서준(17) | GAME_DIGITAL·CONVENIENCE, 밤 | 62건 | 약 18,700원 |
 
각 사용자당 `CANCELLED` / `REFUNDED` / `FAILED` 가 1건씩 들어 있습니다.
 
**날짜는 상대값으로 생성됩니다.** 시드를 다시 실행하면 그날 기준으로 다시 계산되므로, "최근 30일" 조건이 언제나 성립합니다. 대신 특정 날짜를 하드코딩하면 안 됩니다.
 
---
 
## 6. 탐지 테스트용 거래
 
5개 룰에 맞춰 이상 거래를 일부러 심어뒀습니다.
 
| 검증할 룰 | 거래 ID | 상황 | 기대 결과 |
|---|---|---|---|
| 10분 내 반복 결제 | `T0261` | U002, 10분 내 5건 연속 | 반복 탐지 |
| 심야 + 반복 | `T0302` | U004, 새벽 2시대 4건 연속 | 두 룰 동시 탐지 |
| 고액 결제 | `T0281` | U001, 98,000원 (평균의 4배) | 고액 탐지 |
| 새로운 업종 | `T0292` | U001, GIFT_CARD 새벽 1시 | 새 업종 + 심야 |
| 하루 소비 급증 | `T0272` | U003, 당일 12만원 (평소 2만원대) | 급증 탐지 |
| **정상 (오탐 확인)** | `T0312` | U001, CAFE 25,700원 | **아무것도 안 걸려야 정상** |
 
마지막 정상 거래로 오탐 여부를 꼭 같이 확인하세요.
 
---
 
## 7. 함수 사용법
 
```js
const repo = require("./transactionRepository");
```
 
### 조회
 
```js
await repo.getRecentTransactions("U001", 50);  // 최근 거래 배열
await repo.getTransaction("T0292");            // 거래 1건 (없으면 null)
```
 
### 룰별 기준값
 
```js
// 10분 내 반복 — 지금 시각 기준
await repo.countRecentMinutes("U001", 10);        // → 숫자
 
// 10분 내 반복 — 과거 거래 시각 기준 (더미 데이터 테스트용)
await repo.countAroundTransaction("T0261", 10);   // → 5
 
// 고액 결제
await repo.getStats30d("U001");
// → { count: 43, avg_amount: 23558, max_amount: 98000 }
 
// 하루 소비 급증
await repo.getTodayTotal("U001");                 // → 오늘 누적 금액
await repo.getDailyTotals30d("U001");             // → [{ day, total }, ...]
 
// 새로운 업종
await repo.getCategories30d("U001");
// → ['CONVENIENCE', 'GIFT_CARD', 'BOOK_STATIONERY', 'CAFE', 'FOOD']
 
// 심야 결제 (DB 조회 없음, 동기 함수)
repo.isNightTime("2026-08-25T01:21:47+09:00");    // → true
 
// 콜드스타트
await repo.isColdStart("U001");
// → { isLowConfidence: false, count: 43 }
```
 
### 저장
 
```js
// 신규 거래 (실시간 탐지 테스트용)
await repo.insertTransaction({
  transaction_id: "T0313",        // 필수, 중복 불가. 더미가 T0312까지 사용 중
  user_id: "U001",
  amount: 120000,
  merchant_category: "GIFT_CARD",
  transaction_datetime: null,     // null이면 현재 시각
  transaction_status: "APPROVED", // 생략 가능
  merchant_name: "컬쳐랜드",       // 생략 가능
});
 
// 탐지 결과
await repo.saveRiskAlert({
  transaction_id: "T0292",
  user_id: "U001",
  detected_types: ["NIGHT_TIME", "NEW_CATEGORY"],
  rule_score: 60,
  ai_score: 0,
  final_score: 60,
  risk_level: "WARNING",          // NORMAL / WARNING / DANGER
  reason_message: "평소 이용하지 않던 업종에서 새벽에 결제되었습니다.",
  is_low_confidence: false,
});
```
 
### 전체 예시
 
```js
const repo = require("./transactionRepository");
 
async function detect(transactionId) {
  const tx = await repo.getTransaction(transactionId);
  if (!tx) return null;
 
  const stats = await repo.getStats30d(tx.user_id);
  const cats = await repo.getCategories30d(tx.user_id);
  const { isLowConfidence } = await repo.isColdStart(tx.user_id);
 
  const types = [];
  if (repo.isNightTime(tx.transaction_datetime)) types.push("NIGHT_TIME");
  if (tx.amount > stats.avg_amount * 3) types.push("HIGH_AMOUNT");
  if (!cats.includes(tx.merchant_category)) types.push("NEW_CATEGORY");
  if (await repo.countAroundTransaction(tx.transaction_id, 10) >= 4)
    types.push("RAPID_REPEAT");
 
  // ... 점수 계산 후
  await repo.saveRiskAlert({ ...tx, detected_types: types, is_low_confidence: isLowConfidence });
}
```
 
---
 
## 8. 규칙 3가지
 
**집계는 반드시 `approved_transactions` 뷰 사용.**
`transactions`를 그대로 쓰면 취소·환불·실패 거래가 평균에 섞여 기준선이 틀어집니다. `repo` 함수들은 이미 지키고 있으니, 직접 SQL을 쓸 때만 주의하면 됩니다.
 
**날짜·시각 비교는 반드시 `AT TIME ZONE 'Asia/Seoul'`.**
컬럼이 `TIMESTAMPTZ`라 변환 없이 비교하면 UTC 기준이 되어 9시간 어긋납니다. "오늘 소비", "심야 판정"이 전부 틀어집니다.
 
```sql
-- 잘못됨
WHERE transaction_datetime::date = CURRENT_DATE
 
-- 올바름
WHERE (transaction_datetime AT TIME ZONE 'Asia/Seoul')::date
    = (NOW() AT TIME ZONE 'Asia/Seoul')::date
```
 
**`DATABASE_URL`은 절대 커밋 금지.**
`.gitignore`에 `.env`가 들어 있지만, 다른 파일에 하드코딩하면 걸러지지 않습니다.
 
---
 
## 9. 문제 해결
 
| 증상 | 원인 / 해결 |
|---|---|
| `DATABASE_URL이 없습니다` | `.env`가 없거나 `database/` 폴더 밖에 있음 |
| `password authentication failed` | 비밀번호 오타. `[YOUR-PASSWORD]` 대괄호를 안 지웠거나 특수문자 문제 |
| `Cannot find module 'pg'` | `database/` 폴더에서 `npm install pg dotenv` |
| `Cannot find module './db'` | 파일이 `db.js`와 다른 폴더에 있음. 같은 폴더에 두세요 |
| 조회 결과가 0건 | 프론트에서 anon key로 접근한 경우. RLS가 막습니다 (아래 참고) |
| 시각이 9시간 어긋남 | `AT TIME ZONE 'Asia/Seoul'` 누락 |
| `ETIMEDOUT` | 네트워크가 5432 포트를 막는 환경. 다른 네트워크에서 시도 |
 
### 프론트에서 직접 읽어야 한다면
 
RLS가 켜져 있어서 anon key로는 데이터가 **에러 없이 0건**으로 나옵니다. 필요하면 담당자에게 요청하세요. Supabase SQL Editor에서 정책을 추가합니다.
 
```sql
CREATE POLICY "anon_read" ON transactions
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON transactions_api, approved_transactions TO anon, authenticated;
```
 
`users`와 `user_sessions`는 비밀번호 해시와 토큰이 들어 있으므로 열지 않습니다.
 
---
 
## 10. DB 초기화 방법
 
데이터가 꼬였을 때 처음 상태로 되돌립니다. **Supabase 데이터 전체가 지워지고 다시 채워지므로, 탐지 결과(`risk_alerts`)도 함께 사라집니다.** 팀에 공유 후 진행하세요.
 
1. Supabase 대시보드 → SQL Editor → New query
2. `db_files/01_schema.sql` 전체 복사 → 붙여넣기 → Run
   - 경고가 뜨면 `Run and enable RLS` 선택
3. 같은 자리를 비우고 `db_files/02_seed_data.sql` 전체 복사 → 붙여넣기 → Run
4. `node check-db.js` 로 확인
몇 번을 반복해도 항상 같은 상태(312건)로 돌아옵니다.
 
