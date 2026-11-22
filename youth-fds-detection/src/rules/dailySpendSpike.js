// 하루 소비 급증 판단에 필요한 설정과 공통 함수를 가져옵니다.
const {
  TIMEZONE,
  MIN_VALID_AMOUNT,
  RULE_STATUS,
  DETECTION_TYPE,
  DAILY_SPEND_SPIKE,
} = require("../config/constants");
const {
  validateBaseTransaction,
  isApprovedTransaction,
  isIgnoredTransaction,
  createRuleResult,
} = require("./ruleUtils");

// 서버 시간대와 관계없이 설정된 시간대 기준의 날짜 키를 만듭니다.
function getDateKey(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateParts = formatter.formatToParts(date);
  const year = dateParts.find((part) => part.type === "year").value;
  const month = dateParts.find((part) => part.type === "month").value;
  const day = dateParts.find((part) => part.type === "day").value;

  return `${year}-${month}-${day}`;
}

// 현재 거래를 포함한 오늘 누적 소비가 과거 하루 평균보다 급증했는지 판단합니다.
function detectDailySpendSpike(transaction, transactionHistory) {
  if (!validateBaseTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.INVALID_DATA,
      detected: false,
      type: DETECTION_TYPE.DAILY_SPEND_SPIKE,
      score: 0,
      reason: "현재 거래 기본 정보가 유효하지 않습니다.",
    });
  }

  if (isIgnoredTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.IGNORED_TRANSACTION,
      detected: false,
      type: DETECTION_TYPE.DAILY_SPEND_SPIKE,
      score: 0,
      reason: "탐지 대상이 아닌 거래 상태입니다.",
    });
  }

  if (!isApprovedTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.IGNORED_TRANSACTION,
      detected: false,
      type: DETECTION_TYPE.DAILY_SPEND_SPIKE,
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
      type: DETECTION_TYPE.DAILY_SPEND_SPIKE,
      score: 0,
      reason: "현재 거래 금액이 유효하지 않습니다.",
    });
  }

  if (!Array.isArray(transactionHistory)) {
    return createRuleResult({
      status: RULE_STATUS.INVALID_DATA,
      detected: false,
      type: DETECTION_TYPE.DAILY_SPEND_SPIKE,
      score: 0,
      reason: "과거 거래 목록이 유효하지 않습니다.",
    });
  }

  const currentDate = new Date(transaction.transaction_datetime);
  const currentTime = currentDate.getTime();
  const currentDateKey = getDateKey(currentDate);
  const countedTransactionIds = new Set();
  const approvedHistory = [];

  // 같은 사용자의 유효한 과거 승인 거래를 중복 없이 모읍니다.
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

    const historyDate = new Date(historyTransaction.transaction_datetime);
    const historyTime = historyDate.getTime();

    if (historyTime >= currentTime) {
      continue;
    }

    if (countedTransactionIds.has(historyTransaction.transaction_id)) {
      continue;
    }

    countedTransactionIds.add(historyTransaction.transaction_id);
    approvedHistory.push({
      amount: historyTransaction.amount,
      time: historyTime,
      dateKey: getDateKey(historyDate),
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
    DAILY_SPEND_SPIKE.MIN_HISTORY_DAYS * millisecondsPerDay;
  const hasEnoughHistory = historyDuration >= minimumHistoryDuration;

  // 설정된 시간대의 오늘을 기준으로 직전 달력 날짜들을 만듭니다.
  const [currentYear, currentMonth, currentDay] = currentDateKey
    .split("-")
    .map(Number);
  const currentCalendarDate = new Date(
    Date.UTC(currentYear, currentMonth - 1, currentDay),
  );
  const priorDateKeys = new Set();

  for (let dayOffset = 1; dayOffset <= DAILY_SPEND_SPIKE.LOOKBACK_DAYS; dayOffset += 1) {
    const priorDate = new Date(currentCalendarDate);
    priorDate.setUTCDate(priorDate.getUTCDate() - dayOffset);
    priorDateKeys.add(priorDate.toISOString().slice(0, 10));
  }

  // 이전 달력 날짜 범위의 승인 거래만 평균 계산 대상으로 분리합니다.
  const priorApprovedTransactions = approvedHistory.filter(
    (historyTransaction) => priorDateKeys.has(historyTransaction.dateKey),
  );
  const hasEnoughTransactions =
    priorApprovedTransactions.length >=
    DAILY_SPEND_SPIKE.MIN_APPROVED_TRANSACTIONS;

  if (!hasEnoughHistory || !hasEnoughTransactions) {
    return createRuleResult({
      status: RULE_STATUS.INSUFFICIENT_HISTORY,
      detected: false,
      type: DETECTION_TYPE.DAILY_SPEND_SPIKE,
      score: 0,
      reason: "하루 소비 급증을 판단하기 위한 개인 거래 이력이 부족합니다.",
    });
  }

  // 거래가 없는 날도 0원으로 반영되도록 전체 조회 일수로 나눕니다.
  const historicalTotalSpend = priorApprovedTransactions.reduce(
    (sum, historyTransaction) => sum + historyTransaction.amount,
    0,
  );
  const historicalDailyAverage =
    historicalTotalSpend / DAILY_SPEND_SPIKE.LOOKBACK_DAYS;

  if (!Number.isFinite(historicalDailyAverage) || historicalDailyAverage <= 0) {
    return createRuleResult({
      status: RULE_STATUS.CALCULATION_UNAVAILABLE,
      detected: false,
      type: DETECTION_TYPE.DAILY_SPEND_SPIKE,
      score: 0,
      reason: "과거 하루 평균 소비액을 계산할 수 없습니다.",
    });
  }

  // 오늘 기존 승인 소비에 현재 승인 거래를 정확히 한 번 더합니다.
  const todayPreviousSpend = approvedHistory
    .filter((historyTransaction) => historyTransaction.dateKey === currentDateKey)
    .reduce((sum, historyTransaction) => sum + historyTransaction.amount, 0);
  const todayCumulativeSpend = todayPreviousSpend + transaction.amount;
  const thresholdAmount =
    historicalDailyAverage * DAILY_SPEND_SPIKE.MULTIPLIER;

  // 오늘 누적 소비가 평소 기준을 넘었는지 확인합니다.
  if (todayCumulativeSpend >= thresholdAmount) {
    return createRuleResult({
      status: RULE_STATUS.DETECTED,
      detected: true,
      type: DETECTION_TYPE.DAILY_SPEND_SPIKE,
      score: DAILY_SPEND_SPIKE.SCORE,
      reason: "평소보다 오늘 소비가 급증했습니다.",
    });
  }

  return createRuleResult({
    status: RULE_STATUS.NOT_DETECTED,
    detected: false,
    type: DETECTION_TYPE.DAILY_SPEND_SPIKE,
    score: 0,
    reason: "하루 소비 급증 기준에 해당하지 않습니다.",
  });
}

module.exports = {
  detectDailySpendSpike,
};
