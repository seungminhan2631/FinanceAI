const assert = require("node:assert/strict");

const { extractFeatures } = require("../src/ai/featureExtractor");
const {
  trainModel,
  predictAnomaly,
  isModelTrained,
  resetModel,
} = require("../src/ai/aiModel");
const { analyzeTransactionWithAI } = require("../src/ai/aiService");
const {
  AI_REQUIREMENTS,
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

const SERVICE_RESULT_FIELDS = [
  "available",
  "unavailableReason",
  "features",
  "anomalyScore",
];

const currentTransaction = createTransaction({
  userId: "U001",
  transactionId: "CURRENT_NORMAL",
  amount: 20500,
  transactionDatetime: "2026-08-25T18:00:00+09:00",
  merchantCategory: "FOOD",
});
const validHistory = createValidHistory(currentTransaction);
const trainingFeatures = createTrainingFeatures();
const failures = [];
let passCount = 0;
let normalRawScore = null;
let abnormalRawScore = null;

// 테스트용 거래 객체를 실제 입력 구조와 동일하게 만듭니다.
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

function getSeoulDateTime(baseDateKey, dayOffset, time) {
  const [year, month, day] = baseDateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return `${date.toISOString().slice(0, 10)}T${time}+09:00`;
}

// 상수의 최소 조건보다 충분한 승인 거래 이력을 생성합니다.
function createValidHistory(transaction) {
  const history = [];
  const recentCount = Math.max(
    AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS,
    AI_REQUIREMENTS.LOOKBACK_DAYS,
  );

  for (let index = 1; index <= recentCount; index += 1) {
    history.push(
      createTransaction({
        userId: transaction.user_id,
        transactionId: `HISTORY_${index}`,
        amount: 18000 + (index % 5) * 1000,
        transactionDatetime: getSeoulDateTime("2026-08-25", -index, "18:00:00"),
        merchantCategory: index % 4 === 0 ? "TRANSPORT" : "FOOD",
      }),
    );
  }

  const oldestDayOffset = -(AI_REQUIREMENTS.MIN_HISTORY_DAYS + 1);
  history.push(
    createTransaction({
      userId: transaction.user_id,
      transactionId: "HISTORY_OLDEST",
      amount: 19000,
      transactionDatetime: getSeoulDateTime(
        "2026-08-25",
        oldestDayOffset,
        "18:00:00",
      ),
      merchantCategory: "FOOD",
    }),
  );

  return history;
}

// Isolation Forest 학습용 정상 Feature를 조금씩 다르게 생성합니다.
function createTrainingFeatures() {
  const features = [];

  for (let index = 0; index < 20; index += 1) {
    features.push({
      amountRatio: 0.85 + (index % 7) * 0.05,
      amountZScore: -0.4 + (index % 9) * 0.1,
      recent10MinCount: index % 6 === 0 ? 2 : 1,
      averageTransactionInterval: 90 + (index % 8) * 15,
      timeSlotFrequency: 0.22 + (index % 5) * 0.04,
      categoryFrequency: 0.3 + (index % 6) * 0.04,
      dailySpendRatio: 0.8 + (index % 7) * 0.07,
    });
  }

  return features;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function assertFiniteFeatures(features) {
  assert.deepEqual(Object.keys(features), FEATURE_NAMES);

  for (const featureName of FEATURE_NAMES) {
    assert.equal(typeof features[featureName], "number");
    assert.ok(Number.isFinite(features[featureName]));
  }
}

function assertUnavailable(result, reason, featuresExpected) {
  assert.equal(result.available, false);
  assert.equal(result.unavailableReason, reason);
  assert.equal(result.anomalyScore, null);

  if (featuresExpected) {
    assert.notEqual(result.features, null);
  } else {
    assert.equal(result.features, null);
  }
}

runTest("모듈 연결", () => {
  for (const moduleFunction of [
    trainModel,
    resetModel,
    isModelTrained,
    extractFeatures,
    analyzeTransactionWithAI,
  ]) {
    assert.equal(typeof moduleFunction, "function");
  }
});

runTest("모델 미학습 상태", () => {
  resetModel();
  const result = analyzeTransactionWithAI(currentTransaction, validHistory);

  assertUnavailable(result, "MODEL_NOT_TRAINED", true);
  assertFiniteFeatures(result.features);
});

runTest("모델 학습", () => {
  resetModel();
  const result = trainModel(trainingFeatures);

  assert.deepEqual(result, {
    trained: true,
    trainingSampleCount: trainingFeatures.length,
  });
  assert.equal(isModelTrained(), true);
});

runTest("전체 AI 파이프라인", () => {
  const result = analyzeTransactionWithAI(currentTransaction, validHistory);

  assert.equal(result.available, true);
  assert.equal(result.unavailableReason, null);
  assert.notEqual(result.features, null);
  assert.equal(typeof result.anomalyScore, "number");
  assert.ok(Number.isFinite(result.anomalyScore));
});

runTest("Feature 7개", () => {
  const result = analyzeTransactionWithAI(currentTransaction, validHistory);
  assertFiniteFeatures(result.features);
});

runTest("직접 Feature 계산 결과 비교", () => {
  const directResult = extractFeatures(currentTransaction, validHistory);
  const serviceResult = analyzeTransactionWithAI(currentTransaction, validHistory);

  assert.equal(directResult.available, true);
  assert.deepEqual(serviceResult.features, directResult.features);
});

runTest("직접 AI 예측 결과 비교", () => {
  const featureResult = extractFeatures(currentTransaction, validHistory);
  const directPrediction = predictAnomaly(featureResult.features);
  const serviceResult = analyzeTransactionWithAI(currentTransaction, validHistory);

  assert.equal(serviceResult.anomalyScore, directPrediction.anomalyScore);
});

runTest("raw score 유지", () => {
  const result = analyzeTransactionWithAI(currentTransaction, validHistory);
  assert.deepEqual(Object.keys(result), SERVICE_RESULT_FIELDS);

  for (const field of [
    "aiScore",
    "riskScore",
    "finalScore",
    "combinedScore",
    "isAnomalous",
    "riskLevel",
    "threshold",
  ]) {
    assert.equal(Object.hasOwn(result, field), false);
  }
});

runTest("이력 부족", () => {
  const insufficientHistory = validHistory.slice(
    0,
    AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS - 1,
  );
  const result = analyzeTransactionWithAI(
    currentTransaction,
    insufficientHistory,
  );

  assertUnavailable(result, RULE_STATUS.INSUFFICIENT_HISTORY, false);
});

runTest("잘못된 현재 거래", () => {
  const invalidTransaction = { ...currentTransaction, amount: null };
  const result = analyzeTransactionWithAI(invalidTransaction, validHistory);

  assertUnavailable(result, RULE_STATUS.INVALID_DATA, false);
});

runTest("다른 사용자 거래 무시", () => {
  const otherUserHistory = Array.from({ length: 5 }, (_, index) =>
    createTransaction({
      userId: "U999",
      transactionId: `OTHER_${index}`,
      amount: 999999,
      transactionDatetime: `2026-08-25T17:0${index}:00+09:00`,
      merchantCategory: "LUXURY",
    }),
  );
  const before = extractFeatures(currentTransaction, validHistory);
  const after = extractFeatures(currentTransaction, [
    ...validHistory,
    ...otherUserHistory,
  ]);

  assert.deepEqual(after, before);
});

runTest("미래 거래 무시", () => {
  const futureHistory = Array.from({ length: 3 }, (_, index) =>
    createTransaction({
      userId: currentTransaction.user_id,
      transactionId: `FUTURE_${index}`,
      amount: 500000,
      transactionDatetime: `2026-08-26T0${index}:00:00+09:00`,
      merchantCategory: "LUXURY",
    }),
  );
  const before = extractFeatures(currentTransaction, validHistory);
  const after = extractFeatures(currentTransaction, [
    ...validHistory,
    ...futureHistory,
  ]);

  assert.deepEqual(after, before);
});

runTest("취소 환불 실패 거래 무시", () => {
  const ignoredHistory = [
    TRANSACTION_STATUS.CANCELLED,
    TRANSACTION_STATUS.REFUNDED,
    TRANSACTION_STATUS.FAILED,
  ].map((status, index) =>
    createTransaction({
      userId: currentTransaction.user_id,
      transactionId: `IGNORED_${status}`,
      amount: 700000,
      transactionDatetime: `2026-08-25T17:0${index}:00+09:00`,
      merchantCategory: "LUXURY",
      transactionStatus: status,
    }),
  );
  const before = extractFeatures(currentTransaction, validHistory);
  const after = extractFeatures(currentTransaction, [
    ...validHistory,
    ...ignoredHistory,
  ]);

  assert.deepEqual(after, before);
});

runTest("중복 transaction_id 무시", () => {
  const duplicatedHistory = [...validHistory, clone(validHistory[0])];
  const before = extractFeatures(currentTransaction, validHistory);
  const after = extractFeatures(currentTransaction, duplicatedHistory);

  assert.deepEqual(after, before);
});

runTest("현재 거래 history 중복 무시", () => {
  const currentTransactionDuplicate = {
    ...currentTransaction,
    amount: 999999,
  };
  const before = extractFeatures(currentTransaction, validHistory);
  const after = extractFeatures(currentTransaction, [
    ...validHistory,
    currentTransactionDuplicate,
  ]);

  assert.deepEqual(after, before);
});

runTest("정상 거래와 이상 거래 비교", () => {
  const abnormalTransaction = createTransaction({
    userId: currentTransaction.user_id,
    transactionId: "CURRENT_ABNORMAL",
    amount: 1000000,
    transactionDatetime: "2026-08-25T03:00:00+09:00",
    merchantCategory: "LUXURY",
  });
  const abnormalBaseHistory = createValidHistory(abnormalTransaction);
  const rapidHistory = Array.from({ length: 8 }, (_, index) =>
    createTransaction({
      userId: abnormalTransaction.user_id,
      transactionId: `ABNORMAL_RAPID_${index}`,
      amount: 250000,
      transactionDatetime: `2026-08-25T02:${String(51 + index).padStart(2, "0")}:00+09:00`,
      merchantCategory: "GAMING",
    }),
  );
  const normalResult = analyzeTransactionWithAI(
    currentTransaction,
    validHistory,
  );
  const abnormalResult = analyzeTransactionWithAI(abnormalTransaction, [
    ...abnormalBaseHistory,
    ...rapidHistory,
  ]);

  assert.equal(normalResult.available, true);
  assert.equal(abnormalResult.available, true);
  assert.ok(Number.isFinite(normalResult.anomalyScore));
  assert.ok(Number.isFinite(abnormalResult.anomalyScore));

  normalRawScore = normalResult.anomalyScore;
  abnormalRawScore = abnormalResult.anomalyScore;
  console.log(`INFO - normal transaction raw anomaly score: ${normalRawScore}`);
  console.log(`INFO - abnormal transaction raw anomaly score: ${abnormalRawScore}`);
  console.log(
    `INFO - abnormal score greater than normal: ${abnormalRawScore > normalRawScore}`,
  );
});

runTest("reset 후 서비스 분석", () => {
  resetModel();
  const result = analyzeTransactionWithAI(currentTransaction, validHistory);

  assertUnavailable(result, "MODEL_NOT_TRAINED", true);
  assert.equal(isModelTrained(), false);
});

runTest("재학습 후 다시 분석", () => {
  const trainingResult = trainModel(trainingFeatures);
  const result = analyzeTransactionWithAI(currentTransaction, validHistory);

  assert.equal(trainingResult.trained, true);
  assert.equal(isModelTrained(), true);
  assert.equal(result.available, true);
  assert.ok(Number.isFinite(result.anomalyScore));
});

console.log("================================");

if (failures.length === 0) {
  console.log("AI Integration 테스트 전체 통과");
} else {
  console.log("AI Integration 테스트 실패");
}

console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failures.length}`);
console.log("================================");

if (normalRawScore !== null) {
  console.log(`INFO - final normal raw anomaly score: ${normalRawScore}`);
}

if (abnormalRawScore !== null) {
  console.log(`INFO - final abnormal raw anomaly score: ${abnormalRawScore}`);
}

if (failures.length > 0) {
  process.exitCode = 1;
}
