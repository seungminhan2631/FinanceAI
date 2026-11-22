const assert = require("node:assert/strict");
const path = require("node:path");

const DATABASE_DIR = "C:\\Users\\dtdt7\\FinanceAI\\database";
const EXPECTED_TRANSACTION_COUNT = 312;
const CUTOFF_TRANSACTION_ID = "T0238";
const CONTROL_IDS = ["T0242", "T0243", "T0244", "T0245"];
const ANOMALY_IDS = [
  "T0238", "T0257", "T0258", "T0259", "T0260", "T0261",
  "T0269", "T0270", "T0271", "T0272", "T0281", "T0292",
  "T0299", "T0300", "T0301", "T0302",
];
const ALL_IDS = [...CONTROL_IDS, ...ANOMALY_IDS];
const COMPOSITION_IDS = ["T0242", "T0281", "T0292", "T0302"];
const EXPECTED_FIELDS = [
  "available", "unavailableReason", "features", "rawScore", "percentile",
  "calibratedAiScore",
];
const FORBIDDEN_FIELDS = [
  "fraudProbability", "ruleScore", "finalRiskScore", "combinedScore",
];

const { buildTrainingFeatures } = require("../src/ai/trainingDataBuilder");
const {
  trainModel, predictAnomaly, isModelTrained, resetModel,
} = require("../src/ai/aiModel");
const { analyzeTransactionWithAI } = require("../src/ai/aiService");
const { normalizeAiScore } = require("../src/ai/aiScoreNormalizer");
const { calibrateAiScore } = require("../src/ai/aiScoreCalibrator");
const { scoreTransactionWithAI } = require("../src/ai/aiScoringService");

let close;
let currentStep = "초기화";

function getTime(transaction) {
  return new Date(transaction.transaction_datetime).getTime();
}

function requiredTransaction(id, transactions) {
  const transaction = transactions.find((item) => item.transaction_id === id);
  assert.ok(transaction, `${id} 거래가 DB에 없습니다.`);
  return transaction;
}

function historyBefore(transaction, transactions) {
  const time = getTime(transaction);
  return transactions.filter(
    (item) => item.user_id === transaction.user_id && getTime(item) < time,
  );
}

