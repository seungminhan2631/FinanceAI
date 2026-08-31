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
const WEIGHT_CANDIDATES = {
  A_RULE80_AI20: { ruleWeight: 0.8, aiWeight: 0.2 },
  B_RULE70_AI30: { ruleWeight: 0.7, aiWeight: 0.3 },
  C_RULE60_AI40: { ruleWeight: 0.6, aiWeight: 0.4 },
};

const { runDetection } = require("../src/services/detectionService");
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

function getHistoryBefore(target, transactions) {
  const targetTime = getTime(target);
  return transactions.filter(
    (item) => item.user_id === target.user_id && getTime(item) < targetTime,
  );
}

function calculateCombinedScore(
  ruleScore,
  calibratedAiScore,
  ruleWeight,
  aiWeight,
) {
  assert.equal(Number.isFinite(ruleScore), true);
  assert.ok(ruleScore >= 0 && ruleScore <= 100);
  assert.equal(Number.isFinite(calibratedAiScore), true);
  assert.ok(calibratedAiScore >= 0 && calibratedAiScore <= 100);
  assert.equal(Number.isFinite(ruleWeight), true);
  assert.equal(Number.isFinite(aiWeight), true);
  assert.ok(Math.abs(ruleWeight + aiWeight - 1) < Number.EPSILON * 10);
  return Math.min(
    100,
    Math.max(0, Math.round(ruleScore * ruleWeight + calibratedAiScore * aiWeight)),
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
    stdDev: Math.sqrt(variance),
  };
}

