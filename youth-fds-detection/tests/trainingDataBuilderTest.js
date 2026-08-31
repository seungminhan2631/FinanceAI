const assert = require("node:assert/strict");

const {
  buildTrainingFeatures,
} = require("../src/ai/trainingDataBuilder");
const { extractFeatures } = require("../src/ai/featureExtractor");
const {
  AI_REQUIREMENTS,
  NEW_CATEGORY,
  RULE_STATUS,
  TRANSACTION_STATUS,
} = require("../src/config/constants");

const FEATURE_NAMES = [
  "amountRatio",
  "amountZScore",
  "recent10MinCount",
  "averageTransactionInterval",
  "timeSlotFrequency",
  "categoryFrequency",
  "dailySpendRatio",
];

const RAW_TRANSACTION_FIELDS = [
  "user_id",
  "transaction_id",
  "transaction_datetime",
  "amount",
  "merchant_category",
  "transaction_status",
];

const failures = [];
let passCount = 0;

function createTransaction({
  userId,
  transactionId,
  amount,
  transactionDatetime,
  merchantCategory,
  transactionStatus = TRANSACTION_STATUS.APPROVED,
}) {
  return {
    user_id: userId,
    transaction_id: transactionId,
    amount,
    transaction_datetime: transactionDatetime,
    merchant_category: merchantCategory,
    transaction_status: transactionStatus,
  };
}

function getDateTime(dayOffset, time = "12:00:00") {
  const date = new Date(Date.UTC(2026, 5, 1));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return `${date.toISOString().slice(0, 10)}T${time}+09:00`;
}

