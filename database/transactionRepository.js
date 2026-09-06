// transactionRepository.js
// ─────────────────────────────────────────────────────────────
// DB에서 거래를 꺼내오는 함수 모음.
// 탐지 로직은 SQL을 직접 쓰지 말고 이 파일의 함수만 호출하세요.
//
// 규칙 2가지
//  1) 평균·건수·합계 같은 집계는 반드시 approved_transactions 뷰 사용
//     (취소/환불/실패 건이 섞이면 기준선이 틀어집니다)
//  2) 날짜·시각 비교는 반드시 AT TIME ZONE 'Asia/Seoul' 로 변환 후 비교
// ─────────────────────────────────────────────────────────────

const { query } = require("./db");

/** 거래 목록 조회 — 탐지 코드가 쓰는 JSON 형태 그대로 반환 */
async function getRecentTransactions(userId, limit = 50) {
  return query(
    `SELECT user_id, transaction_id, amount, transaction_datetime,
            merchant_category, transaction_status
     FROM transactions_api
     WHERE user_id = $1
     ORDER BY transaction_datetime DESC
     LIMIT $2`,
    [userId, limit]
  );
}

/** 거래 1건 조회 */
async function getTransaction(transactionId) {
  const rows = await query(
    `SELECT user_id, transaction_id, amount, transaction_datetime,
            merchant_category, transaction_status
     FROM transactions_api WHERE transaction_id = $1`,
    [transactionId]
  );
  return rows[0] || null;
}

/** [룰1] 최근 N분 이내 승인 거래 건수 — 단시간 반복 결제 */
async function countRecentMinutes(userId, minutes = 10) {
  const rows = await query(
    `SELECT COUNT(*)::int AS cnt FROM approved_transactions
     WHERE user_id = $1
       AND transaction_datetime > NOW() - ($2 || ' minutes')::interval`,
    [userId, String(minutes)]
  );
  return rows[0].cnt;
}

/** 특정 거래 시각 기준 앞뒤 N분 이내 건수 — 과거 데이터로 테스트할 때 사용 */
async function countAroundTransaction(transactionId, minutes = 10) {
  const rows = await query(
    `SELECT COUNT(*)::int AS cnt
     FROM approved_transactions a
     JOIN transactions t ON t.transaction_id = $1
     WHERE a.user_id = t.user_id
       AND a.transaction_datetime BETWEEN
           t.transaction_datetime - ($2 || ' minutes')::interval
           AND t.transaction_datetime`,
    [transactionId, String(minutes)]
  );
  return rows[0].cnt;
}

/** [룰2] 최근 30일 통계 — 고액 결제 판정 기준선 */
async function getStats30d(userId) {
  const rows = await query(
    `SELECT COUNT(*)::int                         AS count,
            COALESCE(ROUND(AVG(amount)), 0)::int  AS avg_amount,
            COALESCE(MAX(amount), 0)::int         AS max_amount
     FROM approved_transactions
     WHERE user_id = $1
       AND transaction_datetime > NOW() - INTERVAL '30 days'`,
    [userId]
  );
  return rows[0];
}

/** [콜드스타트] 최근 30일 승인 거래가 30건 미만이면 데이터 부족 */
async function isColdStart(userId, threshold = 30) {
  const { count } = await getStats30d(userId);
  return { isLowConfidence: count < threshold, count };
}

/** [룰3] 오늘(한국시간) 누적 소비 금액 — 하루 소비 급증 */
async function getTodayTotal(userId) {
  const rows = await query(
    `SELECT COALESCE(SUM(amount), 0)::int AS total
     FROM approved_transactions
     WHERE user_id = $1
       AND (transaction_datetime AT TIME ZONE 'Asia/Seoul')::date
         = (NOW() AT TIME ZONE 'Asia/Seoul')::date`,
    [userId]
  );
  return rows[0].total;
}

/** 최근 30일 일별 소비 합계 — 하루 소비 급증의 평균 기준선 계산용 */
async function getDailyTotals30d(userId) {
  return query(
    `SELECT (transaction_datetime AT TIME ZONE 'Asia/Seoul')::date AS day,
            SUM(amount)::int AS total
     FROM approved_transactions
     WHERE user_id = $1
       AND transaction_datetime > NOW() - INTERVAL '30 days'
     GROUP BY day ORDER BY day`,
    [userId]
  );
}

/** [룰4] 최근 30일 이용 업종 목록 — 새로운 업종 판정 */
async function getCategories30d(userId) {
  const rows = await query(
    `SELECT DISTINCT merchant_category FROM approved_transactions
     WHERE user_id = $1
       AND transaction_datetime > NOW() - INTERVAL '30 days'`,
    [userId]
  );
  return rows.map((r) => r.merchant_category);
}

/** [룰5] 심야 결제 여부 — 한국시간 00:00~05:00 */
function isNightTime(isoString) {
  const hour = Number(String(isoString).slice(11, 13));
  return hour >= 0 && hour < 5;
}

/** 신규 거래 저장 (실시간 탐지 테스트용) */
async function insertTransaction(tx) {
  const rows = await query(
    `INSERT INTO transactions
       (transaction_id, user_id, amount, transaction_datetime,
        merchant_category, transaction_status, merchant_name)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5,
             COALESCE($6, 'APPROVED'), $7)
     RETURNING transaction_id`,
    [
      tx.transaction_id,
      tx.user_id,
      tx.amount,
      tx.transaction_datetime || null,
      tx.merchant_category,
      tx.transaction_status || null,
      tx.merchant_name || null,
    ]
  );
  return rows[0].transaction_id;
}

/** 탐지 결과 저장 (같은 거래를 다시 분석하면 덮어씀) */
async function saveRiskAlert(alert) {
  const rows = await query(
    `INSERT INTO risk_alerts
       (transaction_id, user_id, detected_types, rule_score, ai_score,
        final_score, risk_level, reason_message, is_low_confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (transaction_id) DO UPDATE SET
       detected_types    = EXCLUDED.detected_types,
       rule_score        = EXCLUDED.rule_score,
       ai_score          = EXCLUDED.ai_score,
       final_score       = EXCLUDED.final_score,
       risk_level        = EXCLUDED.risk_level,
       reason_message    = EXCLUDED.reason_message,
       is_low_confidence = EXCLUDED.is_low_confidence,
       created_at        = NOW()
     RETURNING id`,
    [
      alert.transaction_id,
      alert.user_id,
      alert.detected_types || [],
      alert.rule_score || 0,
      alert.ai_score || 0,
      alert.final_score || 0,
      alert.risk_level || "NORMAL",
      alert.reason_message || null,
      alert.is_low_confidence || false,
    ]
  );
  return rows[0].id;
}

module.exports = {
  getRecentTransactions,
  getTransaction,
  countRecentMinutes,
  countAroundTransaction,
  getStats30d,
  isColdStart,
  getTodayTotal,
  getDailyTotals30d,
  getCategories30d,
  isNightTime,
  insertTransaction,
  saveRiskAlert,
};