function statistics(values) {
  assert.ok(values.length > 0);
  return {
    count: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function tableRows(ids, inputs, results) {
  return ids.map((id) => ({
    transaction_id: id,
    user_id: inputs[id].transaction.user_id,
    rawScore: results[id].rawScore,
    percentile: results[id].percentile,
    calibratedAiScore: results[id].calibratedAiScore,
  }));
}

function selectedDetail(id, results) {
  const { features, rawScore, percentile, calibratedAiScore } = results[id];
  const featureNamesById = {
    T0281: ["amountRatio", "amountZScore", "dailySpendRatio"],
    T0292: ["timeSlotFrequency", "categoryFrequency", "amountRatio"],
    T0299: ["recent10MinCount"],
    T0302: ["recent10MinCount", "dailySpendRatio"],
  };
  const selectedFeatures = Object.fromEntries(
    (featureNamesById[id] || [])
      .filter((name) => Object.hasOwn(features, name))
      .map((name) => [name, features[name]]),
  );
  console.log(`DETAIL - ${id}`, {
    features: id === "T0245" ? features : selectedFeatures,
    rawScore,
    percentile,
    calibratedAiScore,
  });
}

async function run() {
  try {
    console.log("=== DB AI Scoring Service E2E Test ===");

    currentStep = "DB 모듈 연결";
    const originalDirectory = process.cwd();
    let repository;
    try {
      process.chdir(DATABASE_DIR);
      repository = require(path.join(DATABASE_DIR, "transactionRepository.js"));
      ({ close } = require(path.join(DATABASE_DIR, "db.js")));
    } finally {
      process.chdir(originalDirectory);
    }

    currentStep = "전체 거래 조회";
    const transactions = await repository.getAllTransactions();
    assert.equal(transactions.length, EXPECTED_TRANSACTION_COUNT);
    console.log(`PASS - DB 거래 ${transactions.length}건 조회`);

    currentStep = "cutoff와 학습 데이터 시간 분리";
    const cutoffTransaction = requiredTransaction(CUTOFF_TRANSACTION_ID, transactions);
    const cutoffTime = getTime(cutoffTransaction);
    assert.equal(Number.isFinite(cutoffTime), true);
    const trainingTransactions = transactions.filter((item) => getTime(item) < cutoffTime);
    assert.ok(trainingTransactions.length > 0);
    assert.equal(trainingTransactions.every((item) => getTime(item) < cutoffTime), true);
    assert.equal(trainingTransactions.some((item) => item.transaction_id === CUTOFF_TRANSACTION_ID), false);
    console.log(`PASS - cutoff ${CUTOFF_TRANSACTION_ID} (${cutoffTransaction.transaction_datetime})`);
    console.log(`PASS - cutoff 이전 학습 원천 거래 ${trainingTransactions.length}건`);

    currentStep = "학습 feature 1회 생성";
    const trainingResult = buildTrainingFeatures(trainingTransactions);
    const { trainingFeatures } = trainingResult;
    assert.ok(trainingFeatures.length > 0);
    assert.equal(trainingFeatures.length, trainingResult.usableFeatureCount);
    console.log(`PASS - 학습 feature ${trainingFeatures.length}건 (1회 생성)`);

    currentStep = "평가 입력과 과거 history 구성";
    const inputs = Object.fromEntries(ALL_IDS.map((id) => {
      const transaction = requiredTransaction(id, transactions);
      const transactionTime = getTime(transaction);
      assert.ok(transactionTime >= cutoffTime, `${id}가 cutoff 이전입니다.`);
      const history = historyBefore(transaction, transactions);
      assert.equal(history.every(
        (item) => item.user_id === transaction.user_id && getTime(item) < transactionTime,
      ), true);
      return [id, { transaction, history }];
    }));

    currentStep = "모델 학습과 동일 모델 reference score 생성";
    resetModel();
    assert.equal(isModelTrained(), false);
    const trainingStatus = trainModel(trainingFeatures);
    assert.equal(trainingStatus.trained, true);
    assert.equal(trainingStatus.trainingSampleCount, trainingFeatures.length);
    assert.equal(isModelTrained(), true);
    const referenceScores = trainingFeatures.map((feature) => {
      const prediction = predictAnomaly(feature);
      assert.equal(prediction.available, true);
      assert.equal(Number.isFinite(prediction.anomalyScore), true);
      return prediction.anomalyScore;
    });
    assert.equal(referenceScores.length, trainingFeatures.length);

    currentStep = "서비스 E2E 20건 평가";
    const mutationId = "T0281";
    const transactionSnapshot = JSON.stringify(inputs[mutationId].transaction);
    const historySnapshot = JSON.stringify(inputs[mutationId].history);
    const referenceSnapshot = JSON.stringify(referenceScores);
    const results = {};
    for (const id of ALL_IDS) {
      const { transaction, history } = inputs[id];
      const result = scoreTransactionWithAI(transaction, history, referenceScores);
      assert.deepEqual(Object.keys(result), EXPECTED_FIELDS, `${id} 반환 필드 불일치`);
      assert.equal(result.available, true, `${id}: ${result.unavailableReason}`);
      assert.equal(result.unavailableReason, null);
      assert.notEqual(result.features, null);
      assert.equal(Number.isFinite(result.rawScore), true);
      assert.equal(Number.isFinite(result.percentile), true);
      assert.ok(result.percentile >= 0 && result.percentile <= 100);
      assert.equal(Number.isInteger(result.calibratedAiScore), true);
      assert.ok(result.calibratedAiScore >= 0 && result.calibratedAiScore <= 100);
      for (const field of FORBIDDEN_FIELDS) assert.equal(Object.hasOwn(result, field), false);
      results[id] = result;
    }
    assert.equal(JSON.stringify(inputs[mutationId].transaction), transactionSnapshot);
    assert.equal(JSON.stringify(inputs[mutationId].history), historySnapshot);
    assert.equal(JSON.stringify(referenceScores), referenceSnapshot);
    console.log("PASS - 20건 모두 available 및 반환 계약/범위/금지 필드 검증");
    console.log("PASS - transaction/history/referenceScores 비변경 검증");

    currentStep = "직접 조합과 서비스 결과 일치";
    for (const id of COMPOSITION_IDS) {
      const { transaction, history } = inputs[id];
      const analysis = analyzeTransactionWithAI(transaction, history);
      assert.equal(analysis.available, true);
      const normalized = normalizeAiScore(analysis.anomalyScore, referenceScores);
      const calibrated = calibrateAiScore(normalized.percentile);
      assert.equal(results[id].rawScore, analysis.anomalyScore);
      assert.equal(results[id].percentile, normalized.percentile);
      assert.equal(results[id].calibratedAiScore, calibrated.calibratedAiScore);
    }
    console.log(`PASS - 직접 조합과 서비스 결과 일치: ${COMPOSITION_IDS.join(", ")}`);

    console.log("CONTROL");
    console.table(tableRows(CONTROL_IDS, inputs, results));
    console.log("TEST ANOMALY");
    console.table(tableRows(ANOMALY_IDS, inputs, results));
    for (const id of ["T0245", "T0281", "T0292", "T0299", "T0302"]) selectedDetail(id, results);

    for (const [label, ids] of Object.entries({
      "U002 반복 결제": ["T0257", "T0258", "T0259", "T0260", "T0261"],
      "U004 반복 결제": ["T0299", "T0300", "T0301", "T0302"],
    })) {
      console.log(label);
      console.table(tableRows(ids, inputs, results).map((row) => ({
        ...row,
        recent10MinCount: results[row.transaction_id].features.recent10MinCount,
      })));
    }

    currentStep = "그룹 통계";
    const groupStats = {
      CONTROL: statistics(CONTROL_IDS.map((id) => results[id].calibratedAiScore)),
      TEST_ANOMALY: statistics(ANOMALY_IDS.map((id) => results[id].calibratedAiScore)),
    };
    console.log("Calibrated AI score 그룹 통계");
    console.table(groupStats);
    console.log("PASS - Data Leakage 없음: 학습은 cutoff 이전, history는 동일 사용자 과거 거래만 사용");
    console.log("=== DB AI Scoring Service E2E Test PASS ===");
  } catch (error) {
    console.error(`FAIL - 단계: ${currentStep}`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    resetModel();
    try {
      assert.equal(isModelTrained(), false);
      console.log("PASS - finally에서 모델 untrained 상태 확인");
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
    if (typeof close === "function") {
      try {
        await close();
        console.log("PASS - DB pool 종료");
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
      }
    }
  }
}

run();
