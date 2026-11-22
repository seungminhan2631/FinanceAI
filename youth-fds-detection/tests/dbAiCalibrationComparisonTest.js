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
const CALIBRATION_CANDIDATES = {
  A_LINEAR_90: { startPercentile: 90, power: 1 },
  B_CURVE_90: { startPercentile: 90, power: 1.5 },
  C_LINEAR_95: { startPercentile: 95, power: 1 },
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

// 비교 테스트에서만 사용하는 임시 Calibration 함수입니다.
function calibratePercentile(percentile, startPercentile, power) {
  if (
    typeof percentile !== "number"
    || !Number.isFinite(percentile)
    || percentile < 0
    || percentile > 100
  ) {
    throw new TypeError("percentile은 0~100의 유효한 숫자여야 합니다.");
  }
  if (
    typeof startPercentile !== "number"
    || !Number.isFinite(startPercentile)
    || startPercentile < 0
    || startPercentile >= 100
  ) {
    throw new TypeError("startPercentile은 0 이상 100 미만이어야 합니다.");
  }
  if (typeof power !== "number" || !Number.isFinite(power) || power <= 0) {
    throw new TypeError("power는 0보다 큰 유효한 숫자여야 합니다.");
  }
  if (percentile <= startPercentile) return 0;
  const x = (percentile - startPercentile) / (100 - startPercentile);
  return Math.min(100, Math.max(0, Math.round(100 * Math.pow(x, power))));
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

function calculateDistribution(values) {
  const zeroCount = values.filter((value) => value === 0).length;
  const hundredCount = values.filter((value) => value === 100).length;
  const atLeast90Count = values.filter((value) => value >= 90).length;
  return {
    zeroCount,
    zeroRate: zeroCount / values.length,
    hundredCount,
    hundredRate: hundredCount / values.length,
    atLeast90Count,
    atLeast90Rate: atLeast90Count / values.length,
    uniqueScoreCount: new Set(values).size,
  };
}

function createComparisonTable(transactionIds, statisticsById) {
  return transactionIds.map((transactionId) => {
    const statistics = statisticsById[transactionId];
    const row = {
      transaction_id: transactionId,
      percentile_mean: statistics.percentile.mean,
    };
    for (const [candidateName, shortName] of [
      ["A_LINEAR_90", "A"],
      ["B_CURVE_90", "B"],
      ["C_LINEAR_95", "C"],
    ]) {
      const candidate = statistics[candidateName];
      row[`${shortName}_mean`] = candidate.mean;
      row[`${shortName}_min`] = candidate.min;
      row[`${shortName}_max`] = candidate.max;
      row[`${shortName}_std`] = candidate.standardDeviation;
    }
    return row;
  });
}

function printTransactionDetail(transactionId, featuresById, statisticsById) {
  console.log(`INFO - ${transactionId} detail`);
  console.log({
    features: featuresById[transactionId],
    percentile: statisticsById[transactionId].percentile,
    A_LINEAR_90: statisticsById[transactionId].A_LINEAR_90,
    B_CURVE_90: statisticsById[transactionId].B_CURVE_90,
    C_LINEAR_95: statisticsById[transactionId].C_LINEAR_95,
  });
}

function reportFailure(error) {
  console.error("========================================");
  console.error("DB AI Calibration 후보 비교 테스트 실패");
  console.error("========================================");
  console.error(`실패 단계: ${currentStep}`);
  if (error.expected !== undefined) console.error("예상:", error.expected);
  if (error.actual !== undefined) console.error("실제:", error.actual);
  console.error(`오류 메시지: ${error.message}`);
  console.error(
    "추정 원인: DB 데이터, 시간 분리, 모델별 기준 분포 또는 Calibration 결과가 검증 조건과 다릅니다.",
  );
}

async function run() {
  try {
    console.log("========================================");
    console.log("DB AI Calibration 후보 30회 비교 테스트");
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
        {
          percentiles: [],
          A_LINEAR_90: [],
          B_CURVE_90: [],
          C_LINEAR_95: [],
        },
      ]),
    );
    const featuresById = {};

    currentStep = "30회 모델별 Calibration 후보 비교";
    for (let runNumber = 1; runNumber <= RUN_COUNT; runNumber += 1) {
      resetModel();
      assert.equal(isModelTrained(), false);
      const trainingStatus = trainModel(trainingFeatures);
      assert.equal(trainingStatus.trained, true);
      assert.equal(trainingStatus.trainingSampleCount, trainingFeatures.length);
      assert.equal(isModelTrained(), true);

      const referenceScores = trainingFeatures.map(
        (feature) => predictAnomaly(feature).anomalyScore,
      );
      assert.equal(referenceScores.length, trainingFeatures.length);
      assert.equal(referenceScores.every(Number.isFinite), true);

      for (const transactionId of allEvaluationIds) {
        const { transaction, history } = evaluationInputs[transactionId];
        const analysis = analyzeTransactionWithAI(transaction, history);
        assert.equal(analysis.available, true, analysis.unavailableReason);
        assert.equal(Number.isFinite(analysis.anomalyScore), true);
        const { percentile } = normalizeAiScore(
          analysis.anomalyScore,
          referenceScores,
        );
        assert.ok(Number.isFinite(percentile) && percentile >= 0 && percentile <= 100);
        resultsByTransaction[transactionId].percentiles.push(percentile);

        for (const [candidateName, parameters] of Object.entries(
          CALIBRATION_CANDIDATES,
        )) {
          const score = calibratePercentile(
            percentile,
            parameters.startPercentile,
            parameters.power,
          );
          assert.equal(Number.isInteger(score), true);
          assert.ok(score >= 0 && score <= 100);
          resultsByTransaction[transactionId][candidateName].push(score);
        }
        featuresById[transactionId] ||= analysis.features;
      }
      console.log(`PASS - Run ${runNumber}/${RUN_COUNT}`);
    }

    currentStep = "거래별 후보 통계 계산";
    const statisticsById = Object.fromEntries(
      allEvaluationIds.map((transactionId) => {
        const results = resultsByTransaction[transactionId];
        for (const values of Object.values(results)) {
          assert.equal(values.length, RUN_COUNT);
        }
        return [
          transactionId,
          Object.fromEntries(
            Object.entries(results).map(([name, values]) => [
              name === "percentiles" ? "percentile" : name,
              calculateStatistics(values),
            ]),
          ),
        ];
      }),
    );

    console.log("CONTROL Calibration comparison");
    console.table(createComparisonTable(CONTROL_TRANSACTION_IDS, statisticsById));
    console.log("TEST ANOMALY Calibration comparison");
    console.table(
      createComparisonTable(TEST_ANOMALY_TRANSACTION_IDS, statisticsById),
    );

    currentStep = "후보별 그룹 분포 통계 계산";
    const candidateSummaries = [];
    for (const candidateName of Object.keys(CALIBRATION_CANDIDATES)) {
      const controlScores = CONTROL_TRANSACTION_IDS.flatMap(
        (transactionId) => resultsByTransaction[transactionId][candidateName],
      );
      const anomalyScores = TEST_ANOMALY_TRANSACTION_IDS.flatMap(
        (transactionId) => resultsByTransaction[transactionId][candidateName],
      );
      const controlStatistics = calculateStatistics(controlScores);
      const anomalyStatistics = calculateStatistics(anomalyScores);
      const controlDistribution = calculateDistribution(controlScores);
      const anomalyDistribution = calculateDistribution(anomalyScores);
      console.log(`INFO - ${candidateName}`);
      console.log({
        CONTROL: { ...controlStatistics, ...controlDistribution },
        TEST_ANOMALY: { ...anomalyStatistics, ...anomalyDistribution },
      });
      candidateSummaries.push({
        candidate: candidateName,
        control_mean: controlStatistics.mean,
        control_max: controlStatistics.max,
        control_zero_rate: controlDistribution.zeroRate,
        control_100_rate: controlDistribution.hundredRate,
        anomaly_mean: anomalyStatistics.mean,
        anomaly_min: anomalyStatistics.min,
        anomaly_zero_rate: anomalyDistribution.zeroRate,
        anomaly_100_rate: anomalyDistribution.hundredRate,
        anomaly_ge90_rate: anomalyDistribution.atLeast90Rate,
        control_unique_scores: controlDistribution.uniqueScoreCount,
        anomaly_unique_scores: anomalyDistribution.uniqueScoreCount,
      });
    }
    console.log("INFO - Candidate comparison summary");
    console.table(candidateSummaries);

    currentStep = "주요 거래와 반복결제 상세 출력";
    for (const transactionId of ["T0245", "T0281", "T0292", "T0299"]) {
      printTransactionDetail(transactionId, featuresById, statisticsById);
    }
    for (const [groupName, transactionIds] of Object.entries(
      RAPID_PAYMENT_GROUPS,
    )) {
      console.log(`INFO - ${groupName}`);
      console.table(
        transactionIds.map((transactionId) => ({
          transaction_id: transactionId,
          recent10MinCount: featuresById[transactionId].recent10MinCount,
          percentile_mean: statisticsById[transactionId].percentile.mean,
          A_mean: statisticsById[transactionId].A_LINEAR_90.mean,
          B_mean: statisticsById[transactionId].B_CURVE_90.mean,
          C_mean: statisticsById[transactionId].C_LINEAR_95.mean,
        })),
      );
    }

    const allResults = Object.values(resultsByTransaction);
    assert.equal(
      allResults
        .flatMap((result) => result.percentiles)
        .every((value) => Number.isFinite(value) && value >= 0 && value <= 100),
      true,
    );
    assert.equal(
      allResults
        .flatMap((result) =>
          Object.keys(CALIBRATION_CANDIDATES).flatMap(
            (candidateName) => result[candidateName],
          ),
        )
        .every(
          (score) => Number.isInteger(score) && score >= 0 && score <= 100,
        ),
      true,
    );
    console.log("PASS - 모든 percentile 및 Calibration score 검증");
    console.log("PASS - 동일 run 모델의 rawScore와 referenceScores 사용");
    console.log("PASS - Data Leakage 없음");
    console.log("INFO - 후보 자동 선택 없음");
    console.log("========================================");
    console.log("DB AI Calibration 후보 비교 테스트 성공");
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
