const assert = require("node:assert/strict");
const path = require("node:path");

const DATABASE_DIR = "C:\\Users\\dtdt7\\FinanceAI\\database";
const EXPECTED_TRANSACTION_COUNT = 312;
const CUTOFF_TRANSACTION_ID = "T0238";
const RUN_COUNT = 30;
const CONTROL_TRANSACTION_IDS = ["T0242", "T0243", "T0244", "T0245"];
const TEST_ANOMALY_TRANSACTION_IDS = [
  "T0238", "T0257", "T0258", "T0259", "T0260", "T0261",
  "T0269", "T0270", "T0271", "T0272", "T0281", "T0292",
  "T0299", "T0300", "T0301", "T0302",
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
  predictAnomaly,
  isModelTrained,
  resetModel,
} = require("../src/ai/aiModel");
const {
  analyzeTransactionWithAI,
} = require("../src/ai/aiService");
const {
  normalizeAiScore,
} = require("../src/ai/aiScoreNormalizer");

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
  assert.ok(values.length > 0, "통계를 계산할 값이 없습니다.");
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

function createResultTable(transactionIds, statisticsById) {
  return transactionIds.map((transactionId) => ({
    transaction_id: transactionId,
    raw_mean: statisticsById[transactionId].raw.mean,
    raw_min: statisticsById[transactionId].raw.min,
    raw_max: statisticsById[transactionId].raw.max,
    raw_std: statisticsById[transactionId].raw.standardDeviation,
    ai_mean: statisticsById[transactionId].ai.mean,
    ai_min: statisticsById[transactionId].ai.min,
    ai_max: statisticsById[transactionId].ai.max,
    ai_std: statisticsById[transactionId].ai.standardDeviation,
  }));
}

function createPercentileTable(transactionIds, statisticsById) {
  return transactionIds.map((transactionId) => ({
    transaction_id: transactionId,
    mean: statisticsById[transactionId].percentile.mean,
    min: statisticsById[transactionId].percentile.min,
    max: statisticsById[transactionId].percentile.max,
    std_dev: statisticsById[transactionId].percentile.standardDeviation,
  }));
}

function reportFailure(error) {
  console.error("========================================");
  console.error("DB AI Score 정규화 테스트 실패");
  console.error("========================================");
  console.error(`실패 단계: ${currentStep}`);
  if (error.expected !== undefined) console.error("예상:", error.expected);
  if (error.actual !== undefined) console.error("실제:", error.actual);
  console.error(`오류 메시지: ${error.message}`);
  console.error(
    "추정 원인: DB 데이터, 시간 분리, 모델별 기준 분포 또는 정규화 결과가 검증 조건과 다릅니다.",
  );
}

