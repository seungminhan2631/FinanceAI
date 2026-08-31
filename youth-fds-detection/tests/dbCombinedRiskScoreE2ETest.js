const assert = require("node:assert/strict");
const path = require("node:path");

const DATABASE_DIR = "C:\\Users\\dtdt7\\FinanceAI\\database";
const EXPECTED_TRANSACTION_COUNT = 312;
const CUTOFF_TRANSACTION_ID = "T0238";
const RUN_COUNT = 30;
const CONTROL_IDS = ["T0242", "T0243", "T0244", "T0245"];
const ANOMALY_IDS = [
  "T0238", "T0257", "T0258", "T0259", "T0260", "T0261",
  "T0269", "T0270", "T0271", "T0272", "T0281", "T0292",
  "T0299", "T0300", "T0301", "T0302",
];
const ALL_IDS = [...CONTROL_IDS, ...ANOMALY_IDS];
const DIRECT_CHECK_IDS = ["T0242", "T0281", "T0292", "T0302"];

const { runDetection } = require("../src/services/detectionService");
const { combineRiskScore } = require("../src/services/riskScoreCombiner");
const { buildTrainingFeatures } = require("../src/ai/trainingDataBuilder");
const {
  trainModel, predictAnomaly, isModelTrained, resetModel,
} = require("../src/ai/aiModel");
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

function getHistoryBefore(transaction, transactions) {
  const currentTime = getTime(transaction);
  return transactions.filter(
    (item) => item.user_id === transaction.user_id && getTime(item) < currentTime,
  );
}

