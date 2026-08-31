const assert = require("node:assert/strict");

const {
  scoreTransactionWithAI,
} = require("../src/ai/aiScoringService");
const {
  analyzeTransactionWithAI,
} = require("../src/ai/aiService");
const {
  trainModel,
  predictAnomaly,
  isModelTrained,
  resetModel,
} = require("../src/ai/aiModel");
const {
  normalizeAiScore,
} = require("../src/ai/aiScoreNormalizer");
const {
  calibrateAiScore,
} = require("../src/ai/aiScoreCalibrator");
const {
  AI_REQUIREMENTS,
  TRANSACTION_STATUS,
} = require("../src/config/constants");

const RESULT_FIELDS = [
  "available",
  "unavailableReason",
  "features",
  "rawScore",
  "percentile",
  "calibratedAiScore",
];
const failures = [];
let passCount = 0;

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

function getDateTime(dayOffset, time = "18:00:00") {
  const date = new Date(Date.UTC(2026, 5, 1));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return `${date.toISOString().slice(0, 10)}T${time}+09:00`;
}

function createValidHistory(userId) {
  const minimumCount = Math.max(
    AI_REQUIREMENTS.MIN_APPROVED_TRANSACTIONS,
    AI_REQUIREMENTS.LOOKBACK_DAYS,
    AI_REQUIREMENTS.MIN_HISTORY_DAYS,
  );

  return Array.from({ length: minimumCount + 5 }, (_, index) =>
    createTransaction({
      userId,
      transactionId: `HISTORY_${String(index).padStart(3, "0")}`,
      amount: 12000 + (index % 7) * 1800,
      transactionDatetime: getDateTime(index),
      merchantCategory: index % 4 === 0 ? "TRANSPORT" : "FOOD",
    }),
  );
}