async function run() {
  try {
    console.log("========================================");
    console.log("DB AI Score 30회 정규화 테스트");
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
    const trainingFeatures = trainingResult.trainingFeatures;
    assert.ok(trainingFeatures.length > 0);
    assert.equal(trainingFeatures.length, trainingResult.usableFeatureCount);
    console.log(`INFO - Training features: ${trainingFeatures.length}`);

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
    const resultsByTransaction = Object.fromEntries(
      allEvaluationIds.map((transactionId) => [
        transactionId,
        { rawScores: [], percentiles: [], aiScores: [] },
      ]),
    );
    const featuresById = {};
    const referenceRunStatistics = [];
    const allReferenceScores = [];

    currentStep = "30회 모델별 referenceScores 생성 및 AI Score 변환";
    for (let runNumber = 1; runNumber <= RUN_COUNT; runNumber += 1) {
      resetModel();
      assert.equal(isModelTrained(), false);
      const trainingStatus = trainModel(trainingFeatures);
      assert.equal(trainingStatus.trained, true);
      assert.equal(trainingStatus.trainingSampleCount, trainingFeatures.length);
      assert.equal(isModelTrained(), true);

      // 현재 run의 모델로 기준 Feature 전체의 raw score를 생성합니다.
      const referenceScores = trainingFeatures.map(
        (feature) => predictAnomaly(feature).anomalyScore,
      );
      assert.equal(referenceScores.length, trainingFeatures.length);
      assert.equal(referenceScores.every(Number.isFinite), true);
      referenceRunStatistics.push(calculateStatistics(referenceScores));
      allReferenceScores.push(...referenceScores);

      // 모델을 유지한 채 같은 run의 referenceScores로 평가 score를 변환합니다.
      for (const transactionId of allEvaluationIds) {
        const { transaction, history } = evaluationInputs[transactionId];
        const analysis = analyzeTransactionWithAI(transaction, history);
        assert.equal(analysis.available, true, analysis.unavailableReason);
        assert.notEqual(analysis.features, null);
        assert.equal(Number.isFinite(analysis.anomalyScore), true);
        const normalized = normalizeAiScore(
          analysis.anomalyScore,
          referenceScores,
        );
        assert.equal(Number.isFinite(normalized.percentile), true);
        assert.ok(normalized.percentile >= 0 && normalized.percentile <= 100);
        assert.equal(Number.isInteger(normalized.aiScore), true);
        assert.ok(normalized.aiScore >= 0 && normalized.aiScore <= 100);
        resultsByTransaction[transactionId].rawScores.push(normalized.rawScore);
        resultsByTransaction[transactionId].percentiles.push(
          normalized.percentile,
        );
        resultsByTransaction[transactionId].aiScores.push(normalized.aiScore);
        featuresById[transactionId] ||= analysis.features;
      }
      console.log(`PASS - Run ${runNumber}/${RUN_COUNT}`);
    }

    currentStep = "거래별 raw/percentile/AI Score 통계 계산";
    const statisticsById = Object.fromEntries(
      allEvaluationIds.map((transactionId) => {
        const result = resultsByTransaction[transactionId];
        assert.equal(result.rawScores.length, RUN_COUNT);
        assert.equal(result.percentiles.length, RUN_COUNT);
        assert.equal(result.aiScores.length, RUN_COUNT);
        return [
          transactionId,
          {
            raw: calculateStatistics(result.rawScores),
            percentile: calculateStatistics(result.percentiles),
            ai: calculateStatistics(result.aiScores),
          },
        ];
      }),
    );

    console.log("CONTROL raw score / AI Score");
    console.table(createResultTable(CONTROL_TRANSACTION_IDS, statisticsById));
    console.log("CONTROL percentile");
    console.table(createPercentileTable(CONTROL_TRANSACTION_IDS, statisticsById));
    console.log("TEST ANOMALY raw score / AI Score");
    console.table(
      createResultTable(TEST_ANOMALY_TRANSACTION_IDS, statisticsById),
    );
    console.log("TEST ANOMALY percentile");
    console.table(
      createPercentileTable(TEST_ANOMALY_TRANSACTION_IDS, statisticsById),
    );

    currentStep = "그룹 AI Score와 reference 분포 통계 계산";
    const controlAiScores = CONTROL_TRANSACTION_IDS.flatMap(
      (transactionId) => resultsByTransaction[transactionId].aiScores,
    );
    const anomalyAiScores = TEST_ANOMALY_TRANSACTION_IDS.flatMap(
      (transactionId) => resultsByTransaction[transactionId].aiScores,
    );
    const controlAiStatistics = calculateStatistics(controlAiScores);
    const anomalyAiStatistics = calculateStatistics(anomalyAiScores);
    const referenceSummary = {
      allScores: calculateStatistics(allReferenceScores),
      runMeans: calculateStatistics(
        referenceRunStatistics.map((statistics) => statistics.mean),
      ),
      runMinimums: calculateStatistics(
        referenceRunStatistics.map((statistics) => statistics.min),
      ),
      runMaximums: calculateStatistics(
        referenceRunStatistics.map((statistics) => statistics.max),
      ),
    };
    console.log("INFO - Reference score distribution across 30 runs");
    console.log(referenceSummary);
    console.log("INFO - CONTROL AI Score group");
    console.log(controlAiStatistics);
    console.log("INFO - TEST ANOMALY AI Score group");
    console.log(anomalyAiStatistics);
    console.log(`INFO - CONTROL maximum AI Score: ${controlAiStatistics.max}`);
    console.log(
      `INFO - TEST ANOMALY minimum AI Score: ${anomalyAiStatistics.min}`,
    );
    console.log(
      anomalyAiStatistics.min < controlAiStatistics.max
        ? "INFO - AI Score ranges overlap"
        : "INFO - AI Score ranges do not overlap",
    );

    currentStep = "주요 평가 거래 상세 출력";
    console.log("INFO - T0281 high amount detail");
    console.log({
      amountRatio: featuresById.T0281.amountRatio,
      amountZScore: featuresById.T0281.amountZScore,
      dailySpendRatio: featuresById.T0281.dailySpendRatio,
      rawScore: statisticsById.T0281.raw,
      percentile: statisticsById.T0281.percentile,
      aiScore: statisticsById.T0281.ai,
    });
    console.log("INFO - T0292 night and new category detail");
    console.log({
      timeSlotFrequency: featuresById.T0292.timeSlotFrequency,
      categoryFrequency: featuresById.T0292.categoryFrequency,
      amountRatio: featuresById.T0292.amountRatio,
      rawScore: statisticsById.T0292.raw,
      percentile: statisticsById.T0292.percentile,
      aiScore: statisticsById.T0292.ai,
    });
    for (const [groupName, transactionIds] of Object.entries(
      RAPID_PAYMENT_GROUPS,
    )) {
      console.log(`INFO - ${groupName}`);
      console.table(
        transactionIds.map((transactionId) => ({
          transaction_id: transactionId,
          recent10MinCount: featuresById[transactionId].recent10MinCount,
          raw_mean: statisticsById[transactionId].raw.mean,
          ai_mean: statisticsById[transactionId].ai.mean,
        })),
      );
    }

    const allResults = Object.values(resultsByTransaction);
    assert.equal(
      allResults.flatMap((result) => result.rawScores).every(Number.isFinite),
      true,
    );
    assert.equal(
      allResults
        .flatMap((result) => result.percentiles)
        .every((value) => Number.isFinite(value) && value >= 0 && value <= 100),
      true,
    );
    assert.equal(
      allResults
        .flatMap((result) => result.aiScores)
        .every(
          (value) => Number.isInteger(value) && value >= 0 && value <= 100,
        ),
      true,
    );
    console.log("PASS - 모든 raw score, percentile, AI Score 검증");
    console.log("PASS - 동일 run 모델의 rawScore와 referenceScores 사용");
    console.log("PASS - Data Leakage 없음");
    console.log("========================================");
    console.log("DB AI Score 30회 정규화 테스트 성공");
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
