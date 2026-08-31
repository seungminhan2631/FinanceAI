const assert = require("node:assert/strict");

const {
  analyzeTransactionRisk,
} = require("../src/services/finalRiskAnalysisService");
const { runDetection } = require("../src/services/detectionService");
const { scoreTransactionWithAI } = require("../src/ai/aiScoringService");
const { combineRiskScore } = require("../src/services/riskScoreCombiner");
const { getRiskLevel } = require("../src/services/riskLevelService");
const {
  trainModel,
  predictAnomaly,
  isModelTrained,
  resetModel,
} = require("../src/ai/aiModel");
const {
  AI_REQUIREMENTS,
  TRANSACTION_STATUS,
} = require("../src/config/constants");

const TOP_LEVEL_FIELDS = [
  "available",
  "unavailableReason",
  "transactionId",
  "userId",
  "rule",
  "ai",
  "risk",
];
const RULE_FIELDS = ["score", "detectedRules"];
const AI_FIELDS = [
  "available",
  "features",
  "rawScore",
  "percentile",
  "calibratedScore",
];
const NORMAL_RISK_FIELDS = ["weightedScore", "combinedScore", "level"];
const UNAVAILABLE_RISK_FIELDS = ["combinedScore", "level"];
const failures = [];
let passCount = 0;

function createTransaction({ userId, transactionId, amount, datetime, category }) {
  return {
    user_id: userId,
    transaction_id: transactionId,
    amount,
    transaction_datetime: datetime,
    merchant_category: category,
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
      datetime: getDateTime(index),
      category: index % 4 === 0 ? "TRANSPORT" : "FOOD",
    }));
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

const userId = "U_FINAL_001";
const history = createValidHistory(userId);
const transaction = createTransaction({
  userId,
  transactionId: "FINAL_CURRENT",
  amount: 28000,
  datetime: getDateTime(history.length - 1, "19:30:00"),
  category: "FOOD",
});
const trainingFeatures = createTrainingFeatures();

resetModel();
trainModel(trainingFeatures);
let referenceScores = trainingFeatures.map(
  (features) => predictAnomaly(features).anomalyScore,
);
let result = analyzeTransactionRisk(transaction, history, referenceScores);
const directRule = runDetection(transaction, history);
const directAi = scoreTransactionWithAI(transaction, history, referenceScores);
const directCombined = combineRiskScore(
  directRule.ruleScore,
  directAi.calibratedAiScore,
);

runTest("CommonJS export", () => assert.equal(typeof analyzeTransactionRisk, "function"));
runTest("40개 이상 학습 feature", () => assert.ok(trainingFeatures.length >= 40));
runTest("실제 모델 학습", () => assert.equal(isModelTrained(), true));
runTest("동일 모델 reference score", () => assert.equal(referenceScores.length, trainingFeatures.length));
runTest("reference score 유효성", () => assert.equal(referenceScores.every(Number.isFinite), true));
runTest("정상 결과 available", () => assert.equal(result.available, true));
runTest("정상 unavailableReason", () => assert.equal(result.unavailableReason, null));
runTest("transactionId 전달", () => assert.equal(result.transactionId, transaction.transaction_id));
runTest("userId 전달", () => assert.equal(result.userId, transaction.user_id));
runTest("최상위 필드 정확성", () => assert.deepEqual(Object.keys(result), TOP_LEVEL_FIELDS));
runTest("rule 필드 정확성", () => assert.deepEqual(Object.keys(result.rule), RULE_FIELDS));
runTest("ai 필드 정확성", () => assert.deepEqual(Object.keys(result.ai), AI_FIELDS));
runTest("정상 risk 필드 정확성", () => assert.deepEqual(Object.keys(result.risk), NORMAL_RISK_FIELDS));
runTest("Rule score 실제 결과 일치", () => assert.equal(result.rule.score, directRule.ruleScore));
runTest("detectedRules 실제 결과 일치", () => assert.deepEqual(result.rule.detectedRules, directRule.detectedRules));
runTest("AI available 실제 결과 일치", () => assert.equal(result.ai.available, directAi.available));
runTest("AI features 실제 결과 일치", () => assert.deepEqual(result.ai.features, directAi.features));
runTest("AI rawScore 실제 결과 일치", () => assert.equal(result.ai.rawScore, directAi.rawScore));
runTest("AI percentile 실제 결과 일치", () => assert.equal(result.ai.percentile, directAi.percentile));
runTest("AI calibratedScore 실제 결과 일치", () => assert.equal(result.ai.calibratedScore, directAi.calibratedAiScore));
runTest("weightedScore 실제 결합 결과 일치", () => assert.equal(result.risk.weightedScore, directCombined.weightedScore));
runTest("combinedScore 실제 결합 결과 일치", () => assert.equal(result.risk.combinedScore, directCombined.combinedScore));
runTest("level 실제 분류 결과 일치", () => assert.equal(result.risk.level, getRiskLevel(directCombined.combinedScore)));
runTest("combinedScore 정수", () => assert.equal(Number.isInteger(result.risk.combinedScore), true));
runTest("combinedScore 범위", () => assert.ok(result.risk.combinedScore >= 0 && result.risk.combinedScore <= 100));
runTest("정상 weightedScore 존재", () => assert.equal(Number.isFinite(result.risk.weightedScore), true));

