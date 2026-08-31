const {
  TIMEZONE,
  MIN_VALID_AMOUNT,
  RULE_STATUS,
  AI_REQUIREMENTS,
  RAPID_PAYMENT,
  NEW_CATEGORY,
  DAILY_SPEND_SPIKE,
} = require("../config/constants");
const {
  validateBaseTransaction,
  isApprovedTransaction,
} = require("../rules/ruleUtils");

function createUnavailableResult(reason) {
  return {
    available: false,
    unavailableReason: reason,
    features: null,
  };
}

// 설정된 시간대 기준의 날짜 키를 만듭니다.
function getDateKey(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year").value;
  const month = parts.find((part) => part.type === "month").value;
  const day = parts.find((part) => part.type === "day").value;

  return `${year}-${month}-${day}`;
}

// 설정된 시간대 기준의 0~23시 값을 구합니다.
function getHour(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
  });

  return Number(formatter.format(date));
}

function calculateAverage(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function calculateStandardDeviation(values, average) {
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    values.length;

  return Math.sqrt(variance);
}

// 현재 거래와 과거 거래로 AI 모델 입력용 숫자 Feature 7개를 만듭니다.
function extractFeatures(currentTransaction, transactionHistory) {
  if (!validateBaseTransaction(currentTransaction)) {
    return createUnavailableResult(RULE_STATUS.INVALID_DATA);
  }

  if (!isApprovedTransaction(currentTransaction)) {
    return createUnavailableResult(RULE_STATUS.INVALID_DATA);
  }

  const hasValidCurrentAmount =
    typeof currentTransaction.amount === "number" &&
    Number.isFinite(currentTransaction.amount) &&
    currentTransaction.amount >= MIN_VALID_AMOUNT;
  const hasValidCurrentCategory =
    typeof currentTransaction.merchant_category === "string" &&
    currentTransaction.merchant_category.trim() !== "";

  if (!hasValidCurrentAmount || !hasValidCurrentCategory) {
    return createUnavailableResult(RULE_STATUS.INVALID_DATA);
  }

  const currentCategory = currentTransaction.merchant_category.trim();

  if (currentCategory === NEW_CATEGORY.UNKNOWN_CATEGORY) {
    return createUnavailableResult(RULE_STATUS.CALCULATION_UNAVAILABLE);
  }

  if (!Array.isArray(transactionHistory)) {
    return createUnavailableResult(RULE_STATUS.INVALID_DATA);
  }

  const currentDate = new Date(currentTransaction.transaction_datetime);
  const currentTime = currentDate.getTime();
  const countedTransactionIds = new Set();
  const approvedHistory = [];

  // 같은 사용자의 유효한 과거 승인 거래를 중복 없이 모읍니다.
  for (const historyTransaction of transactionHistory) {
    if (!validateBaseTransaction(historyTransaction)) {
      continue;
    }

    if (historyTransaction.user_id !== currentTransaction.user_id) {
      continue;
    }

    if (!isApprovedTransaction(historyTransaction)) {
      continue;
    }

    if (
      historyTransaction.transaction_id ===
      currentTransaction.transaction_id
    ) {
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
      date: historyDate,
      dateKey: getDateKey(historyDate),
      merchantCategory: historyTransaction.merchant_category,
    });
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const recentStartTime =
    currentTime - AI_REQUIREMENTS.LOOKBACK_DAYS * millisecondsPerDay;
  const recentApprovedHistory = approvedHistory.filter(
    (historyTransaction) => historyTransaction.time >= recentStartTime,
  );

  // 개인 이력 기간과 최근 승인 거래 수가 AI 최소 조건을 충족하는지 확인합니다.
  let historyDuration = 0;

  if (approvedHistory.length > 0) {
    const oldestHistoryTime = Math.min(
      ...approvedHistory.map((historyTransaction) => historyTransaction.time),
    );
    historyDuration = currentTime - oldestHistoryTime;
  }

  const hasEnoughHistory =
    historyDuration >= AI_REQUIREMENTS.MIN_HISTORY_DAYS * millisecondsPerDay;
  const hasEnoughTransactions =
    recentApprovedHistory.length >=
    AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS;

  if (!hasEnoughHistory || !hasEnoughTransactions) {
    return createUnavailableResult(RULE_STATUS.INSUFFICIENT_HISTORY);
  }

  // 최근 승인 거래의 금액 평균과 모집단 표준편차를 계산합니다.
  const recentAmounts = recentApprovedHistory.map(
    (historyTransaction) => historyTransaction.amount,
  );
  const averageAmount = calculateAverage(recentAmounts);

  if (!Number.isFinite(averageAmount) || averageAmount <= 0) {
    return createUnavailableResult(RULE_STATUS.CALCULATION_UNAVAILABLE);
  }

  const standardDeviation = calculateStandardDeviation(
    recentAmounts,
    averageAmount,
  );
  const amountRatio = currentTransaction.amount / averageAmount;
  const amountZScore =
    standardDeviation === 0
      ? 0
      : (currentTransaction.amount - averageAmount) / standardDeviation;

  // 현재 거래를 포함한 최근 반복 결제 횟수를 계산합니다.
  const recentWindowStart =
    currentTime - RAPID_PAYMENT.WINDOW_MINUTES * 60 * 1000;
  const recent10MinCount =
    approvedHistory.filter(
      (historyTransaction) => historyTransaction.time >= recentWindowStart,
    ).length + 1;

  // 최근 승인 거래 최대 5건과 현재 거래 사이의 평균 간격을 계산합니다.
  const recentTransactionTimes = recentApprovedHistory
    .map((historyTransaction) => historyTransaction.time)
    .sort((firstTime, secondTime) => secondTime - firstTime)
    .slice(0, 5);
  recentTransactionTimes.push(currentTime);
  recentTransactionTimes.sort((firstTime, secondTime) => firstTime - secondTime);

  const intervals = [];

  for (let index = 1; index < recentTransactionTimes.length; index += 1) {
    const intervalMinutes =
      (recentTransactionTimes[index] - recentTransactionTimes[index - 1]) /
      (60 * 1000);
    intervals.push(intervalMinutes);
  }

  if (intervals.length === 0) {
    return createUnavailableResult(RULE_STATUS.CALCULATION_UNAVAILABLE);
  }

  const averageTransactionInterval = calculateAverage(intervals);

  // 현재 거래와 같은 4시간 구간의 과거 거래 비율을 계산합니다.
  const currentTimeSlot = Math.floor(getHour(currentDate) / 4);
  const sameTimeSlotCount = recentApprovedHistory.filter(
    (historyTransaction) =>
      Math.floor(getHour(historyTransaction.date) / 4) === currentTimeSlot,
  ).length;
  const timeSlotFrequency =
    sameTimeSlotCount / recentApprovedHistory.length;

  // 유효한 업종 거래 중 현재 업종이 나타난 비율을 계산합니다.
  const validCategoryHistory = recentApprovedHistory
    .map((historyTransaction) =>
      typeof historyTransaction.merchantCategory === "string"
        ? historyTransaction.merchantCategory.trim()
        : "",
    )
    .filter(
      (category) =>
        category !== "" && category !== NEW_CATEGORY.UNKNOWN_CATEGORY,
    );

  if (validCategoryHistory.length === 0) {
    return createUnavailableResult(RULE_STATUS.CALCULATION_UNAVAILABLE);
  }

  const sameCategoryCount = validCategoryHistory.filter(
    (category) => category === currentCategory,
  ).length;
  const categoryFrequency =
    sameCategoryCount / validCategoryHistory.length;

  // 서울 기준 오늘과 직전 완전한 달력 날짜들을 분리합니다.
  const currentDateKey = getDateKey(currentDate);
  const [currentYear, currentMonth, currentDay] = currentDateKey
    .split("-")
    .map(Number);
  const currentCalendarDate = new Date(
    Date.UTC(currentYear, currentMonth - 1, currentDay),
  );
  const priorDateKeys = new Set();

  for (
    let dayOffset = 1;
    dayOffset <= DAILY_SPEND_SPIKE.LOOKBACK_DAYS;
    dayOffset += 1
  ) {
    const priorDate = new Date(currentCalendarDate);
    priorDate.setUTCDate(priorDate.getUTCDate() - dayOffset);
    priorDateKeys.add(priorDate.toISOString().slice(0, 10));
  }

  const historicalTotalSpend = approvedHistory
    .filter((historyTransaction) =>
      priorDateKeys.has(historyTransaction.dateKey),
    )
    .reduce((sum, historyTransaction) => sum + historyTransaction.amount, 0);
  const historicalDailyAverage =
    historicalTotalSpend / DAILY_SPEND_SPIKE.LOOKBACK_DAYS;

  if (!Number.isFinite(historicalDailyAverage) || historicalDailyAverage <= 0) {
    return createUnavailableResult(RULE_STATUS.CALCULATION_UNAVAILABLE);
  }

  const todayPreviousSpend = approvedHistory
    .filter(
      (historyTransaction) => historyTransaction.dateKey === currentDateKey,
    )
    .reduce((sum, historyTransaction) => sum + historyTransaction.amount, 0);
  const todayCumulativeSpend =
    todayPreviousSpend + currentTransaction.amount;
  const dailySpendRatio = todayCumulativeSpend / historicalDailyAverage;

  const features = {
    amountRatio,
    amountZScore,
    recent10MinCount,
    averageTransactionInterval,
    timeSlotFrequency,
    categoryFrequency,
    dailySpendRatio,
  };

  const allFeaturesAreFinite = Object.values(features).every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );

  if (!allFeaturesAreFinite) {
    return createUnavailableResult(RULE_STATUS.CALCULATION_UNAVAILABLE);
  }

  return {
    available: true,
    unavailableReason: null,
    features,
  };
}

module.exports = {
  extractFeatures,
};
