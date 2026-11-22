// 새 업종 판단에 필요한 설정과 공통 함수를 가져옵니다.
const {
  RULE_STATUS,
  DETECTION_TYPE,
  NEW_CATEGORY,
} = require("../config/constants");
const {
  validateBaseTransaction,
  isApprovedTransaction,
  isIgnoredTransaction,
  createRuleResult,
} = require("./ruleUtils");

// 현재 거래의 업종이 사용자의 최근 거래에 없었던 새로운 업종인지 판단합니다.
function detectNewCategory(transaction, transactionHistory) {
  if (!validateBaseTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.INVALID_DATA,
      detected: false,
      type: DETECTION_TYPE.NEW_CATEGORY,
      score: 0,
      reason: "현재 거래 기본 정보가 유효하지 않습니다.",
    });
  }

  if (isIgnoredTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.IGNORED_TRANSACTION,
      detected: false,
      type: DETECTION_TYPE.NEW_CATEGORY,
      score: 0,
      reason: "탐지 대상이 아닌 거래 상태입니다.",
    });
  }

  if (!isApprovedTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.IGNORED_TRANSACTION,
      detected: false,
      type: DETECTION_TYPE.NEW_CATEGORY,
      score: 0,
      reason: "승인된 거래가 아니므로 탐지하지 않습니다.",
    });
  }

  // 현재 업종 정보가 유효한지 확인합니다.
  const hasValidCurrentCategory =
    typeof transaction.merchant_category === "string" &&
    transaction.merchant_category.trim() !== "";

  if (!hasValidCurrentCategory) {
    return createRuleResult({
      status: RULE_STATUS.INVALID_DATA,
      detected: false,
      type: DETECTION_TYPE.NEW_CATEGORY,
      score: 0,
      reason: "현재 거래의 업종 정보가 유효하지 않습니다.",
    });
  }
  const currentCategory = transaction.merchant_category.trim();

  if (currentCategory === NEW_CATEGORY.UNKNOWN_CATEGORY) {
    return createRuleResult({
      status: RULE_STATUS.CALCULATION_UNAVAILABLE,
      detected: false,
      type: DETECTION_TYPE.NEW_CATEGORY,
      score: 0,
      reason: "업종 정보를 확인할 수 없어 분석할 수 없습니다.",
    });
  }

  if (!Array.isArray(transactionHistory)) {
    return createRuleResult({
      status: RULE_STATUS.INVALID_DATA,
      detected: false,
      type: DETECTION_TYPE.NEW_CATEGORY,
      score: 0,
      reason: "과거 거래 목록이 유효하지 않습니다.",
    });
  }

  const currentTime = new Date(transaction.transaction_datetime).getTime();
  const countedTransactionIds = new Set();
  const approvedHistory = [];

  // 기간 제한 전에 전체 유효 승인 거래를 모아 개인 이력을 확인합니다.
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

    if (historyTime >= currentTime) {
      continue;
    }

    if (countedTransactionIds.has(historyTransaction.transaction_id)) {
      continue;
    }

    countedTransactionIds.add(historyTransaction.transaction_id);
    approvedHistory.push({
      time: historyTime,
      merchantCategory: historyTransaction.merchant_category,
    });
  }

  // 전체 과거 승인 거래로 개인 거래 이력 기간을 계산합니다.
  let historyDuration = 0;

  if (approvedHistory.length > 0) {
    const oldestHistoryTime = Math.min(
      ...approvedHistory.map((historyTransaction) => historyTransaction.time),
    );
    historyDuration = currentTime - oldestHistoryTime;
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const minimumHistoryDuration =
    NEW_CATEGORY.MIN_HISTORY_DAYS * millisecondsPerDay;
  const hasEnoughHistory = historyDuration >= minimumHistoryDuration;

  // 현재 거래를 기준으로 최근 조회 기간 안의 승인 거래만 모읍니다.
  const lookbackStartTime =
    currentTime - NEW_CATEGORY.LOOKBACK_DAYS * millisecondsPerDay;
  const recentApprovedHistory = approvedHistory.filter(
    (historyTransaction) =>
      historyTransaction.time >= lookbackStartTime &&
      historyTransaction.time < currentTime,
  );
  const hasEnoughTransactions =
    recentApprovedHistory.length >= NEW_CATEGORY.MIN_APPROVED_TRANSACTIONS;

  if (!hasEnoughHistory || !hasEnoughTransactions) {
    return createRuleResult({
      status: RULE_STATUS.INSUFFICIENT_HISTORY,
      detected: false,
      type: DETECTION_TYPE.NEW_CATEGORY,
      score: 0,
      reason: "새로운 업종 여부를 판단하기 위한 개인 거래 이력이 부족합니다.",
    });
  }

  // 최근 승인 거래 중 유효하고 확인 가능한 업종만 목록에 추가합니다.
  const recentCategories = new Set();

  for (const historyTransaction of recentApprovedHistory) {
    const historyCategory =
      typeof historyTransaction.merchantCategory === "string"
        ? historyTransaction.merchantCategory.trim()
        : "";

    const hasValidHistoryCategory =
      historyCategory !== "" &&
      historyCategory !== NEW_CATEGORY.UNKNOWN_CATEGORY;

    if (hasValidHistoryCategory) {
      recentCategories.add(historyCategory);
    }
  }

  // 현재 업종이 최근 업종 목록에 존재하는지 확인합니다.
  if (!recentCategories.has(currentCategory)) {
    return createRuleResult({
      status: RULE_STATUS.DETECTED,
      detected: true,
      type: DETECTION_TYPE.NEW_CATEGORY,
      score: NEW_CATEGORY.SCORE,
      reason:
        "최근 일정 기간 사용하지 않았던 새로운 업종의 결제가 감지되었습니다.",
    });
  }

  return createRuleResult({
    status: RULE_STATUS.NOT_DETECTED,
    detected: false,
    type: DETECTION_TYPE.NEW_CATEGORY,
    score: 0,
    reason: "최근 사용한 적이 있는 업종입니다.",
  });
}

module.exports = {
  detectNewCategory,
};