function distribution(values) {
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

function comparisonRows(ids, summaries) {
  return ids.map((id) => ({
    transaction_id: id,
    ruleScore: summaries[id].ruleScore,
    ai_mean: summaries[id].AI.mean,
    A_mean: summaries[id].A_RULE80_AI20.mean,
    A_min: summaries[id].A_RULE80_AI20.min,
    A_max: summaries[id].A_RULE80_AI20.max,
    B_mean: summaries[id].B_RULE70_AI30.mean,
    B_min: summaries[id].B_RULE70_AI30.min,
    B_max: summaries[id].B_RULE70_AI30.max,
    C_mean: summaries[id].C_RULE60_AI40.mean,
    C_min: summaries[id].C_RULE60_AI40.min,
    C_max: summaries[id].C_RULE60_AI40.max,
  }));
}

function compactRow(id, summaries) {
  return {
    transaction_id: id,
    ruleScore: summaries[id].ruleScore,
    ai_mean: summaries[id].AI.mean,
    A_mean: summaries[id].A_RULE80_AI20.mean,
    B_mean: summaries[id].B_RULE70_AI30.mean,
    C_mean: summaries[id].C_RULE60_AI40.mean,
  };
}

function printDetail(id, summaries, ruleResults) {
  console.log(`DETAIL - ${id}`);
  console.log({
    detectedRules: ruleResults[id].detectedRules,
    ruleScore: summaries[id].ruleScore,
    AI: summaries[id].AI,
    A_RULE80_AI20: summaries[id].A_RULE80_AI20,
    B_RULE70_AI30: summaries[id].B_RULE70_AI30,
    C_RULE60_AI40: summaries[id].C_RULE60_AI40,
  });
}

async function run() {
  try {
    console.log("=== DB Rule + AI Weight Comparison Test ===");

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

    currentStep = "cutoff 시간 분리";
    const cutoffTransaction = requiredTransaction(CUTOFF_TRANSACTION_ID, transactions);
    const cutoffTime = getTime(cutoffTransaction);
    const trainingTransactions = transactions.filter((item) => getTime(item) < cutoffTime);
    assert.ok(trainingTransactions.length > 0);
    assert.equal(trainingTransactions.every((item) => getTime(item) < cutoffTime), true);
    assert.equal(trainingTransactions.some((item) => item.transaction_id === CUTOFF_TRANSACTION_ID), false);
    console.log(`PASS - cutoff ${CUTOFF_TRANSACTION_ID} (${cutoffTransaction.transaction_datetime})`);
    console.log(`PASS - 학습 원천 거래 ${trainingTransactions.length}건`);

    currentStep = "AI 학습 feature 생성";
    const trainingResult = buildTrainingFeatures(trainingTransactions);
    const { trainingFeatures } = trainingResult;
    assert.ok(trainingFeatures.length > 0);
    assert.equal(trainingFeatures.length, trainingResult.usableFeatureCount);
    console.log(`PASS - 학습 feature ${trainingFeatures.length}건`);

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

    currentStep = "기존 Rule 서비스 분석";
    const ruleResults = Object.fromEntries(ALL_IDS.map((id) => {
      const { transaction, history } = inputs[id];
      const result = runDetection(transaction, history);
      assert.equal(Number.isFinite(result.ruleScore), true);
      assert.ok(result.ruleScore >= 0 && result.ruleScore <= 100);
      assert.equal(Array.isArray(result.detectedRules), true);
      return [id, result];
    }));
    console.log("PASS - runDetection으로 20건 Rule 분석");

    const results = Object.fromEntries(ALL_IDS.map((id) => [id, {
      ruleScore: ruleResults[id].ruleScore,
      aiScores: [],
      A_RULE80_AI20: [],
      B_RULE70_AI30: [],
      C_RULE60_AI40: [],
    }]));
    const featuresById = {};

    currentStep = "Isolation Forest 30회 독립 학습 및 결합";
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

      for (const id of ALL_IDS) {
        const { transaction, history } = inputs[id];
        const aiResult = scoreTransactionWithAI(transaction, history, referenceScores);
        assert.equal(aiResult.available, true, `${id}: ${aiResult.unavailableReason}`);
        assert.equal(Number.isFinite(aiResult.calibratedAiScore), true);
        assert.ok(aiResult.calibratedAiScore >= 0 && aiResult.calibratedAiScore <= 100);
        results[id].aiScores.push(aiResult.calibratedAiScore);
        featuresById[id] ||= aiResult.features;

        for (const [name, weights] of Object.entries(WEIGHT_CANDIDATES)) {
          const score = calculateCombinedScore(
            results[id].ruleScore,
            aiResult.calibratedAiScore,
            weights.ruleWeight,
            weights.aiWeight,
          );
          assert.equal(Number.isInteger(score), true);
          assert.ok(score >= 0 && score <= 100);
          results[id][name].push(score);
        }
      }
      console.log(`PASS - AI 독립 학습 ${runNumber}/${RUN_COUNT}`);
    }

    currentStep = "거래별 통계 계산";
    const summaries = Object.fromEntries(ALL_IDS.map((id) => {
      assert.equal(results[id].aiScores.length, RUN_COUNT);
      for (const name of Object.keys(WEIGHT_CANDIDATES)) {
        assert.equal(results[id][name].length, RUN_COUNT);
      }
      return [id, {
        ruleScore: results[id].ruleScore,
        AI: statistics(results[id].aiScores),
        ...Object.fromEntries(Object.keys(WEIGHT_CANDIDATES).map(
          (name) => [name, statistics(results[id][name])],
        )),
      }];
    }));

    console.log("CONTROL 거래별 비교");
    console.table(comparisonRows(CONTROL_IDS, summaries));
    console.log("TEST ANOMALY 거래별 비교");
    console.table(comparisonRows(ANOMALY_IDS, summaries));

    currentStep = "후보별 그룹 통계와 분포";
    const groupSummaries = {};
    for (const candidate of Object.keys(WEIGHT_CANDIDATES)) {
      const controlScores = CONTROL_IDS.flatMap((id) => results[id][candidate]);
      const anomalyScores = ANOMALY_IDS.flatMap((id) => results[id][candidate]);
      assert.equal(controlScores.length, CONTROL_IDS.length * RUN_COUNT);
      assert.equal(anomalyScores.length, ANOMALY_IDS.length * RUN_COUNT);
      groupSummaries[candidate] = {
        CONTROL: { ...statistics(controlScores), ...distribution(controlScores) },
        TEST_ANOMALY: { ...statistics(anomalyScores), ...distribution(anomalyScores) },
      };
      console.log(`GROUP - ${candidate}`, groupSummaries[candidate]);
    }

    currentStep = "관찰용 대표 거래 분석";
    const strongestRuleIds = [...ALL_IDS]
      .sort((a, b) => summaries[b].ruleScore - summaries[a].ruleScore)
      .slice(0, 3);
    const strongestAiWeakRuleIds = [...ALL_IDS]
      .sort((a, b) => summaries[b].AI.mean - summaries[a].AI.mean
        || summaries[a].ruleScore - summaries[b].ruleScore)
      .slice(0, 3);
    console.log("Rule 점수가 가장 높은 거래 (관찰용)");
    console.table(strongestRuleIds.map((id) => compactRow(id, summaries)));
    console.log("AI가 강하고 Rule이 상대적으로 약한 거래 (관찰용)");
    console.table(strongestAiWeakRuleIds.map((id) => compactRow(id, summaries)));

    const highRuleLowAi = [...ALL_IDS]
      .sort((a, b) => (summaries[b].ruleScore - summaries[b].AI.mean)
        - (summaries[a].ruleScore - summaries[a].AI.mean))
      .slice(0, 3);
    const highAiLowRule = [...ALL_IDS]
      .sort((a, b) => (summaries[b].AI.mean - summaries[b].ruleScore)
        - (summaries[a].AI.mean - summaries[a].ruleScore))
      .slice(0, 3);
    console.log("Rule 높음 / AI 낮음 충돌 후보 (단순 점수 차 정렬)");
    console.table(highRuleLowAi.map((id) => compactRow(id, summaries)));
    console.log("AI 높음 / Rule 낮음 충돌 후보 (단순 점수 차 정렬)");
    console.table(highAiLowRule.map((id) => compactRow(id, summaries)));

    for (const [label, ids] of Object.entries({
      "U002 반복 결제": ["T0257", "T0258", "T0259", "T0260", "T0261"],
      "U004 반복 결제": ["T0299", "T0300", "T0301", "T0302"],
    })) {
      console.log(label);
      console.table(ids.map((id) => ({
        ...compactRow(id, summaries),
        recent10MinCount: featuresById[id].recent10MinCount,
      })));
    }

    for (const id of ["T0281", "T0292", "T0299", "T0302"]) {
      printDetail(id, summaries, ruleResults);
    }

    currentStep = "후보 간 평균 절대 점수 차이";
    const allCandidateScores = (name) => ALL_IDS.flatMap((id) => results[id][name]);
    const meanAbsoluteDifference = (first, second) => {
      const firstValues = allCandidateScores(first);
      const secondValues = allCandidateScores(second);
      return firstValues.reduce(
        (sum, value, index) => sum + Math.abs(value - secondValues[index]),
        0,
      ) / firstValues.length;
    };
    console.log("후보 간 전체 평균 절대 점수 차이", {
      A_B: meanAbsoluteDifference("A_RULE80_AI20", "B_RULE70_AI30"),
      B_C: meanAbsoluteDifference("B_RULE70_AI30", "C_RULE60_AI40"),
      A_C: meanAbsoluteDifference("A_RULE80_AI20", "C_RULE60_AI40"),
    });

    assert.equal(
      ALL_IDS.every((id) => Number.isFinite(results[id].ruleScore)
        && results[id].ruleScore >= 0 && results[id].ruleScore <= 100),
      true,
    );
    assert.equal(
      ALL_IDS.flatMap((id) => results[id].aiScores)
        .every((score) => Number.isFinite(score) && score >= 0 && score <= 100),
      true,
    );
    assert.equal(
      Object.keys(WEIGHT_CANDIDATES).flatMap(
        (name) => ALL_IDS.flatMap((id) => results[id][name]),
      ).every((score) => Number.isInteger(score) && score >= 0 && score <= 100),
      true,
    );
    console.log("PASS - Rule/AI/후보 점수 계약 및 30개 표본 검증");
    console.log("PASS - Data Leakage 없음");
    console.log("INFO - Risk Level 미적용, fraud probability 미구현, 후보 자동 선택 없음");
    console.log("=== DB Rule + AI Weight Comparison Test PASS ===");
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
