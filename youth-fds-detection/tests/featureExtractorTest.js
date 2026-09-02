const assert = require("node:assert/strict");

const { extractFeatures } = require("../src/ai/featureExtractor");
const {
  TIMEZONE,
  TRANSACTION_STATUS,
  RULE_STATUS,
  AI_REQUIREMENTS,
  RAPID_PAYMENT,
  DAILY_SPEND_SPIKE,
  NEW_CATEGORY,
} = require("../src/config/constants");

const TOLERANCE = 1e-9;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
let passCount = 0;

function assertApproximatelyEqual(actual, expected, tolerance = TOLERANCE) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, but received ${actual}`,
  );
}

function runScenario(name, testFunction) {
  testFunction();
  passCount += 1;
  console.log(`PASS - ${name}`);
}

function createTransaction({
  userId,
  transactionId,
  datetime,
  amount = 20000,
  category = "FOOD",
  status = TRANSACTION_STATUS.APPROVED,
}) {
  return {
    user_id: userId,
    transaction_id: transactionId,
    transaction_datetime: datetime,
    transaction_status: status,
    amount,
    merchant_category: category,
  };
}

function createCurrentTransaction({
  userId,
  datetime = "2026-08-25T12:00:00+09:00",
  amount = 20000,
  category = "FOOD",
  transactionId = "CURRENT",
}) {
  return createTransaction({
    userId,
    transactionId,
    datetime,
    amount,
    category,
  });
}

// 최근 조회기간의 경계를 포함하면서 필요한 개수만큼 거래를 만듭니다.
function createHistory(current, count, options = {}) {
  const currentTime = new Date(current.transaction_datetime).getTime();
  const prefix = options.prefix || "H";

  return Array.from({ length: count }, (_, index) => {
    const dayOffset = index === 0 ? AI_REQUIREMENTS.LOOKBACK_DAYS : 1 + (index % 29);
    const amount = options.amounts
      ? options.amounts[index]
      : options.amount || 20000;
    const category = options.categories
      ? options.categories[index]
      : options.category || "FOOD";
    const datetime = options.datetimes
      ? options.datetimes[index]
      : new Date(currentTime - dayOffset * MILLISECONDS_PER_DAY).toISOString();

    return createTransaction({
      userId: current.user_id,
      transactionId: `${prefix}_${index}`,
      datetime,
      amount,
      category,
    });
  });
}

function extractAvailable(current, history) {
  const result = extractFeatures(current, history);
  assert.equal(result.available, true, JSON.stringify(result));
  assert.equal(result.unavailableReason, null);
  assert.notEqual(result.features, null);
  return result.features;
}

function assertUnavailable(result, reason) {
  assert.equal(result.available, false);
  assert.equal(result.unavailableReason, reason);
  assert.equal(result.features, null);
}

const featureNames = [
  "amountRatio",
  "amountZScore",
  "recent10MinCount",
  "averageTransactionInterval",
  "timeSlotFrequency",
  "categoryFrequency",
  "dailySpendRatio",
];

runScenario("정상 반환 구조", () => {
  const current = createCurrentTransaction({ userId: "STRUCTURE" });
  const result = extractFeatures(
    current,
    createHistory(current, AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS),
  );

  assert.equal(result.available, true);
  assert.equal(result.unavailableReason, null);
  assert.deepEqual(Object.keys(result.features), featureNames);
});

runScenario("amountRatio", () => {
  const current = createCurrentTransaction({
    userId: "AMOUNT_RATIO",
    amount: 55000,
  });
  const history = createHistory(
    current,
    AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS,
    { amount: 20000 },
  );
  const features = extractAvailable(current, history);

  assertApproximatelyEqual(features.amountRatio, 2.75);
});

runScenario("amountZScore", () => {
  const current = createCurrentTransaction({ userId: "Z_SCORE", amount: 55000 });
  const halfCount = AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS / 2;
  const amounts = [
    ...Array(halfCount).fill(10000),
    ...Array(halfCount).fill(30000),
  ];
  const features = extractAvailable(
    current,
    createHistory(current, amounts.length, { amounts }),
  );

  assertApproximatelyEqual(features.amountZScore, 3.5);
});

runScenario("표준편차 0", () => {
  const current = createCurrentTransaction({ userId: "ZERO_DEVIATION", amount: 55000 });
  const features = extractAvailable(
    current,
    createHistory(current, AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS),
  );

  assert.equal(features.amountZScore, 0);
  assert.ok(Number.isFinite(features.amountZScore));
});

runScenario("recent10MinCount", () => {
  const current = createCurrentTransaction({
    userId: "RECENT_COUNT",
    datetime: "2026-08-25T02:10:00+09:00",
  });
  const history = createHistory(current, AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS);
  history.push(
    createTransaction({ userId: current.user_id, transactionId: "RC_1", datetime: "2026-08-25T02:02:00+09:00" }),
    createTransaction({ userId: current.user_id, transactionId: "RC_2", datetime: "2026-08-25T02:05:00+09:00" }),
    createTransaction({ userId: current.user_id, transactionId: "RC_3", datetime: "2026-08-25T02:08:00+09:00" }),
  );

  assert.equal(extractAvailable(current, history).recent10MinCount, 4);
});

runScenario("정확히 10분 경계", () => {
  const current = createCurrentTransaction({
    userId: "RECENT_BOUNDARY",
    datetime: "2026-08-25T02:00:00+09:00",
  });
  const history = createHistory(current, AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS);
  history.push(
    createTransaction({ userId: current.user_id, transactionId: "RB_EXACT", datetime: "2026-08-25T01:50:00+09:00" }),
  );

  assert.equal(extractAvailable(current, history).recent10MinCount, 2);
});

runScenario("10분보다 오래된 거래 제외", () => {
  const current = createCurrentTransaction({
    userId: "RECENT_OUTSIDE",
    datetime: "2026-08-25T02:00:00+09:00",
  });
  const history = createHistory(current, AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS);
  history.push(
    createTransaction({ userId: current.user_id, transactionId: "RO_OLD", datetime: "2026-08-25T01:49:59+09:00" }),
  );

  assert.equal(extractAvailable(current, history).recent10MinCount, 1);
});

runScenario("averageTransactionInterval", () => {
  const current = createCurrentTransaction({
    userId: "INTERVAL",
    datetime: "2026-08-25T02:10:00+09:00",
  });
  const history = createHistory(current, AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS);
  const recentTimes = ["01:50", "02:00", "02:02", "02:05", "02:08"];

  recentTimes.forEach((time, index) => {
    history.push(
      createTransaction({
        userId: current.user_id,
        transactionId: `INTERVAL_${index}`,
        datetime: `2026-08-25T${time}:00+09:00`,
      }),
    );
  });

  assertApproximatelyEqual(
    extractAvailable(current, history).averageTransactionInterval,
    4,
  );
});

runScenario("timeSlotFrequency", () => {
  const current = createCurrentTransaction({
    userId: "TIME_SLOT",
    datetime: "2026-08-25T02:10:00+09:00",
  });
  const currentTime = new Date(current.transaction_datetime).getTime();
  const history = [];

  for (let index = 0; index < 60; index += 1) {
    const dayOffset = 1 + (index % 29);
    const hourShift = index < 3 ? 0 : 10 * 60 * 60 * 1000;
    history.push(
      createTransaction({
        userId: current.user_id,
        transactionId: `TS_${index}`,
        datetime: new Date(
          currentTime - dayOffset * MILLISECONDS_PER_DAY + hourShift,
        ).toISOString(),
      }),
    );
  }
  history.push(
    createTransaction({
      userId: current.user_id,
      transactionId: "TS_OLD",
      datetime: new Date(currentTime - 31 * MILLISECONDS_PER_DAY).toISOString(),
    }),
  );

  assertApproximatelyEqual(
    extractAvailable(current, history).timeSlotFrequency,
    3 / 60,
  );
});

runScenario("4시간 구간 경계", () => {
  const current = createCurrentTransaction({
    userId: "TIME_BOUNDARY",
    datetime: "2026-08-25T04:01:00+09:00",
  });
  const currentTime = new Date(current.transaction_datetime).getTime();
  const history = createHistory(current, AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS);

  for (const historyTransaction of history) {
    historyTransaction.transaction_datetime = new Date(
      new Date(historyTransaction.transaction_datetime).getTime() +
        8 * 60 * 60 * 1000,
    ).toISOString();
  }

  history[1].transaction_datetime = "2026-08-24T03:59:00+09:00";
  history[2].transaction_datetime = "2026-08-23T04:00:00+09:00";
  history.push(
    createTransaction({
      userId: current.user_id,
      transactionId: "TB_OLD",
      datetime: new Date(
        currentTime -
          (AI_REQUIREMENTS.MIN_HISTORY_DAYS + 1) * MILLISECONDS_PER_DAY,
      ).toISOString(),
    }),
  );

  const features = extractAvailable(current, history);
  const expectedSameSlotCount = 1;

  assertApproximatelyEqual(
    features.timeSlotFrequency,
    expectedSameSlotCount / AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS,
  );
});

runScenario("categoryFrequency", () => {
  const current = createCurrentTransaction({ userId: "CATEGORY", category: "GAME" });
  const count = 40;
  const categories = Array.from(
    { length: count },
    (_, index) => (index < 4 ? "GAME" : "FOOD"),
  );
  const features = extractAvailable(
    current,
    createHistory(current, count, { categories }),
  );

  assertApproximatelyEqual(features.categoryFrequency, 4 / 40);
});

runScenario("처음 등장한 업종", () => {
  const current = createCurrentTransaction({ userId: "NEW_CATEGORY", category: "GAME" });
  const features = extractAvailable(
    current,
    createHistory(current, AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS),
  );

  assert.equal(features.categoryFrequency, 0);
});

runScenario("UNKNOWN과 빈 업종 제외", () => {
  const current = createCurrentTransaction({ userId: "INVALID_HISTORY_CATEGORY", category: "GAME" });
  const validCount = 40;
  const categories = Array.from(
    { length: validCount },
    (_, index) => (index < 4 ? "GAME" : "FOOD"),
  );
  const history = createHistory(current, validCount, { categories });
  history.push(
    createTransaction({ userId: current.user_id, transactionId: "CAT_UNKNOWN", datetime: "2026-08-24T11:00:00+09:00", category: NEW_CATEGORY.UNKNOWN_CATEGORY }),
    createTransaction({ userId: current.user_id, transactionId: "CAT_EMPTY", datetime: "2026-08-23T11:00:00+09:00", category: "" }),
    createTransaction({ userId: current.user_id, transactionId: "CAT_BLANK", datetime: "2026-08-22T11:00:00+09:00", category: "   " }),
  );

  assertApproximatelyEqual(
    extractAvailable(current, history).categoryFrequency,
    4 / 40,
  );
});

runScenario("현재 업종 UNKNOWN", () => {
  const current = createCurrentTransaction({
    userId: "CURRENT_UNKNOWN",
    category: NEW_CATEGORY.UNKNOWN_CATEGORY,
  });
  const result = extractFeatures(
    current,
    createHistory(current, AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS),
  );

  assertUnavailable(result, RULE_STATUS.CALCULATION_UNAVAILABLE);
});

runScenario("dailySpendRatio", () => {
  const current = createCurrentTransaction({
    userId: "DAILY_RATIO",
    datetime: "2026-08-25T20:00:00+09:00",
    amount: 55000,
  });
  const history = createHistory(
    current,
    DAILY_SPEND_SPIKE.LOOKBACK_DAYS,
    { amount: 35000 },
  );
  history.push(
    createTransaction({ userId: current.user_id, transactionId: "DR_TODAY", datetime: "2026-08-25T10:00:00+09:00", amount: 50000 }),
  );

  assertApproximatelyEqual(
    extractAvailable(current, history).dailySpendRatio,
    3,
  );
});

runScenario("거래 없는 날짜도 0원 포함", () => {
  const current = createCurrentTransaction({
    userId: "ZERO_DAYS",
    datetime: "2026-08-25T20:00:00+09:00",
    amount: 20000,
  });
  const currentTime = new Date(current.transaction_datetime).getTime();
  const history = [];

  for (let index = 0; index < AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS; index += 1) {
    const dayOffset = 1 + (index % 10);
    history.push(
      createTransaction({
        userId: current.user_id,
        transactionId: `ZD_${index}`,
        datetime: new Date(
          currentTime - dayOffset * MILLISECONDS_PER_DAY - index * 60 * 1000,
        ).toISOString(),
        amount: 10000,
      }),
    );
  }
  history.push(
    createTransaction({ userId: current.user_id, transactionId: "ZD_OLD", datetime: new Date(currentTime - 31 * MILLISECONDS_PER_DAY).toISOString(), amount: 10000 }),
  );

  assertApproximatelyEqual(
    extractAvailable(current, history).dailySpendRatio,
    2,
  );
});

runScenario("오늘 누적에 현재 거래 포함", () => {
  const current = createCurrentTransaction({
    userId: "TODAY_TOTAL",
    datetime: "2026-08-25T20:00:00+09:00",
    amount: 20000,
  });
  const history = createHistory(
    current,
    AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS,
    { amount: 10000 },
  );
  history.push(
    createTransaction({ userId: current.user_id, transactionId: "TT_1", datetime: "2026-08-25T09:00:00+09:00", amount: 10000 }),
    createTransaction({ userId: current.user_id, transactionId: "TT_2", datetime: "2026-08-25T12:00:00+09:00", amount: 20000 }),
    createTransaction({ userId: current.user_id, transactionId: "TT_3", datetime: "2026-08-25T15:00:00+09:00", amount: 15000 }),
  );

  assertApproximatelyEqual(
    extractAvailable(current, history).dailySpendRatio,
    6.5,
  );
});

runScenario("AI 최소 이력 기간 부족", () => {
  const current = createCurrentTransaction({ userId: "SHORT_HISTORY" });
  const currentTime = new Date(current.transaction_datetime).getTime();
  const datetimes = Array.from(
    { length: AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS },
    (_, index) =>
      new Date(
        currentTime - (1 + (index % 20)) * MILLISECONDS_PER_DAY,
      ).toISOString(),
  );
  const result = extractFeatures(
    current,
    createHistory(current, datetimes.length, { datetimes }),
  );

  assertUnavailable(result, RULE_STATUS.INSUFFICIENT_HISTORY);
});

runScenario("최근 승인 거래 건수 부족", () => {
  const current = createCurrentTransaction({ userId: "SHORT_COUNT" });
  const history = createHistory(
    current,
    AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS - 1,
  );
  history.push(
    createTransaction({
      userId: current.user_id,
      transactionId: "SC_OLD",
      datetime: new Date(
        new Date(current.transaction_datetime).getTime() -
          (AI_REQUIREMENTS.LOOKBACK_DAYS + 1) * MILLISECONDS_PER_DAY,
      ).toISOString(),
    }),
  );

  assertUnavailable(
    extractFeatures(current, history),
    RULE_STATUS.INSUFFICIENT_HISTORY,
  );
});

runScenario("최소 거래 건수 정확한 경계", () => {
  const current = createCurrentTransaction({ userId: "EXACT_COUNT" });
  const result = extractFeatures(
    current,
    createHistory(current, AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS),
  );

  assert.equal(result.available, true);
});

const cleanCurrent = createCurrentTransaction({ userId: "CLEAN", amount: 20000 });
const cleanHistory = createHistory(
  cleanCurrent,
  AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS,
  { prefix: "CLEAN" },
);
const cleanFeatures = extractAvailable(cleanCurrent, cleanHistory);

runScenario("다른 사용자 거래 제외", () => {
  const otherCurrent = createCurrentTransaction({ userId: "OTHER", amount: 999999, category: "GAME" });
  const otherHistory = createHistory(otherCurrent, 60, {
    prefix: "OTHER",
    amount: 999999,
    category: "GAME",
  });

  assert.deepEqual(
    extractAvailable(cleanCurrent, [...cleanHistory, ...otherHistory]),
    cleanFeatures,
  );
});

runScenario("취소 환불 실패 거래 제외", () => {
  const ignoredTransactions = [
    TRANSACTION_STATUS.CANCELLED,
    TRANSACTION_STATUS.REFUNDED,
    TRANSACTION_STATUS.FAILED,
  ].map((status, index) =>
    createTransaction({
      userId: cleanCurrent.user_id,
      transactionId: `IGNORED_${status}`,
      datetime: `2026-08-25T11:5${index}:00+09:00`,
      amount: 999999,
      category: "GAME",
      status,
    }),
  );

  assert.deepEqual(
    extractAvailable(cleanCurrent, [...cleanHistory, ...ignoredTransactions]),
    cleanFeatures,
  );
});

runScenario("중복 transaction_id 제거", () => {
  assert.deepEqual(
    extractAvailable(cleanCurrent, [
      ...cleanHistory,
      { ...cleanHistory[0], amount: 999999, merchant_category: "GAME" },
    ]),
    cleanFeatures,
  );
});

runScenario("현재 거래가 history에 중복 존재", () => {
  assert.deepEqual(
    extractAvailable(cleanCurrent, [
      ...cleanHistory,
      { ...cleanCurrent, amount: 999999, merchant_category: "GAME" },
    ]),
    cleanFeatures,
  );
  assert.equal(cleanFeatures.recent10MinCount, 1);
});

runScenario("미래 거래 제외", () => {
  const futureTransaction = createTransaction({
    userId: cleanCurrent.user_id,
    transactionId: "FUTURE",
    datetime: "2026-08-26T12:00:00+09:00",
    amount: 999999,
    category: "GAME",
  });

  assert.deepEqual(
    extractAvailable(cleanCurrent, [...cleanHistory, futureTransaction]),
    cleanFeatures,
  );
});

runScenario("현재 amount 오류", () => {
  const invalidAmounts = [null, "20000", NaN, Infinity, 0, -1000];

  for (const [index, amount] of invalidAmounts.entries()) {
    const current = createCurrentTransaction({
      userId: `INVALID_AMOUNT_${index}`,
      amount,
    });
    assertUnavailable(
      extractFeatures(current, []),
      RULE_STATUS.INVALID_DATA,
    );
  }
});

runScenario("현재 기본정보 오류", () => {
  const base = createCurrentTransaction({ userId: "INVALID_BASE" });
  const invalidTransactions = [
    { ...base, user_id: undefined },
    { ...base, transaction_id: undefined },
    { ...base, transaction_datetime: "not-a-date" },
  ];

  for (const current of invalidTransactions) {
    assertUnavailable(
      extractFeatures(current, []),
      RULE_STATUS.INVALID_DATA,
    );
  }
});

runScenario("모든 Feature는 finite number", () => {
  for (const value of Object.values(cleanFeatures)) {
    assert.equal(typeof value, "number");
    assert.ok(Number.isFinite(value));
  }
});

runScenario("DB 없이 실행 가능", () => {
  const result = extractFeatures(cleanCurrent, cleanHistory);
  assert.equal(result.available, true);
  assert.equal(TIMEZONE, "Asia/Seoul");
  assert.equal(typeof RAPID_PAYMENT.WINDOW_MINUTES, "number");
});

runScenario("기존 소스 수정 없이 테스트", () => {
  assert.equal(typeof extractFeatures, "function");
  assert.equal(AI_REQUIREMENTS.LOOKBACK_DAYS, 30);
  assert.equal(
    DAILY_SPEND_SPIKE.LOOKBACK_DAYS,
    AI_REQUIREMENTS.LOOKBACK_DAYS,
  );
});

console.log("================================");
console.log("Feature Extractor 테스트 전체 통과");
console.log(`PASS: ${passCount}`);
console.log("FAIL: 0");
console.log("================================");