function createTrainingFeatures() {
  return Array.from({ length: 40 }, (_, index) => ({
    amountRatio: 0.7 + (index % 8) * 0.1,
    amountZScore: -1.2 + (index % 10) * 0.25,
    recent10MinCount: 1 + (index % 3),
    averageTransactionInterval: 300 + (index % 9) * 70,
    timeSlotFrequency: 0.1 + (index % 6) * 0.1,
    categoryFrequency: 0.15 + (index % 5) * 0.12,
    dailySpendRatio: 0.6 + (index % 7) * 0.2,
  }));
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

const userId = "U001";
const validHistory = createValidHistory(userId);
const currentTransaction = createTransaction({
  userId,
  transactionId: "CURRENT_TRANSACTION",
  amount: 28000,
  transactionDatetime: getDateTime(validHistory.length - 1, "19:30:00"),
  merchantCategory: "FOOD",
});
const insufficientHistoryTransaction = createTransaction({
  userId: "U002",
  transactionId: "INSUFFICIENT_HISTORY_TRANSACTION",
  amount: 15000,
  transactionDatetime: getDateTime(validHistory.length - 1, "19:30:00"),
  merchantCategory: "FOOD",
});
const trainingFeatures = createTrainingFeatures();

resetModel();
trainModel(trainingFeatures);
let referenceScores = trainingFeatures.map(
  (features) => predictAnomaly(features).anomalyScore,
);
let scoringResult = scoreTransactionWithAI(
  currentTransaction,
  validHistory,
  referenceScores,
);

runTest("aiScoringService require", () => {
  assert.equal(typeof scoreTransactionWithAI, "function");
});

runTest("실제 모델 기반 AI Scoring 성공", () => {
  assert.equal(isModelTrained(), true);
  assert.equal(referenceScores.length, trainingFeatures.length);
});

runTest("available true", () => {
  assert.equal(scoringResult.available, true);
});

runTest("unavailableReason null", () => {
  assert.equal(scoringResult.unavailableReason, null);
});

runTest("features 존재", () => {
  assert.notEqual(scoringResult.features, null);
  assert.equal(typeof scoringResult.features, "object");
});

runTest("rawScore finite number", () => {
  assert.equal(Number.isFinite(scoringResult.rawScore), true);
});

runTest("percentile finite number", () => {
  assert.equal(Number.isFinite(scoringResult.percentile), true);
});

runTest("percentile 0~100", () => {
  assert.ok(scoringResult.percentile >= 0 && scoringResult.percentile <= 100);
});

runTest("calibratedAiScore integer", () => {
  assert.equal(Number.isInteger(scoringResult.calibratedAiScore), true);
});

runTest("calibratedAiScore 0~100", () => {
  assert.ok(
    scoringResult.calibratedAiScore >= 0
      && scoringResult.calibratedAiScore <= 100,
  );
});

runTest("기존 aiService rawScore 결과 일치", () => {
  const direct = analyzeTransactionWithAI(currentTransaction, validHistory);
  assert.equal(scoringResult.rawScore, direct.anomalyScore);
});

runTest("Normalizer 결과 일치", () => {
  const direct = normalizeAiScore(scoringResult.rawScore, referenceScores);
  assert.equal(scoringResult.percentile, direct.percentile);
});

runTest("Calibrator 결과 일치", () => {
  const direct = calibrateAiScore(scoringResult.percentile);
  assert.equal(scoringResult.calibratedAiScore, direct.calibratedAiScore);
});

runTest("최종 반환 필드 확인", () => {
  assert.deepEqual(Object.keys(scoringResult), RESULT_FIELDS);
});

let insufficientResult;
runTest("AI 분석 unavailable 상태 전달", () => {
  insufficientResult = scoreTransactionWithAI(
    insufficientHistoryTransaction,
    [],
    null,
  );
  assert.equal(insufficientResult.available, false);
  assert.equal(insufficientResult.rawScore, null);
  assert.equal(insufficientResult.percentile, null);
  assert.equal(insufficientResult.calibratedAiScore, null);
});

runTest("INSUFFICIENT_HISTORY 유지", () => {
  assert.equal(insufficientResult.unavailableReason, "INSUFFICIENT_HISTORY");
});

runTest("unavailable이면 referenceScores 미사용", () => {
  assert.doesNotThrow(() =>
    scoreTransactionWithAI(insufficientHistoryTransaction, [], null),
  );
});

runTest("MODEL_NOT_TRAINED 전달", () => {
  resetModel();
  const result = scoreTransactionWithAI(
    currentTransaction,
    validHistory,
    null,
  );
  assert.equal(result.available, false);
  assert.equal(result.unavailableReason, "MODEL_NOT_TRAINED");
  assert.notEqual(result.features, null);
  assert.equal(result.rawScore, null);
  assert.equal(result.percentile, null);
  assert.equal(result.calibratedAiScore, null);

  trainModel(trainingFeatures);
  referenceScores = trainingFeatures.map(
    (features) => predictAnomaly(features).anomalyScore,
  );
  scoringResult = scoreTransactionWithAI(
    currentTransaction,
    validHistory,
    referenceScores,
  );
});

runTest("빈 referenceScores 거부", () => {
  assert.throws(
    () => scoreTransactionWithAI(currentTransaction, validHistory, []),
    TypeError,
  );
});

runTest("배열이 아닌 referenceScores 거부", () => {
  assert.throws(
    () => scoreTransactionWithAI(currentTransaction, validHistory, {}),
    TypeError,
  );
});

runTest("referenceScores 내부 NaN 거부", () => {
  assert.throws(
    () => scoreTransactionWithAI(currentTransaction, validHistory, [NaN]),
    TypeError,
  );
});

runTest("referenceScores 내부 Infinity 거부", () => {
  assert.throws(
    () => scoreTransactionWithAI(currentTransaction, validHistory, [Infinity]),
    TypeError,
  );
});

runTest("referenceScores 내부 문자열 거부", () => {
  assert.throws(
    () => scoreTransactionWithAI(currentTransaction, validHistory, ["0.5"]),
    TypeError,
  );
});

runTest("referenceScores mutation 없음", () => {
  const snapshot = [...referenceScores];
  scoreTransactionWithAI(currentTransaction, validHistory, referenceScores);
  assert.deepEqual(referenceScores, snapshot);
});

runTest("transactionHistory mutation 없음", () => {
  const snapshot = JSON.stringify(validHistory);
  scoreTransactionWithAI(currentTransaction, validHistory, referenceScores);
  assert.equal(JSON.stringify(validHistory), snapshot);
});

runTest("currentTransaction mutation 없음", () => {
  const snapshot = JSON.stringify(currentTransaction);
  scoreTransactionWithAI(currentTransaction, validHistory, referenceScores);
  assert.equal(JSON.stringify(currentTransaction), snapshot);
});

runTest("fraud probability 필드 없음", () => {
  assert.equal(Object.hasOwn(scoringResult, "fraudProbability"), false);
});

runTest("Rule 관련 필드 없음", () => {
  for (const field of ["ruleScore", "finalRiskScore", "combinedScore"]) {
    assert.equal(Object.hasOwn(scoringResult, field), false);
  }
});

resetModel();
assert.equal(isModelTrained(), false);

console.log("================================");
console.log("AI Scoring Service 테스트 완료");
console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failures.length}`);
console.log("================================");

if (failures.length > 0) {
  process.exitCode = 1;
}
