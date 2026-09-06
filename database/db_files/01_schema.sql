-- ============================================================
-- 청소년 금융 이상행동 조기경보 AI - 최종 스키마 (v2)
-- PostgreSQL 13+ 기준
--   - 로그인/세션 스키마 추가
--   - user_id / transaction_id 를 문자열 키(U001 / T0001)로 통일
--   - transaction_datetime → TIMESTAMPTZ (KST 기준 입력/조회)
--   - transaction_status → APPROVED / CANCELLED / REFUNDED / FAILED
--   - merchant_category → 영문 표준 코드
-- 실행 순서: 01_schema.sql → 02_seed_data.sql
-- ============================================================

-- 세션 타임존 고정 (KST). 운영 DB에서는
--   ALTER DATABASE <db> SET timezone = 'Asia/Seoul';
-- 로 고정해두는 것을 권장.
SET timezone = 'Asia/Seoul';

BEGIN;

DROP VIEW  IF EXISTS transactions_api      CASCADE;
DROP VIEW  IF EXISTS approved_transactions CASCADE;
DROP TABLE IF EXISTS risk_alerts           CASCADE;
DROP TABLE IF EXISTS user_sessions         CASCADE;
DROP TABLE IF EXISTS transactions          CASCADE;
DROP TABLE IF EXISTS users                 CASCADE;

