const assert = require("node:assert/strict");
const path = require("node:path");

const DATABASE_DIR = "C:\\Users\\dtdt7\\FinanceAI\\database";
const EXPECTED_TRANSACTION_COUNT = 312;
const CUTOFF_TRANSACTION_ID = "T0238";
const CONTROL_TRANSACTION_IDS = ["T0242", "T0243", "T0244", "T0245"];
const TEST_ANOMALY_TRANSACTION_IDS = [
  "T0238",
  "T0257",
  "T0258",
  "T0259",
  "T0260",
  "T0261",
  "T0269",
  "T0270",
  "T0271",
  "T0272",
  "T0281",
  "T0292",
  "T0299",
  "T0300",
  "T0301",
  "T0302",
];

const {
  buildTrainingFeatures,
} = require("../src/ai/trainingDataBuilder");
const {
  trainModel,
  isModelTrained,
  resetModel,
} = require("../src/ai/aiModel");
const {
  analyzeTransactionWithAI,
} = require("../src/ai/aiService");

let close;
let currentStep = "모듈 연결";

function getTransactionTime(transaction) {
  return new Date(transaction.transaction_datetime).getTime();
}

function getHistoryBefore(target, transactions) {
  const targetTime = getTransactionTime(target);

  return transactions.filter(
    (transaction) =>
      transaction.user_id === target.user_id
      && getTransactionTime(transaction) < targetTime,
  );
}

function getRequiredTransaction(transactionId, transactions) {
  const transaction = transactions.find(
    (candidate) => candidate.transaction_id === transactionId,
  );
  assert.ok(transaction, `${transactionId} 거래가 DB에 없습니다.`);
  return transaction;
}