const transactionSnapshot = JSON.stringify(transaction);
const historySnapshot = JSON.stringify(history);
const referenceSnapshot = JSON.stringify(referenceScores);
analyzeTransactionRisk(transaction, history, referenceScores);
runTest("transaction mutation 없음", () => assert.equal(JSON.stringify(transaction), transactionSnapshot));
runTest("history mutation 없음", () => assert.equal(JSON.stringify(history), historySnapshot));
runTest("referenceScores mutation 없음", () => assert.equal(JSON.stringify(referenceScores), referenceSnapshot));

resetModel();
const modelUnavailable = analyzeTransactionRisk(transaction, history, null);
runTest("MODEL_NOT_TRAINED unavailable", () => assert.equal(modelUnavailable.available, false));
runTest("MODEL_NOT_TRAINED reason", () => assert.equal(modelUnavailable.unavailableReason, "MODEL_NOT_TRAINED"));
runTest("MODEL_NOT_TRAINED에서도 Rule 보존", () => {
  assert.equal(modelUnavailable.rule.score, directRule.ruleScore);
  assert.deepEqual(modelUnavailable.rule.detectedRules, directRule.detectedRules);
});
runTest("MODEL_NOT_TRAINED features 보존", () => assert.notEqual(modelUnavailable.ai.features, null));
runTest("MODEL_NOT_TRAINED AI 점수 null", () => {
  assert.equal(modelUnavailable.ai.rawScore, null);
  assert.equal(modelUnavailable.ai.percentile, null);
  assert.equal(modelUnavailable.ai.calibratedScore, null);
});
runTest("MODEL_NOT_TRAINED risk null", () => assert.deepEqual(modelUnavailable.risk, { combinedScore: null, level: null }));
runTest("unavailable risk 필드 정확성", () => assert.deepEqual(Object.keys(modelUnavailable.risk), UNAVAILABLE_RISK_FIELDS));

const insufficientTransaction = createTransaction({
  userId: "U_FINAL_002",
  transactionId: "FINAL_INSUFFICIENT",
  amount: 15000,
  datetime: getDateTime(history.length - 1, "19:30:00"),
  category: "FOOD",
});
const insufficientRule = runDetection(insufficientTransaction, []);
const insufficient = analyzeTransactionRisk(insufficientTransaction, [], null);
runTest("INSUFFICIENT_HISTORY unavailable", () => assert.equal(insufficient.available, false));
runTest("INSUFFICIENT_HISTORY reason", () => assert.equal(insufficient.unavailableReason, "INSUFFICIENT_HISTORY"));
runTest("INSUFFICIENT_HISTORY에서도 Rule 보존", () => {
  assert.equal(insufficient.rule.score, insufficientRule.ruleScore);
  assert.deepEqual(insufficient.rule.detectedRules, insufficientRule.detectedRules);
});
runTest("INSUFFICIENT_HISTORY AI 점수 null", () => {
  assert.equal(insufficient.ai.rawScore, null);
  assert.equal(insufficient.ai.percentile, null);
  assert.equal(insufficient.ai.calibratedScore, null);
});
runTest("INSUFFICIENT_HISTORY risk null", () => assert.deepEqual(insufficient.risk, { combinedScore: null, level: null }));
runTest("unavailable에 weightedScore 없음", () => assert.equal(Object.hasOwn(insufficient.risk, "weightedScore"), false));

trainModel(trainingFeatures);
referenceScores = trainingFeatures.map(
  (features) => predictAnomaly(features).anomalyScore,
);
runTest("빈 referenceScores TypeError 전파", () => {
  assert.throws(() => analyzeTransactionRisk(transaction, history, []), TypeError);
});
runTest("NaN referenceScores TypeError 전파", () => {
  assert.throws(() => analyzeTransactionRisk(transaction, history, [NaN]), TypeError);
});
runTest("fraudProbability 필드 없음", () => assert.equal(Object.hasOwn(result, "fraudProbability"), false));
runTest("alert 필드 없음", () => assert.equal(Object.hasOwn(result, "alert"), false));

resetModel();
runTest("모든 테스트 후 모델 reset", () => assert.equal(isModelTrained(), false));

console.log("================================");
console.log("Final Risk Analysis Service 테스트 완료");
console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failures.length}`);
console.log("================================");

if (failures.length > 0) {
  process.exitCode = 1;
}
