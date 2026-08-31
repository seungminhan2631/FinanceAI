// 고액 결제 판단에 필요한 설정과 공통 함수를 가져옵니다.
const {
  MIN_VALID_AMOUNT,
  RULE_STATUS,
  DETECTION_TYPE,
  HIGH_AMOUNT,
} = require("../config/constants");
const {
  validateBaseTransaction,
  isApprovedTransaction,
  isIgnoredTransaction,
  createRuleResult,
} = require("./ruleUtils");

// 현재 거래가 사용자의 과거 평균보다 비정상적으로 큰 금액인지 판단합니다.
function detectHighAmount(transaction, transactionHistory) {
  if (!validateBaseTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.INVALID_DATA,
      detected: false,
      type: DETECTION_TYPE.HIGH_AMOUNT,
      score: 0,
      reason: "현재 거래 기본 정보가 유효하지 않습니다.",
    });
  }

  if (isIgnoredTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.IGNORED_TRANSACTION,
      detected: false,
      type: DETECTION_TYPE.HIGH_AMOUNT,
      score: 0,
      reason: "탐지 대상이 아닌 거래 상태입니다.",
    });
  }

  if (!isApprovedTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.IGNORED_TRANSACTION,
      detected: false,
      type: DETECTION_TYPE.HIGH_AMOUNT,
      score: 0,
      reason: "승인된 거래가 아니므로 탐지하지 않습니다.",
    });
  }

  // 현재 거래 금액이 유효한지 확인합니다.
  const hasValidCurrentAmount =
    typeof transaction.amount === "number" &&
    Number.isFinite(transaction.amount) &&
    transaction.amount >= MIN_VALID_AMOUNT;

  if (!hasValidCurrentAmount) {
    return createRuleResult({
      status: RULE_STATUS.INVALID_DATA,
      detected: false,
      type: DETECTION_TYPE.HIGH_AMOUNT,
      score: 0,
      reason: "거래 금액이 유효하지 않습니다.",
    });
  }

  if (!Array.isArray(transactionHistory)) {
    return createRuleResult({
      status: RULE_STATUS.INVALID_DATA,
      detected: false,
      type: DETECTION_TYPE.HIGH_AMOUNT,
      score: 0,
      reason: "과거 거래 목록이 유효하지 않습니다.",
    });
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const currentTime = new Date(transaction.transaction_datetime).getTime();
  const lookbackStartTime =
    currentTime - HIGH_AMOUNT.LOOKBACK_DAYS * millisecondsPerDay;
  const countedTransactionIds = new Set();
  const approvedHistory = [];

  // 최근 범위 안의 유효한 동일 사용자 승인 거래만 필터링합니다.
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

    const hasValidHistoryAmount =
      typeof historyTransaction.amount === "number" &&
      Number.isFinite(historyTransaction.amount) &&
      historyTransaction.amount >= MIN_VALID_AMOUNT;

    if (!hasValidHistoryAmount) {
      continue;
    }

    const historyTime = new Date(
      historyTransaction.transaction_datetime,
    ).getTime();
    const isInLookbackRange =
      historyTime >= lookbackStartTime && historyTime < currentTime;

    if (!isInLookbackRange) {
      continue;
    }

    if (countedTransactionIds.has(historyTransaction.transaction_id)) {
      continue;
    }

    countedTransactionIds.add(historyTransaction.transaction_id);
    approvedHistory.push({
      amount: historyTransaction.amount,
      time: historyTime,
    });
  }

  // 개인 거래 이력의 기간과 승인 거래 수가 충분한지 확인합니다.
  let historyDuration = 0;

  if (approvedHistory.length > 0) {
    const oldestHistoryTime = Math.min(
      ...approvedHistory.map((historyTransaction) => historyTransaction.time),
    );
    historyDuration = currentTime - oldestHistoryTime;
  }

  const minimumHistoryDuration =
    HIGH_AMOUNT.MIN_HISTORY_DAYS * millisecondsPerDay;
  const hasEnoughHistory = historyDuration >= minimumHistoryDuration;
  const hasEnoughTransactions =
    approvedHistory.length >= HIGH_AMOUNT.MIN_APPROVED_TRANSACTIONS;

  if (!hasEnoughHistory || !hasEnoughTransactions) {
    return createRuleResult({
      status: RULE_STATUS.INSUFFICIENT_HISTORY,
      detected: false,
      type: DETECTION_TYPE.HIGH_AMOUNT,
      score: 0,
      reason: "고액 결제를 판단하기 위한 개인 거래 이력이 부족합니다.",
    });
  }

  // 과거 승인 거래만 사용해 평균 결제금액을 계산합니다.
  const totalAmount = approvedHistory.reduce(
    (sum, historyTransaction) => sum + historyTransaction.amount,
    0,
  );
  const averageAmount = totalAmount / approvedHistory.length;

  if (!Number.isFinite(averageAmount) || averageAmount <= 0) {
    return createRuleResult({
      status: RULE_STATUS.CALCULATION_UNAVAILABLE,
      detected: false,
      type: DETECTION_TYPE.HIGH_AMOUNT,
      score: 0,
      reason: "과거 평균 결제금액을 계산할 수 없습니다.",
    });
  }

  const thresholdAmount = averageAmount * HIGH_AMOUNT.MULTIPLIER;

  if (transaction.amount >= thresholdAmount) {
    return createRuleResult({
      status: RULE_STATUS.DETECTED,
      detected: true,
      type: DETECTION_TYPE.HIGH_AMOUNT,
      score: HIGH_AMOUNT.SCORE,
      reason: "평소 결제금액보다 큰 고액 결제가 감지되었습니다.",
    });
  }

  return createRuleResult({
    status: RULE_STATUS.NOT_DETECTED,
    detected: false,
    type: DETECTION_TYPE.HIGH_AMOUNT,
    score: 0,
    reason: "비정상 고액 결제 기준에 해당하지 않습니다.",
  });
}

module.exports = {
  detectHighAmount,
};