function calculateAverage(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function printEvaluation(label, transaction, result) {
  console.log("----------------------------------------");
  console.log(label);
  console.log(transaction.transaction_id);
  console.log(`user: ${transaction.user_id}`);
  console.log(`amount: ${transaction.amount}`);
  console.log(`merchant_category: ${transaction.merchant_category}`);
  console.log(`transaction_datetime: ${transaction.transaction_datetime}`);
  console.log("Features:");
  console.log(result.features);
  console.log(`Raw anomaly score: ${result.anomalyScore}`);
  console.log("----------------------------------------");
}

function analyzeTransactions(label, transactionIds, transactions, cutoffTime) {
  return transactionIds.map((transactionId) => {
    const transaction = getRequiredTransaction(transactionId, transactions);
    const transactionTime = getTransactionTime(transaction);
    assert.ok(
      transactionTime >= cutoffTime,
      `${transactionId}가 학습 cutoff 이전에 있습니다.`,
    );

    const history = getHistoryBefore(transaction, transactions);
    assert.ok(
      history.every(
        (historyTransaction) =>
          historyTransaction.user_id === transaction.user_id
          && getTransactionTime(historyTransaction) < transactionTime,
      ),
      `${transactionId} history에 다른 사용자 또는 미래 거래가 포함됐습니다.`,
    );

    const result = analyzeTransactionWithAI(transaction, history);
    assert.equal(result.available, true, result.unavailableReason);
    assert.notEqual(result.features, null);
    assert.equal(typeof result.anomalyScore, "number");
    assert.equal(Number.isFinite(result.anomalyScore), true);
    printEvaluation(label, transaction, result);

    return {
      transactionId,
      anomalyScore: result.anomalyScore,
      features: result.features,
    };
  });
}

function reportFailure(error) {
  console.error("========================================");
  console.error("DB → Isolation Forest 실제 학습 테스트 실패");
  console.error("========================================");
  console.error(`실패 단계: ${currentStep}`);
  if (error.expected !== undefined) {
    console.error("예상:", error.expected);
  }
  if (error.actual !== undefined) {
    console.error("실제:", error.actual);
  }
  console.error(`오류 메시지: ${error.message}`);
  console.error(
    "추정 원인: DB 데이터, 시간 분리 조건 또는 AI 모듈 반환값이 검증 조건과 다릅니다.",
  );
}

async function run() {
  try {
    console.log("========================================");
    console.log("DB → Isolation Forest 실제 학습 테스트");
    console.log("========================================");

    currentStep = "DB repository 연결";
    const originalWorkingDirectory = process.cwd();
    let repo;
    try {
      process.chdir(DATABASE_DIR);
      repo = require(path.join(DATABASE_DIR, "transactionRepository.js"));
      ({ close } = require(path.join(DATABASE_DIR, "db.js")));
    } finally {
      process.chdir(originalWorkingDirectory);
    }
    assert.equal(typeof repo.getAllTransactions, "function");
    assert.equal(typeof close, "function");
    console.log("PASS - DB repository 연결");

    currentStep = "실제 DB 전체 거래 조회";
    const transactions = await repo.getAllTransactions();
    assert.equal(Array.isArray(transactions), true);
    assert.equal(transactions.length, EXPECTED_TRANSACTION_COUNT);
    console.log(`INFO - DB transactions: ${transactions.length}`);

    currentStep = "학습/평가 cutoff 설정";
    const cutoffTransaction = getRequiredTransaction(
      CUTOFF_TRANSACTION_ID,
      transactions,
    );
    const cutoffTime = getTransactionTime(cutoffTransaction);
    assert.equal(Number.isFinite(cutoffTime), true);
    console.log(`INFO - Cutoff transaction: ${cutoffTransaction.transaction_id}`);
    console.log(`INFO - Cutoff datetime: ${cutoffTransaction.transaction_datetime}`);

    currentStep = "학습 원본 거래 시간 분리";
    const trainingTransactions = transactions.filter(
      (transaction) => getTransactionTime(transaction) < cutoffTime,
    );
    assert.ok(trainingTransactions.length > 0);
    assert.equal(
      trainingTransactions.some(
        (transaction) => transaction.transaction_id === CUTOFF_TRANSACTION_ID,
      ),
      false,
    );
    assert.equal(
      trainingTransactions.every(
        (transaction) => getTransactionTime(transaction) < cutoffTime,
      ),
      true,
    );
    console.log(`INFO - Training raw transactions: ${trainingTransactions.length}`);

    currentStep = "실제 DB 학습 Feature 생성";
    const trainingResult = buildTrainingFeatures(trainingTransactions);
    assert.ok(trainingResult.trainingFeatures.length > 0);
    assert.ok(trainingResult.usableFeatureCount > 0);
    assert.equal(
      trainingResult.trainingFeatures.length,
      trainingResult.usableFeatureCount,
    );
    assert.equal(
      trainingResult.usableFeatureCount + trainingResult.skippedFeatureCount,
      trainingResult.totalTransactions,
    );
    console.log(
      `INFO - Training usable features: ${trainingResult.usableFeatureCount}`,
    );
    console.log(`INFO - Training skipped: ${trainingResult.skippedFeatureCount}`);
    console.log("INFO - Training skipped reasons:");
    console.log(trainingResult.skippedReasons);

    currentStep = "Isolation Forest 실제 DB 학습";
    resetModel();
    assert.equal(isModelTrained(), false);
    const trainingStatus = trainModel(trainingResult.trainingFeatures);
    assert.equal(trainingStatus.trained, true);
    assert.equal(
      trainingStatus.trainingSampleCount,
      trainingResult.trainingFeatures.length,
    );
    assert.equal(isModelTrained(), true);
    console.log("PASS - Isolation Forest 실제 DB 학습");
    console.log(`INFO - Training samples: ${trainingStatus.trainingSampleCount}`);

    currentStep = "CONTROL 거래 AI 분석";
    const controlResults = analyzeTransactions(
      "CONTROL",
      CONTROL_TRANSACTION_IDS,
      transactions,
      cutoffTime,
    );

    currentStep = "테스트용 이상 거래 AI 분석";
    const anomalyResults = analyzeTransactions(
      "TEST ANOMALY",
      TEST_ANOMALY_TRANSACTION_IDS,
      transactions,
      cutoffTime,
    );

    currentStep = "평가 score 요약";
    const controlScores = controlResults.map((result) => result.anomalyScore);
    const anomalyScores = anomalyResults.map((result) => result.anomalyScore);
    const evaluationScores = [...controlScores, ...anomalyScores];
    const controlAverage = calculateAverage(controlScores);
    const anomalyAverage = calculateAverage(anomalyScores);
    const evaluationMinimum = Math.min(...evaluationScores);
    const evaluationMaximum = Math.max(...evaluationScores);
    const evaluationAverage = calculateAverage(evaluationScores);
    console.log(`INFO - Control average raw score: ${controlAverage}`);
    console.log(`INFO - Test anomaly average raw score: ${anomalyAverage}`);
    console.log(`INFO - Evaluation score min: ${evaluationMinimum}`);
    console.log(`INFO - Evaluation score max: ${evaluationMaximum}`);
    console.log(`INFO - Evaluation score avg: ${evaluationAverage}`);
    assert.equal(isModelTrained(), true);

    console.log("========================================");
    console.log("DB → Isolation Forest 실제 학습 및 평가 성공");
    console.log("========================================");
  } catch (error) {
    reportFailure(error);
    process.exitCode = 1;
  } finally {
    resetModel();
    try {
      assert.equal(isModelTrained(), false);
      console.log("PASS - resetModel 후 모델 untrained 상태");
    } catch (error) {
      console.error(`모델 초기화 확인 실패: ${error.message}`);
      process.exitCode = 1;
    }

    if (typeof close === "function") {
      try {
        await close();
      } catch (error) {
        console.error(`DB 종료 실패: ${error.message}`);
        process.exitCode = 1;
      }
    }
  }
}

run();
