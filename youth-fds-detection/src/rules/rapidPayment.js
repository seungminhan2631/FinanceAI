// 단시간 반복 결제 판단에 필요한 설정과 공통 함수를 가져옵니다.
const {
  RULE_STATUS,
  DETECTION_TYPE,
  RAPID_PAYMENT,
} = require("../config/constants");
const {
  validateBaseTransaction,
  isApprovedTransaction,
  isIgnoredTransaction,
  createRuleResult,
} = require("./ruleUtils");

// 현재 거래를 포함해 최근 일정 시간 안의 승인 결제 횟수를 판단합니다.
function detectRapidPayment(transaction, transactionHistory) {
  if (!validateBaseTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.INVALID_DATA,
      detected: false,
      type: DETECTION_TYPE.RAPID_PAYMENT,
      score: 0,
      reason: "현재 거래 기본 정보가 유효하지 않습니다.",
    });
  }

  if (isIgnoredTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.IGNORED_TRANSACTION,
      detected: false,
      type: DETECTION_TYPE.RAPID_PAYMENT,
      score: 0,
      reason: "탐지 대상이 아닌 거래 상태입니다.",
    });
  }

  if (!isApprovedTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.IGNORED_TRANSACTION,
      detected: false,
      type: DETECTION_TYPE.RAPID_PAYMENT,
      score: 0,
      reason: "승인된 거래가 아니므로 탐지하지 않습니다.",
    });
  }

  if (!Array.isArray(transactionHistory)) {
    return createRuleResult({
      status: RULE_STATUS.INVALID_DATA,
      detected: false,
      type: DETECTION_TYPE.RAPID_PAYMENT,
      score: 0,
      reason: "과거 거래 목록이 유효하지 않습니다.",
    });
  }

  // 현재 거래 시각을 기준으로 직전 탐지 구간의 시작 시각을 계산합니다.
  const currentTime = new Date(transaction.transaction_datetime).getTime();
  const millisecondsPerMinute = 60 * 1000;
  const windowStartTime =
    currentTime - RAPID_PAYMENT.WINDOW_MINUTES * millisecondsPerMinute;

  const countedTransactionIds = new Set();

  // 같은 사용자의 유효한 과거 승인 거래만 중복 없이 계산합니다.
  for (const historyTransaction of transactionHistory) {
    if (!validateBaseTransaction(historyTransaction)) {
      continue;
    }

    if (historyTransaction.user_id !== transaction.user_id) {
      continue;
    }

    if (!isApprovedTransaction(historyTransaction)) {
      continue;
    }

    if (historyTransaction.transaction_id === transaction.transaction_id) {
      continue;
    }

    const historyTime = new Date(
      historyTransaction.transaction_datetime,
    ).getTime();
    const isInWindow =
      historyTime >= windowStartTime && historyTime <= currentTime;

    if (!isInWindow) {
      continue;
    }

    countedTransactionIds.add(historyTransaction.transaction_id);
  }

  // transactionHistory에는 현재 거래가 없으므로 현재 승인 거래 1건을 더합니다.
  const totalApprovedCount = countedTransactionIds.size + 1;

  if (totalApprovedCount >= RAPID_PAYMENT.MIN_COUNT) {
    return createRuleResult({
      status: RULE_STATUS.DETECTED,
      detected: true,
      type: DETECTION_TYPE.RAPID_PAYMENT,
      score: RAPID_PAYMENT.SCORE,
      reason: "최근 지정된 시간 안에 반복 결제가 감지되었습니다.",
    });
  }

  return createRuleResult({
    status: RULE_STATUS.NOT_DETECTED,
    detected: false,
    type: DETECTION_TYPE.RAPID_PAYMENT,
    score: 0,
    reason: "단시간 반복 결제 기준에 해당하지 않습니다.",
  });
}

module.exports = {
  detectRapidPayment,
};
