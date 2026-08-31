const assert = require("node:assert/strict");
const path = require("node:path");

const DATABASE_DIR = "C:\\Users\\dtdt7\\FinanceAI\\database";
const EXPECTED_TRANSACTION_COUNT = 312;
const CUTOFF_TRANSACTION_ID = "T0238";
const RUN_COUNT = 30;
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
const RAPID_PAYMENT_GROUPS = {
  "U002 반복결제": ["T0257", "T0258", "T0259", "T0260", "T0261"],
  "U004 반복결제": ["T0299", "T0300", "T0301", "T0302"],
};

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

function calculateStatistics(values) {
  assert.ok(values.length > 0, "통계를 계산할 score가 없습니다.");
  assert.equal(values.every(Number.isFinite), true);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  ) / values.length;
  return {
    count: values.length,
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    standardDeviation: Math.sqrt(variance),
  };
}

function createTableRows(transactionIds, statisticsById) {
  return transactionIds.map((transactionId) => ({
    transaction_id: transactionId,
    count: statisticsById[transactionId].count,
    mean: statisticsById[transactionId].mean,
    min: statisticsById[transactionId].min,
    max: statisticsById[transactionId].max,
    std_dev: statisticsById[transactionId].standardDeviation,
  }));
}

function reportFailure(error) {
  console.error("========================================");
  console.error("DB AI score 분포 테스트 실패");
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
    "추정 원인: DB 데이터, 시간 분리, 반복 학습 또는 score 수집 결과가 검증 조건과 다릅니다.",
  );
}

async function run() {
  try {
    console.log("========================================");
    console.log("DB AI raw score 30회 분포 테스트");
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
      trainingTransactions.every(
        (transaction) => getTransactionTime(transaction) < cutoffTime,
      ),
      true,
    );
    assert.equal(
      trainingTransactions.some(
        (transaction) => transaction.transaction_id === CUTOFF_TRANSACTION_ID,
      ),
      false,
    );
    console.log(`INFO - Training raw transactions: ${trainingTransactions.length}`);

    currentStep = "실제 DB 학습 Feature 생성";
    const trainingResult = buildTrainingFeatures(trainingTransactions);
    assert.ok(trainingResult.trainingFeatures.length > 0);
    assert.equal(
      trainingResult.trainingFeatures.length,
      trainingResult.usableFeatureCount,
    );
    console.log(`INFO - Training features: ${trainingResult.usableFeatureCount}`);

    currentStep = "평가 거래와 history 준비";
    const allEvaluationIds = [
      ...CONTROL_TRANSACTION_IDS,
      ...TEST_ANOMALY_TRANSACTION_IDS,
    ];
    const evaluationInputs = Object.fromEntries(
      allEvaluationIds.map((transactionId) => {
        const transaction = getRequiredTransaction(transactionId, transactions);
        const transactionTime = getTransactionTime(transaction);
        assert.ok(transactionTime >= cutoffTime);
        const history = getHistoryBefore(transaction, transactions);
        assert.equal(
          history.every(
            (historyTransaction) =>
              historyTransaction.user_id === transaction.user_id
              && getTransactionTime(historyTransaction) < transactionTime,
          ),
          true,
        );
        return [transactionId, { transaction, history }];
      }),
    );
    const scoreHistory = Object.fromEntries(
      allEvaluationIds.map((transactionId) => [transactionId, []]),
    );
    const featuresById = {};

    currentStep = "Isolation Forest 30회 재학습 및 평가";
    for (let runNumber = 1; runNumber <= RUN_COUNT; runNumber += 1) {
      resetModel();
      assert.equal(isModelTrained(), false);
      const trainingStatus = trainModel(trainingResult.trainingFeatures);
      assert.equal(trainingStatus.trained, true);
      assert.equal(
        trainingStatus.trainingSampleCount,
        trainingResult.trainingFeatures.length,
      );
      assert.equal(isModelTrained(), true);

      for (const transactionId of allEvaluationIds) {
        const { transaction, history } = evaluationInputs[transactionId];
        const result = analyzeTransactionWithAI(transaction, history);
        assert.equal(result.available, true, result.unavailableReason);
        assert.notEqual(result.features, null);
        assert.equal(Number.isFinite(result.anomalyScore), true);
        scoreHistory[transactionId].push(result.anomalyScore);
        featuresById[transactionId] ||= result.features;
      }
      console.log(`PASS - Run ${runNumber}/${RUN_COUNT}`);
    }

    currentStep = "거래별 score 통계 계산";
    const statisticsById = Object.fromEntries(
      allEvaluationIds.map((transactionId) => {
        assert.equal(scoreHistory[transactionId].length, RUN_COUNT);
        return [transactionId, calculateStatistics(scoreHistory[transactionId])];
      }),
    );

    console.log("CONTROL");
    console.table(createTableRows(CONTROL_TRANSACTION_IDS, statisticsById));
    console.log("TEST ANOMALY");
    console.table(createTableRows(TEST_ANOMALY_TRANSACTION_IDS, statisticsById));

    currentStep = "그룹 score 통계 계산";
    const controlScores = CONTROL_TRANSACTION_IDS.flatMap(
      (transactionId) => scoreHistory[transactionId],
    );
    const anomalyScores = TEST_ANOMALY_TRANSACTION_IDS.flatMap(
      (transactionId) => scoreHistory[transactionId],
    );
    const controlStatistics = calculateStatistics(controlScores);
    const anomalyStatistics = calculateStatistics(anomalyScores);
    console.log("INFO - CONTROL group");
    console.log(controlStatistics);
    console.log("INFO - TEST ANOMALY group");
    console.log(anomalyStatistics);
    console.log(
      `INFO - CONTROL maximum observed score: ${controlStatistics.max}`,
    );
    console.log(
      `INFO - TEST ANOMALY minimum observed score: ${anomalyStatistics.min}`,
    );
    const rangesOverlap = anomalyStatistics.min < controlStatistics.max;
    console.log(
      rangesOverlap
        ? "INFO - Score ranges overlap"
        : "INFO - Score ranges do not overlap",
    );

    currentStep = "반복 거래와 주요 거래 요약";
    for (const [groupName, transactionIds] of Object.entries(
      RAPID_PAYMENT_GROUPS,
    )) {
      console.log(`INFO - ${groupName}`);
      console.table(
        transactionIds.map((transactionId) => ({
          transaction_id: transactionId,
          recent10MinCount: featuresById[transactionId].recent10MinCount,
          mean: statisticsById[transactionId].mean,
        })),
      );
    }
    console.log("INFO - T0281 high amount");
    console.log({
      amountRatio: featuresById.T0281.amountRatio,
      amountZScore: featuresById.T0281.amountZScore,
      dailySpendRatio: featuresById.T0281.dailySpendRatio,
      ...statisticsById.T0281,
    });
    console.log("INFO - T0292 night and new category");
    console.log({
      timeSlotFrequency: featuresById.T0292.timeSlotFrequency,
      categoryFrequency: featuresById.T0292.categoryFrequency,
      amountRatio: featuresById.T0292.amountRatio,
      ...statisticsById.T0292,
    });

    assert.equal(
      Object.values(scoreHistory).flat().every(Number.isFinite),
      true,
    );
    console.log("PASS - 모든 평가 거래에서 finite score 30개 수집");
    console.log("PASS - Data Leakage 없음");
    console.log("========================================");
    console.log("DB AI raw score 분포 테스트 성공");
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