// AI 최소 조건을 넘겨 후반 거래에서 Feature가 생성되는 이력을 만듭니다.
function createValidLongHistory(userId, options = {}) {
  const extraDays = options.extraDays || 8;
  const amountBase = options.amountBase || 10000;
  const category = options.category || "FOOD";
  const requiredDays = Math.max(
    AI_REQUIREMENTS.MIN_HISTORY_DAYS,
    AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS,
  );
  const transactionCount = requiredDays + extraDays;

  return Array.from({ length: transactionCount }, (_, index) =>
    createTransaction({
      userId,
      transactionId: `${userId}_T${String(index).padStart(3, "0")}`,
      amount: amountBase + (index % 5) * 1000,
      transactionDatetime: getDateTime(index),
      merchantCategory: index % 4 === 0 ? "TRANSPORT" : category,
    }),
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function shuffleDeterministically(values) {
  return values.filter((_, index) => index % 2 === 1).concat(
    values.filter((_, index) => index % 2 === 0).reverse(),
  );
}

function assertFiniteFeature(feature) {
  assert.deepEqual(Object.keys(feature), FEATURE_NAMES);

  for (const featureName of FEATURE_NAMES) {
    assert.equal(typeof feature[featureName], "number");
    assert.ok(Number.isFinite(feature[featureName]));
  }
}

function assertCountEquation(result) {
  assert.equal(
    result.usableFeatureCount + result.skippedFeatureCount,
    result.totalTransactions,
  );
  assert.equal(result.trainingFeatures.length, result.usableFeatureCount);
}

function runTest(name, testFunction) {
  try {
    testFunction();
    passCount += 1;
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL - ${name}: ${error.message}`);
  }
}

runTest("require", () => {
  assert.equal(typeof buildTrainingFeatures, "function");
});

runTest("배열이 아닌 입력 거부", () => {
  for (const invalidInput of [null, {}, "data"]) {
    assert.throws(() => buildTrainingFeatures(invalidInput), TypeError);
  }
});

runTest("빈 배열", () => {
  assert.deepEqual(buildTrainingFeatures([]), {
    trainingFeatures: [],
    totalTransactions: 0,
    usableFeatureCount: 0,
    skippedFeatureCount: 0,
    skippedReasons: {},
  });
});

runTest("기본 반환 구조", () => {
  const result = buildTrainingFeatures(createValidLongHistory("U001"));

  assert.deepEqual(Object.keys(result), [
    "trainingFeatures",
    "totalTransactions",
    "usableFeatureCount",
    "skippedFeatureCount",
    "skippedReasons",
  ]);
  assert.ok(Array.isArray(result.trainingFeatures));
  assert.equal(typeof result.skippedReasons, "object");
});

runTest("합계 일치", () => {
  const result = buildTrainingFeatures(createValidLongHistory("U001"));
  assertCountEquation(result);
});

runTest("초기 거래 이력 부족", () => {
  const result = buildTrainingFeatures(createValidLongHistory("U001"));

  assert.ok(result.skippedReasons[RULE_STATUS.INSUFFICIENT_HISTORY] > 0);
});

runTest("충분한 이력 후 Feature 생성", () => {
  const result = buildTrainingFeatures(createValidLongHistory("U001"));
  assert.ok(result.usableFeatureCount > 0);
});

runTest("trainingFeatures 구조", () => {
  const result = buildTrainingFeatures(createValidLongHistory("U001"));

  assert.ok(result.trainingFeatures.length > 0);
  for (const feature of result.trainingFeatures) {
    assertFiniteFeature(feature);
  }
});

runTest("원본 정보 제외", () => {
  const result = buildTrainingFeatures(createValidLongHistory("U001"));

  for (const feature of result.trainingFeatures) {
    for (const rawField of RAW_TRANSACTION_FIELDS) {
      assert.equal(Object.hasOwn(feature, rawField), false);
    }
  }
});

runTest("입력 배열 변경 금지", () => {
  const transactions = shuffleDeterministically(
    createValidLongHistory("U001"),
  );
  const before = clone(transactions);

  buildTrainingFeatures(transactions);
  assert.deepEqual(transactions, before);
});

runTest("사용자별 분리", () => {
  const userOne = createValidLongHistory("U001", {
    amountBase: 10000,
    category: "FOOD",
  });
  const userTwo = createValidLongHistory("U002", {
    amountBase: 500000,
    category: "GAMING",
  });
  const userOneResult = buildTrainingFeatures(userOne);
  const userTwoResult = buildTrainingFeatures(userTwo);
  const combinedResult = buildTrainingFeatures([...userOne, ...userTwo]);

  assert.deepEqual(combinedResult.trainingFeatures, [
    ...userOneResult.trainingFeatures,
    ...userTwoResult.trainingFeatures,
  ]);
});

runTest("입력 순서 무관", () => {
  const chronological = createValidLongHistory("U001");
  const reversed = [...chronological].reverse();
  const shuffled = shuffleDeterministically(chronological);
  const expected = buildTrainingFeatures(chronological);

  assert.deepEqual(buildTrainingFeatures(reversed), expected);
  assert.deepEqual(buildTrainingFeatures(shuffled), expected);
});

runTest("Data Leakage 방지", () => {
  const history = createValidLongHistory("U001");
  const before = buildTrainingFeatures(history);
  const futureTransactions = Array.from({ length: 5 }, (_, index) =>
    createTransaction({
      userId: "U001",
      transactionId: `U001_FUTURE_${index}`,
      amount: 10000000 + index,
      transactionDatetime: getDateTime(history.length + index, "03:00:00"),
      merchantCategory: "LUXURY",
    }),
  );
  const after = buildTrainingFeatures([...history, ...futureTransactions]);

  assert.deepEqual(
    after.trainingFeatures.slice(0, before.trainingFeatures.length),
    before.trainingFeatures,
  );
});

runTest("다른 사용자 미래 거래", () => {
  const userOne = createValidLongHistory("U001");
  const before = buildTrainingFeatures(userOne);
  const otherUserFuture = createValidLongHistory("U002", {
    extraDays: 15,
    amountBase: 900000,
    category: "LUXURY",
  });
  const after = buildTrainingFeatures([...userOne, ...otherUserFuture]);

  assert.deepEqual(
    after.trainingFeatures.slice(0, before.trainingFeatures.length),
    before.trainingFeatures,
  );
});

runTest("INVALID_DATA skip", () => {
  const history = createValidLongHistory("U001");
  const invalidTransaction = {
    ...history[history.length - 1],
    transaction_id: "U001_INVALID_AMOUNT",
    transaction_datetime: getDateTime(history.length),
    amount: null,
  };
  const result = buildTrainingFeatures([...history, invalidTransaction]);

  assert.equal(result.skippedReasons[RULE_STATUS.INVALID_DATA], 1);
  assertCountEquation(result);
});

runTest("CALCULATION_UNAVAILABLE skip", () => {
  const history = createValidLongHistory("U001");
  const unavailableTransaction = {
    ...history[history.length - 1],
    transaction_id: "U001_UNKNOWN_CATEGORY",
    transaction_datetime: getDateTime(history.length),
    merchant_category: NEW_CATEGORY.UNKNOWN_CATEGORY,
  };
  const result = buildTrainingFeatures([...history, unavailableTransaction]);

  assert.equal(
    result.skippedReasons[RULE_STATUS.CALCULATION_UNAVAILABLE],
    1,
  );
});

runTest("취소 환불 실패 거래", () => {
  const baseHistory = createValidLongHistory("U001");
  const finalTransaction = baseHistory[baseHistory.length - 1];
  const earlierHistory = baseHistory.slice(0, -1);
  const ignoredTransactions = [
    TRANSACTION_STATUS.CANCELLED,
    TRANSACTION_STATUS.REFUNDED,
    TRANSACTION_STATUS.FAILED,
  ].map((status, index) =>
    createTransaction({
      userId: "U001",
      transactionId: `U001_${status}`,
      amount: 999999,
      transactionDatetime: getDateTime(
        baseHistory.length - 2,
        `13:0${index}:00`,
      ),
      merchantCategory: "LUXURY",
      transactionStatus: status,
    }),
  );
  const expectedFinalFeature = extractFeatures(
    finalTransaction,
    earlierHistory,
  ).features;
  const result = buildTrainingFeatures([
    ...earlierHistory,
    ...ignoredTransactions,
    finalTransaction,
  ]);

  assert.equal(result.skippedReasons[RULE_STATUS.INVALID_DATA], 3);
  assert.deepEqual(
    result.trainingFeatures[result.trainingFeatures.length - 1],
    expectedFinalFeature,
  );
});

runTest("중복 transaction_id", () => {
  const history = createValidLongHistory("U001");
  const baseline = buildTrainingFeatures(history);
  const duplicate = clone(history[history.length - 1]);
  const result = buildTrainingFeatures([...history, duplicate]);

  assert.deepEqual(result.trainingFeatures, baseline.trainingFeatures);
  assert.equal(
    result.skippedReasons[RULE_STATUS.DUPLICATE_TRANSACTION],
    1,
  );
  assertCountEquation(result);
});

runTest("다른 사용자의 동일 transaction_id", () => {
  const userOne = createValidLongHistory("U001");
  const userTwo = createValidLongHistory("U002", { amountBase: 300000 });
  userOne[userOne.length - 1].transaction_id = "SHARED_ID";
  userTwo[userTwo.length - 1].transaction_id = "SHARED_ID";
  const userOneResult = buildTrainingFeatures(userOne);
  const userTwoResult = buildTrainingFeatures(userTwo);
  const combinedResult = buildTrainingFeatures([...userOne, ...userTwo]);

  assert.equal(
    combinedResult.usableFeatureCount,
    userOneResult.usableFeatureCount + userTwoResult.usableFeatureCount,
  );
  assert.equal(
    combinedResult.skippedReasons[RULE_STATUS.DUPLICATE_TRANSACTION],
    undefined,
  );
});

runTest("빈 transaction_id", () => {
  const history = createValidLongHistory("U001");
  const firstInvalid = {
    ...history[history.length - 1],
    transaction_id: "",
    transaction_datetime: getDateTime(history.length),
  };
  const secondInvalid = {
    ...firstInvalid,
    transaction_datetime: getDateTime(history.length + 1),
  };
  const result = buildTrainingFeatures([
    ...history,
    firstInvalid,
    secondInvalid,
  ]);

  assert.equal(result.skippedReasons[RULE_STATUS.INVALID_DATA], 2);
  assert.equal(
    result.skippedReasons[RULE_STATUS.DUPLICATE_TRANSACTION],
    undefined,
  );
});

runTest("동일 시각 거래 정렬", () => {
  const history = createValidLongHistory("U001");
  const sameTime = getDateTime(history.length);
  const sameTimeTransactions = ["T_Z", "T_A", "T_M"].map(
    (transactionId, index) =>
      createTransaction({
        userId: "U001",
        transactionId,
        amount: 20000 + index * 1000,
        transactionDatetime: sameTime,
        merchantCategory: "FOOD",
      }),
  );
  const firstResult = buildTrainingFeatures([
    ...history,
    ...sameTimeTransactions,
  ]);
  const secondResult = buildTrainingFeatures([
    ...history,
    ...sameTimeTransactions.reverse(),
  ]);

  assert.deepEqual(secondResult, firstResult);
});

runTest("Feature 값 가공 없음", () => {
  const history = createValidLongHistory("U001");
  const currentTransaction = history[history.length - 1];
  const previousTransactions = history.slice(0, -1);
  const directResult = extractFeatures(
    currentTransaction,
    previousTransactions,
  );
  const builderResult = buildTrainingFeatures(history);

  assert.equal(directResult.available, true);
  assert.deepEqual(
    builderResult.trainingFeatures[
      builderResult.trainingFeatures.length - 1
    ],
    directResult.features,
  );
});

runTest("trainModel 미호출", () => {
  const result = buildTrainingFeatures(createValidLongHistory("U001"));

  for (const field of ["anomalyScore", "trained", "riskScore"]) {
    assert.equal(Object.hasOwn(result, field), false);
  }
});

runTest("전체 정상 흐름", () => {
  const transactions = [
    ...createValidLongHistory("U001"),
    ...createValidLongHistory("U002", { amountBase: 200000 }),
  ];
  const result = buildTrainingFeatures(transactions);

  assert.ok(result.totalTransactions > 0);
  assert.ok(result.usableFeatureCount > 0);
  assert.ok(result.skippedFeatureCount > 0);
  assertCountEquation(result);

  for (const feature of result.trainingFeatures) {
    assertFiniteFeature(feature);
  }
});

console.log("================================");

if (failures.length === 0) {
  console.log("Training Data Builder 테스트 전체 통과");
} else {
  console.log("Training Data Builder 테스트 실패");
}

console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failures.length}`);
console.log("================================");

if (failures.length > 0) {
  process.exitCode = 1;
}