-- ============================================================
-- 1. 사용자 + 로그인
-- ============================================================
CREATE TABLE users (
    user_id          VARCHAR(10)  PRIMARY KEY,              -- 'U001' (앱/AI 코드에서 그대로 사용)
    login_id         VARCHAR(50)  NOT NULL UNIQUE,          -- 로그인 아이디 (이메일도 가능)
    password_hash    VARCHAR(255) NOT NULL,                 -- bcrypt/argon2 해시. 평문 저장 금지
    name             VARCHAR(50)  NOT NULL,
    age              INTEGER      CHECK (age BETWEEN 8 AND 100),
    role             VARCHAR(10)  NOT NULL DEFAULT 'TEEN'
                     CHECK (role IN ('TEEN', 'GUARDIAN', 'ADMIN')),
    guardian_name    VARCHAR(50),                           -- 보호자 이름 (선택)
    guardian_contact VARCHAR(50),                           -- 보호자 연락처 (선택)
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,    -- 탈퇴/정지 시 FALSE
    last_login_at    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_login ON users (login_id);

-- 로그인 세션 / 리프레시 토큰
CREATE TABLE user_sessions (
    id                 BIGSERIAL   PRIMARY KEY,
    user_id            VARCHAR(10) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,               -- 토큰 원본이 아니라 해시 저장
    user_agent         TEXT,
    ip_address         INET,
    issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at         TIMESTAMPTZ NOT NULL,
    revoked_at         TIMESTAMPTZ                          -- NULL 이면 유효한 세션
);

CREATE INDEX idx_sessions_user ON user_sessions (user_id, expires_at);

-- ============================================================
-- 2. 거래(결제) 테이블 -- 핵심 테이블
-- ============================================================
CREATE TABLE transactions (
    transaction_id       VARCHAR(20) PRIMARY KEY,           -- 'T0001' 거래 고유 ID
    user_id              VARCHAR(10) NOT NULL REFERENCES users(user_id),
    amount               INTEGER     NOT NULL CHECK (amount > 0),   -- 결제 금액(원)
    transaction_datetime TIMESTAMPTZ NOT NULL,              -- 결제 일시 (KST 오프셋 +09 포함 저장)
    merchant_category    VARCHAR(20) NOT NULL
        CHECK (merchant_category IN (
            'FOOD',          -- 음식점
            'CAFE',          -- 카페
            'CONVENIENCE',   -- 편의점
            'SHOPPING',      -- 의류·패션·잡화
            'TRANSPORT',     -- 교통
            'GAME_DIGITAL',  -- 게임·디지털콘텐츠
            'EDUCATION',     -- 학원·교육
            'BOOK_STATIONERY', -- 문구·서점
            'GIFT_CARD',     -- 상품권·기프트카드
            'ETC'            -- 기타
        )),
    transaction_status   VARCHAR(10) NOT NULL DEFAULT 'APPROVED'
        CHECK (transaction_status IN ('APPROVED', 'CANCELLED', 'REFUNDED', 'FAILED')),
    merchant_name        VARCHAR(100),                      -- 가맹점 이름 (예: 'CU 강남점') / 선택
    transaction_type     VARCHAR(20) NOT NULL DEFAULT 'CARD'
        CHECK (transaction_type IN ('CARD', 'TRANSFER', 'PREPAID')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 최근 10분 / 오늘 / 최근 30일 조회에 필수인 인덱스
CREATE INDEX idx_transactions_user_time
    ON transactions (user_id, transaction_datetime DESC);

-- 승인 거래만 빠르게 훑기 위한 부분 인덱스
CREATE INDEX idx_transactions_approved
    ON transactions (user_id, transaction_datetime DESC)
    WHERE transaction_status = 'APPROVED';

-- 모든 집계(평균/합계/건수) 쿼리는 이 뷰를 기준으로 조회
CREATE VIEW approved_transactions AS
SELECT *
FROM transactions
WHERE transaction_status = 'APPROVED';

-- 탐지/AI 코드가 그대로 받아쓰는 형태의 뷰
-- {user_id, transaction_id, amount, transaction_datetime, merchant_category, transaction_status}
-- transaction_datetime 은 "2026-07-15T14:30:00+09:00" 형태의 ISO8601 문자열로 내려감
CREATE VIEW transactions_api AS
SELECT
    user_id,
    transaction_id,
    amount,
    to_char(transaction_datetime AT TIME ZONE 'Asia/Seoul',
            'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00' AS transaction_datetime,
    merchant_category,
    transaction_status
FROM transactions;

-- ============================================================
-- 3. 위험 탐지 결과 테이블
-- ============================================================
CREATE TABLE risk_alerts (
    id                BIGSERIAL   PRIMARY KEY,
    transaction_id    VARCHAR(20) NOT NULL REFERENCES transactions(transaction_id),
    user_id           VARCHAR(10) NOT NULL REFERENCES users(user_id),
    detected_types    TEXT[],                               -- 예: ARRAY['NIGHT_TIME','HIGH_AMOUNT']
    rule_score        INTEGER     NOT NULL DEFAULT 0,
    ai_score          INTEGER     NOT NULL DEFAULT 0,
    final_score       INTEGER     NOT NULL DEFAULT 0,
    risk_level        VARCHAR(10) CHECK (risk_level IN ('NORMAL', 'WARNING', 'DANGER')),  -- 정상/주의/위험
    reason_message    TEXT,                                 -- 사용자에게 보여줄 근거 문구
    is_low_confidence BOOLEAN     NOT NULL DEFAULT FALSE,   -- 콜드스타트(데이터 부족) 여부
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_risk_alerts_user ON risk_alerts (user_id, created_at DESC);
CREATE UNIQUE INDEX uq_risk_alerts_tx ON risk_alerts (transaction_id);  -- 거래 1건당 결과 1건

COMMIT;

-- ============================================================
-- 확인용 쿼리 (탐지 로직에서 그대로 쓰면 되는 형태)
-- ============================================================

-- (0) 내 코드가 쓰는 JSON 형태 그대로 조회
-- SELECT * FROM transactions_api WHERE user_id = 'U001'
-- ORDER BY transaction_datetime DESC LIMIT 20;

-- (1) 최근 10분 이내 승인 거래 횟수 (단시간 반복 결제)
-- SELECT COUNT(*) FROM approved_transactions
-- WHERE user_id = 'U001' AND transaction_datetime > NOW() - INTERVAL '10 minutes';

-- (2) 최근 30일 평균 결제 금액 (비정상 고액 결제)
-- SELECT AVG(amount) FROM approved_transactions
-- WHERE user_id = 'U001' AND transaction_datetime > NOW() - INTERVAL '30 days';

-- (3) 최근 30일 승인 거래 건수 (콜드스타트: 30건 미만이면 데이터 부족)
-- SELECT COUNT(*) FROM approved_transactions
-- WHERE user_id = 'U001' AND transaction_datetime > NOW() - INTERVAL '30 days';

-- (4) 오늘(KST) 누적 소비 금액 (하루 소비 급증)
--     timestamptz 는 반드시 AT TIME ZONE 으로 KST 변환 후 날짜 비교할 것
-- SELECT COALESCE(SUM(amount), 0) FROM approved_transactions
-- WHERE user_id = 'U001'
--   AND (transaction_datetime AT TIME ZONE 'Asia/Seoul')::date
--       = (NOW() AT TIME ZONE 'Asia/Seoul')::date;

-- (5) 심야 결제 판정 (KST 00:00~05:00)
-- SELECT * FROM approved_transactions
-- WHERE user_id = 'U001'
--   AND EXTRACT(HOUR FROM transaction_datetime AT TIME ZONE 'Asia/Seoul') < 5;

-- (6) 최근 30일 이용 업종 목록 (새로운 업종 결제)
-- SELECT DISTINCT merchant_category FROM approved_transactions
-- WHERE user_id = 'U001' AND transaction_datetime > NOW() - INTERVAL '30 days';

-- (7) 일별 소비 합계 (하루 소비 급증 기준선 계산)
-- SELECT (transaction_datetime AT TIME ZONE 'Asia/Seoul')::date AS d, SUM(amount)
-- FROM approved_transactions
-- WHERE user_id = 'U001' AND transaction_datetime > NOW() - INTERVAL '30 days'
-- GROUP BY d ORDER BY d;