function statistics(values) {
  assert.ok(values.length > 0);
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

function scoreRangeDistribution(values) {
  return {
    "0-19": values.filter((score) => score >= 0 && score <= 19).length,
    "20-39": values.filter((score) => score >= 20 && score <= 39).length,
    "40-59": values.filter((score) => score >= 40 && score <= 59).length,
    "60-79": values.filter((score) => score >= 60 && score <= 79).length,
    "80-100": values.filter((score) => score >= 80 && score <= 100).length,
  };
}

function saturation(values) {
  const zeroCount = values.filter((score) => score === 0).length;
  const hundredCount = values.filter((score) => score === 100).length;
  const atLeast90Count = values.filter((score) => score >= 90).length;
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

function rulesText(detectedRules) {
  return detectedRules.join(", ") || "NONE";
}

function summaryRow(id, summaries, ruleResults) {
  return {
    transaction_id: id,
    ruleScore: summaries[id].ruleScore,
    detectedRules: rulesText(ruleResults[id].detectedRules),
    ai_mean: summaries[id].AI.mean,
    ai_min: summaries[id].AI.min,
    ai_max: summaries[id].AI.max,
    combined_mean: summaries[id].combined.mean,
    combined_min: summaries[id].combined.min,
    combined_max: summaries[id].combined.max,
    combined_std: summaries[id].combined.standardDeviation,
  };
}

function roleRow(id, summaries, ruleResults) {
  return {
    transaction_id: id,
    ruleScore: summaries[id].ruleScore,
    ai_mean: summaries[id].AI.mean,
    combined_mean: summaries[id].combined.mean,
    detectedRules: rulesText(ruleResults[id].detectedRules),
  };
}

function printDetail(id, summaries, ruleResults, featuresById) {
  const featureNames = {
    T0281: ["amountRatio", "amountZScore", "dailySpendRatio"],
    T0292: ["timeSlotFrequency", "categoryFrequency", "amountRatio"],
    T0299: ["recent10MinCount"],
    T0302: ["recent10MinCount", "dailySpendRatio"],
  }[id];
  const selectedFeatures = featureNames
    ? Object.fromEntries(featureNames.map((name) => [name, featuresById[id][name]]))
    : undefined;
  console.log(`DETAIL - ${id}`, {
    ...(selectedFeatures ? { features: selectedFeatures } : {}),
    detectedRules: ruleResults[id].detectedRules,
    ruleScore: summaries[id].ruleScore,
    AI: summaries[id].AI,
    combined: summaries[id].combined,
  });
}

async function run() {
  try {
    console.log("=== DB Combined Risk Score E2E Test ===");
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

    currentStep = "DB 거래 조회";
    const transactions = await repository.getAllTransactions();
    assert.equal(transactions.length, EXPECTED_TRANSACTION_COUNT);
    console.log(`PASS - DB 거래 ${transactions.length}건 조회`);

    currentStep = "cutoff 및 학습 데이터 분리";
    const cutoffTransaction = requiredTransaction(CUTOFF_TRANSACTION_ID, transactions);
    const cutoffTime = getTime(cutoffTransaction);
    const trainingTransactions = transactions.filter((item) => getTime(item) < cutoffTime);
    assert.ok(trainingTransactions.length > 0);
    assert.equal(trainingTransactions.every((item) => getTime(item) < cutoffTime), true);
    assert.equal(trainingTransactions.some((item) => item.transaction_id === CUTOFF_TRANSACTION_ID), false);
    const trainingResult = buildTrainingFeatures(trainingTransactions);
    const { trainingFeatures } = trainingResult;
    assert.ok(trainingFeatures.length > 0);
    assert.equal(trainingFeatures.length, trainingResult.usableFeatureCount);
    console.log(`PASS - cutoff ${CUTOFF_TRANSACTION_ID} (${cutoffTransaction.transaction_datetime})`);
    console.log(`PASS - 학습 원천 ${trainingTransactions.length}건, feature ${trainingFeatures.length}건`);

    currentStep = "평가 입력과 과거 history 구성";
    const inputs = Object.fromEntries(ALL_IDS.map((id) => {
      const transaction = requiredTransaction(id, transactions);
      assert.ok(getTime(transaction) >= cutoffTime);
      const history = getHistoryBefore(transaction, transactions);
      assert.equal(history.every(
        (item) => item.user_id === transaction.user_id && getTime(item) < getTime(transaction),
      ), true);
      return [id, { transaction, history }];
    }));

    currentStep = "실제 Rule 서비스 분석";
    const ruleResults = Object.fromEntries(ALL_IDS.map((id) => {
      const result = runDetection(inputs[id].transaction, inputs[id].history);
      assert.equal(Number.isFinite(result.ruleScore), true);
      assert.ok(result.ruleScore >= 0 && result.ruleScore <= 100);
      return [id, result];
    }));
    console.log("PASS - runDetection으로 20건 Rule 분석");

    const results = Object.fromEntries(ALL_IDS.map((id) => [id, {
      ruleScore: ruleResults[id].ruleScore,
      detectedRules: ruleResults[id].detectedRules,
      aiScores: [],
      weightedScores: [],
      combinedScores: [],
    }]));
    const featuresById = {};
    const directSamples = {};

    currentStep = "30회 독립 AI 학습과 Combined Score 계산";
    for (let runNumber = 1; runNumber <= RUN_COUNT; runNumber += 1) {
      resetModel();
      const trainingStatus = trainModel(trainingFeatures);
      assert.equal(trainingStatus.trained, true);
      assert.equal(isModelTrained(), true);
      const referenceScores = trainingFeatures.map(
        (feature) => predictAnomaly(feature).anomalyScore,
      );
      assert.equal(referenceScores.length, trainingFeatures.length);
      assert.equal(referenceScores.every(Number.isFinite), true);

      const mutationId = "T0281";
      const transactionSnapshot = JSON.stringify(inputs[mutationId].transaction);
      const historySnapshot = JSON.stringify(inputs[mutationId].history);
      const referenceSnapshot = JSON.stringify(referenceScores);

      for (const id of ALL_IDS) {
        const aiResult = scoreTransactionWithAI(
          inputs[id].transaction,
          inputs[id].history,
          referenceScores,
        );
        assert.equal(aiResult.available, true, `${id}: ${aiResult.unavailableReason}`);
        assert.equal(aiResult.unavailableReason, null);
        assert.equal(Number.isFinite(aiResult.rawScore), true);
        assert.ok(Number.isFinite(aiResult.percentile)
          && aiResult.percentile >= 0 && aiResult.percentile <= 100);
        assert.ok(Number.isFinite(aiResult.calibratedAiScore)
          && aiResult.calibratedAiScore >= 0 && aiResult.calibratedAiScore <= 100);
        const combined = combineRiskScore(results[id].ruleScore, aiResult.calibratedAiScore);
        assert.equal(combined.ruleWeight, 0.7);
        assert.equal(combined.aiWeight, 0.3);
        assert.equal(combined.ruleScore, results[id].ruleScore);
        assert.equal(combined.calibratedAiScore, aiResult.calibratedAiScore);
        assert.equal(Number.isFinite(combined.weightedScore), true);
        assert.equal(Number.isInteger(combined.combinedScore), true);
        assert.ok(combined.combinedScore >= 0 && combined.combinedScore <= 100);
        results[id].aiScores.push(aiResult.calibratedAiScore);
        results[id].weightedScores.push(combined.weightedScore);
        results[id].combinedScores.push(combined.combinedScore);
        featuresById[id] ||= aiResult.features;
        if (runNumber === 1 && DIRECT_CHECK_IDS.includes(id)) {
          directSamples[id] = { aiScore: aiResult.calibratedAiScore, ...combined };
        }
      }
      assert.equal(JSON.stringify(inputs[mutationId].transaction), transactionSnapshot);
      assert.equal(JSON.stringify(inputs[mutationId].history), historySnapshot);
      assert.equal(JSON.stringify(referenceScores), referenceSnapshot);
      console.log(`PASS - AI 독립 학습 및 E2E ${runNumber}/${RUN_COUNT}`);
    }

    currentStep = "통계와 직접 Combiner 결과 검증";
    const summaries = Object.fromEntries(ALL_IDS.map((id) => {
      assert.equal(results[id].aiScores.length, RUN_COUNT);
      assert.equal(results[id].weightedScores.length, RUN_COUNT);
      assert.equal(results[id].combinedScores.length, RUN_COUNT);
      return [id, {
        ruleScore: results[id].ruleScore,
        AI: statistics(results[id].aiScores),
        weighted: statistics(results[id].weightedScores),
        combined: statistics(results[id].combinedScores),
      }];
    }));
    for (const id of DIRECT_CHECK_IDS) {
      const recalculated = combineRiskScore(results[id].ruleScore, directSamples[id].aiScore);
      assert.equal(recalculated.weightedScore, directSamples[id].weightedScore);
      assert.equal(recalculated.combinedScore, directSamples[id].combinedScore);
    }

    console.log("CONTROL 거래별 결과");
    console.table(CONTROL_IDS.map((id) => summaryRow(id, summaries, ruleResults)));
    console.log("TEST ANOMALY 거래별 결과");
    console.table(ANOMALY_IDS.map((id) => summaryRow(id, summaries, ruleResults)));

    const controlScores = CONTROL_IDS.flatMap((id) => results[id].combinedScores);
    const anomalyScores = ANOMALY_IDS.flatMap((id) => results[id].combinedScores);
    console.log("Combined Score 그룹 통계", {
      CONTROL: statistics(controlScores),
      TEST_ANOMALY: statistics(anomalyScores),
    });
    console.log("CONTROL scoreRange 분포", scoreRangeDistribution(controlScores));
    console.log("TEST ANOMALY scoreRange 분포", scoreRangeDistribution(anomalyScores));
    console.log("CONTROL 점수 포화도", saturation(controlScores));
    console.log("TEST ANOMALY 점수 포화도", saturation(anomalyScores));

    const ranking = [...ALL_IDS].sort(
      (a, b) => summaries[b].combined.mean - summaries[a].combined.mean,
    );
    console.log("20개 거래 combined mean 순위");
    console.table(ranking.map((id, index) => ({
      rank: index + 1,
      group: CONTROL_IDS.includes(id) ? "CONTROL" : "TEST ANOMALY",
      ...summaryRow(id, summaries, ruleResults),
    })));
    console.log("인접 거래 combined mean gap");
    console.table(ranking.slice(0, -1).map((id, index) => ({
      transaction_id: id,
      next_transaction_id: ranking[index + 1],
      combined_mean: summaries[id].combined.mean,
      next_combined_mean: summaries[ranking[index + 1]].combined.mean,
      gap: summaries[id].combined.mean - summaries[ranking[index + 1]].combined.mean,
    })));

    for (const id of ["T0245", "T0281", "T0292", "T0299", "T0302"]) {
      printDetail(id, summaries, ruleResults, featuresById);
    }
    for (const [label, ids] of Object.entries({
      "U002 반복 결제": ["T0257", "T0258", "T0259", "T0260", "T0261"],
      "U004 반복 결제": ["T0299", "T0300", "T0301", "T0302"],
    })) {
      console.log(label);
      console.table(ids.map((id) => ({
        transaction_id: id,
        recent10MinCount: featuresById[id].recent10MinCount,
        detectedRules: rulesText(ruleResults[id].detectedRules),
        ruleScore: summaries[id].ruleScore,
        ai_mean: summaries[id].AI.mean,
        combined_mean: summaries[id].combined.mean,
        combined_min: summaries[id].combined.min,
        combined_max: summaries[id].combined.max,
      })));
    }

    const ruleHighAiLow = [...ALL_IDS].sort(
      (a, b) => (summaries[b].ruleScore - summaries[b].AI.mean)
        - (summaries[a].ruleScore - summaries[a].AI.mean),
    ).slice(0, 3);
    const ruleLowAiHigh = [...ALL_IDS].sort(
      (a, b) => (summaries[b].AI.mean - summaries[b].ruleScore)
        - (summaries[a].AI.mean - summaries[a].ruleScore),
    ).slice(0, 3);
    console.log("Rule 높음 / AI 낮음 관찰 후보");
    console.table(ruleHighAiLow.map((id) => roleRow(id, summaries, ruleResults)));
    console.log("Rule 낮음 / AI 높음 관찰 후보");
    console.table(ruleLowAiHigh.map((id) => roleRow(id, summaries, ruleResults)));

    console.log("Combined Score 표준편차 상위 5건");
    console.table([...ALL_IDS].sort(
      (a, b) => summaries[b].combined.standardDeviation
        - summaries[a].combined.standardDeviation,
    ).slice(0, 5).map((id) => ({
      transaction_id: id,
      ruleScore: summaries[id].ruleScore,
      ai_stdDev: summaries[id].AI.standardDeviation,
      combined_stdDev: summaries[id].combined.standardDeviation,
      combined_min: summaries[id].combined.min,
      combined_max: summaries[id].combined.max,
    })));

    assert.equal(controlScores.length, 120);
    assert.equal(anomalyScores.length, 480);
    console.log("PASS - 모든 Rule/AI/weighted/combined 점수 계약 검증");
    console.log("PASS - Data Leakage 및 mutation 없음");
    console.log("INFO - Risk Level 미적용, fraud probability 미구현");
    console.log("=== DB Combined Risk Score E2E Test PASS ===");
  } catch (error) {
    console.error(`FAIL - 단계: ${currentStep}`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    resetModel();
    try {
      assert.equal(isModelTrained(), false);
      console.log("PASS - finally 모델 untrained 상태 확인");
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
