const assert = require("node:assert/strict");

const {
  buildTrainingFeatures,
} = require("../src/ai/trainingDataBuilder");
const {
  trainModel,
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

const USER_IDS = ["U001", "U002", "U003"];
const failures = [];
let passCount = 0;
let trainingResult;
let trainingModelResult;
let normalResult;
let abnormalResult;

function createTransaction({
  userId,
  transactionId,
  amount,
  transactionDatetime,
  merchantCategory,
}) {
  return {
    user_id: userId,
    transaction_id: transactionId,
    amount,
    transaction_datetime: transactionDatetime,
    merchant_category: merchantCategory,
    transaction_status: TRANSACTION_STATUS.APPROVED,
  };
}

function getDateTime(dayOffset, time) {
  const date = new Date(Date.UTC(2026, 5, 1));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return `${date.toISOString().slice(0, 10)}T${time}+09:00`;
}

// 사용자의 평소 금액, 시간, 업종에 작은 변화를 준 과거 거래를 만듭니다.
function createUserTransactions(userId, userIndex) {
  const minimumDays = Math.max(
    AI_REQUIREMENTS.MIN_HISTORY_DAYS,
    AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS,
    AI_REQUIREMENTS.LOOKBACK_DAYS,
  );
  const transactionCount = minimumDays + 31;
  const categories = ["FOOD", "CAFE", "TRANSPORT", "CONVENIENCE"];
  const hours = ["11:20:00", "13:40:00", "16:10:00", "18:30:00", "19:50:00"];

  return Array.from({ length: transactionCount }, (_, index) =>
    createTransaction({
      userId,
      transactionId: `${userId}_H${String(index).padStart(3, "0")}`,
      amount: 10000 + userIndex * 2000 + (index % 11) * 1700,
      transactionDatetime: getDateTime(index, hours[index % hours.length]),
      merchantCategory: categories[(index + userIndex) % categories.length],
    }),
  );
}

function assertFiniteFeatures(features) {
  assert.deepEqual(Object.keys(features), FEATURE_NAMES);

  for (const featureName of FEATURE_NAMES) {
    assert.equal(typeof features[featureName], "number");
    assert.ok(Number.isFinite(features[featureName]));
  }
}

function assertSuccessfulAnalysis(result) {
  assert.equal(result.available, true);
  assert.equal(result.unavailableReason, null);
  assert.notEqual(result.features, null);
  assertFiniteFeatures(result.features);
  assert.equal(typeof result.anomalyScore, "number");
  assert.ok(Number.isFinite(result.anomalyScore));
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

const transactionsByUser = USER_IDS.map((userId, index) =>
  createUserTransactions(userId, index),
);
const trainingTransactions = transactionsByUser.flat();
const targetUserHistory = transactionsByUser[0];
const nextDayOffset = targetUserHistory.length;
const normalTransaction = createTransaction({
  userId: USER_IDS[0],
  transactionId: "U001_NORMAL_NEW",
  amount: 18500,
  transactionDatetime: getDateTime(nextDayOffset, "11:30:00"),
  merchantCategory: "FOOD",
});
const rapidTransactions = Array.from({ length: 6 }, (_, index) =>
  createTransaction({
    userId: USER_IDS[0],
    transactionId: `U001_RAPID_${index}`,
    amount: 200000 + index * 10000,
    transactionDatetime: getDateTime(
      nextDayOffset,
      `02:${String(51 + index).padStart(2, "0")}:00`,
    ),
    merchantCategory: "GAMING",
  }),
);
const abnormalHistory = [...targetUserHistory, ...rapidTransactions];
const abnormalTransaction = createTransaction({
  userId: USER_IDS[0],
  transactionId: "U001_ABNORMAL_NEW",
  amount: 800000,
  transactionDatetime: getDateTime(nextDayOffset, "03:00:00"),
  merchantCategory: "LUXURY",
});

runTest("학습용 원본 거래 생성", () => {
  assert.equal(USER_IDS.length, 3);
  assert.equal(trainingTransactions.length, targetUserHistory.length * 3);
  assert.ok(trainingTransactions.length > 0);

  for (const transaction of trainingTransactions) {
    assert.match(transaction.transaction_datetime, /[+-]\d{2}:\d{2}$/);
    assert.ok(new Date(transaction.transaction_datetime).getTime() < Date.now());
  }
});

runTest("Training Data Builder", () => {
  trainingResult = buildTrainingFeatures(trainingTransactions);

  assert.ok(Array.isArray(trainingResult.trainingFeatures));
  assert.ok(trainingResult.trainingFeatures.length > 0);
  assert.ok(trainingResult.usableFeatureCount > 0);
  assert.equal(
    trainingResult.trainingFeatures.length,
    trainingResult.usableFeatureCount,
  );
  assert.equal(
    trainingResult.totalTransactions,
    trainingResult.usableFeatureCount + trainingResult.skippedFeatureCount,
  );
  assert.ok(
    trainingResult.skippedReasons[RULE_STATUS.INSUFFICIENT_HISTORY] > 0,
  );
});

runTest("학습 Feature 구조", () => {
  for (const features of trainingResult.trainingFeatures) {
    assertFiniteFeatures(features);
  }
});

runTest("여러 사용자 학습 데이터", () => {
  const individualFeatureCount = transactionsByUser
    .map((transactions) => buildTrainingFeatures(transactions))
    .reduce((sum, result) => sum + result.usableFeatureCount, 0);

  assert.equal(trainingResult.usableFeatureCount, individualFeatureCount);
});

runTest("Isolation Forest 학습", () => {
  resetModel();
  assert.equal(isModelTrained(), false);

  trainingModelResult = trainModel(trainingResult.trainingFeatures);
  assert.equal(trainingModelResult.trained, true);
  assert.equal(
    trainingModelResult.trainingSampleCount,
    trainingResult.trainingFeatures.length,
  );
  assert.equal(isModelTrained(), true);
});

runTest("정상 신규 거래 AI 분석", () => {
  normalResult = analyzeTransactionWithAI(
    normalTransaction,
    targetUserHistory,
  );
  assertSuccessfulAnalysis(normalResult);
});

runTest("비정상 신규 거래 AI 분석", () => {
  abnormalResult = analyzeTransactionWithAI(
    abnormalTransaction,
    abnormalHistory,
  );
  assertSuccessfulAnalysis(abnormalResult);
});

runTest("Feature 차이 확인", () => {
  const differentFeatureNames = FEATURE_NAMES.filter(
    (featureName) =>
      normalResult.features[featureName] !==
      abnormalResult.features[featureName],
  );

  assert.ok(differentFeatureNames.length > 0);
  console.log("INFO - Normal Features:", normalResult.features);
  console.log("INFO - Abnormal Features:", abnormalResult.features);
  console.log(
    `INFO - Normal raw anomaly score: ${normalResult.anomalyScore}`,
  );
  console.log(
    `INFO - Abnormal raw anomaly score: ${abnormalResult.anomalyScore}`,
  );
  console.log(
    `INFO - abnormal score is higher: ${
      abnormalResult.anomalyScore > normalResult.anomalyScore
    }`,
  );
});

runTest("Data Leakage 방지 입력", () => {
  const latestHistoryTime = Math.max(
    ...targetUserHistory.map((transaction) =>
      new Date(transaction.transaction_datetime).getTime(),
    ),
  );
  const normalTime = new Date(normalTransaction.transaction_datetime).getTime();
  const abnormalTime = new Date(
    abnormalTransaction.transaction_datetime,
  ).getTime();

  assert.ok(latestHistoryTime < normalTime);
  assert.ok(
    abnormalHistory.every(
      (transaction) =>
        new Date(transaction.transaction_datetime).getTime() < abnormalTime,
    ),
  );
});

runTest("현재 설계 외 점수 필드 없음", () => {
  assert.deepEqual(Object.keys(normalResult), [
    "available",
    "unavailableReason",
    "features",
    "anomalyScore",
  ]);

  for (const field of [
    "aiScore",
    "riskScore",
    "fraudProbability",
    "threshold",
    "ruleScore",
    "combinedScore",
  ]) {
    assert.equal(Object.hasOwn(normalResult, field), false);
    assert.equal(Object.hasOwn(abnormalResult, field), false);
  }
});

runTest("모델 reset", () => {
  resetModel();
  assert.equal(isModelTrained(), false);
});

runTest("MODEL_NOT_TRAINED 처리", () => {
  const result = analyzeTransactionWithAI(
    normalTransaction,
    targetUserHistory,
  );

  assert.equal(result.available, false);
  assert.equal(result.unavailableReason, "MODEL_NOT_TRAINED");
  assert.notEqual(result.features, null);
  assertFiniteFeatures(result.features);
  assert.equal(result.anomalyScore, null);
});

runTest("재학습", () => {
  const result = trainModel(trainingResult.trainingFeatures);

  assert.equal(result.trained, true);
  assert.equal(
    result.trainingSampleCount,
    trainingResult.trainingFeatures.length,
  );
  assert.equal(isModelTrained(), true);
});

runTest("재학습 후 AI 분석", () => {
  const result = analyzeTransactionWithAI(
    normalTransaction,
    targetUserHistory,
  );
  assertSuccessfulAnalysis(result);
});

console.log(`INFO - Raw transactions: ${trainingTransactions.length}`);

if (trainingResult) {
  console.log(
    `INFO - Training features: ${trainingResult.usableFeatureCount}`,
  );
  console.log(
    `INFO - Skipped transactions: ${trainingResult.skippedFeatureCount}`,
  );
}

console.log("================================");

if (failures.length === 0) {
  console.log("AI Training Pipeline 테스트 전체 통과");
} else {
  console.log("AI Training Pipeline 테스트 실패");
}

console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failures.length}`);
console.log("================================");

if (failures.length > 0) {
  process.exitCode = 1;
}
