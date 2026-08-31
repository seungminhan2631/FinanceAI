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
const DIRECT_IDS = ["T0242", "T0281", "T0292", "T0302"];

const { runDetection } = require("../src/services/detectionService");
const { combineRiskScore } = require("../src/services/riskScoreCombiner");
const {
  RISK_LEVEL, RISK_LEVEL_THRESHOLDS, getRiskLevel,
} = require("../src/services/riskLevelService");
const { buildTrainingFeatures } = require("../src/ai/trainingDataBuilder");
const {
  trainModel, predictAnomaly, isModelTrained, resetModel,
} = require("../src/ai/aiModel");
const { scoreTransactionWithAI } = require("../src/ai/aiScoringService");

const LEVELS = Object.values(RISK_LEVEL);
let close;
let currentStep = "초기화";

function getTime(transaction) {
  return new Date(transaction.transaction_datetime).getTime();
}

function requiredTransaction(id, transactions) {
  const transaction = transactions.find((item) => item.transaction_id === id);
  assert.ok(transaction, `${id} 거래가 없습니다.`);
  return transaction;
}

function getHistoryBefore(transaction, transactions) {
  const time = getTime(transaction);
  return transactions.filter(
    (item) => item.user_id === transaction.user_id && getTime(item) < time,
  );
}

function statistics(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / values.length;
  return {
    count: values.length, mean, min: Math.min(...values), max: Math.max(...values),
    stdDev: Math.sqrt(variance),
  };
}

function levelCounts(values) {
  return Object.fromEntries(LEVELS.map(
    (level) => [level, values.filter((value) => value === level).length],
  ));
}

function dominant(values) {
  const counts = levelCounts(values);
  const maximum = Math.max(...Object.values(counts));
  return LEVELS.filter((level) => counts[level] === maximum);
}

function riskSummary(values) {
  const uniqueLevelCount = new Set(values).size;
  return {
    counts: levelCounts(values), dominantLevel: dominant(values),
    stable: uniqueLevelCount === 1, uniqueLevelCount,
  };
}

function tableRow(id, results, summaries) {
  const risk = riskSummary(results[id].riskLevels);
  return {
    transaction_id: id, ruleScore: results[id].ruleScore,
    detectedRules: results[id].detectedRules.join(", ") || "NONE",
    ai_mean: summaries[id].AI.mean, combined_mean: summaries[id].combined.mean,
    combined_min: summaries[id].combined.min, combined_max: summaries[id].combined.max,
    ...risk.counts, dominantLevel: risk.dominantLevel.join("/"), stable: risk.stable,
  };
}

function printDetail(id, results, summaries, features) {
  const featureNames = {
    T0281: ["amountRatio", "amountZScore", "dailySpendRatio"],
    T0292: ["timeSlotFrequency", "categoryFrequency", "amountRatio"],
    T0299: ["recent10MinCount"],
    T0302: ["recent10MinCount", "dailySpendRatio"],
  }[id];
  console.log(`DETAIL - ${id}`, {
    ...(featureNames ? { features: Object.fromEntries(featureNames.map((name) => [name, features[id][name]])) } : {}),
    ruleScore: results[id].ruleScore, detectedRules: results[id].detectedRules,
    AI: summaries[id].AI, combined: summaries[id].combined,
    risk: riskSummary(results[id].riskLevels),
  });
}

async function run() {
  try {
    console.log("=== DB Final Risk Pipeline E2E Test ===");
    assert.equal(RISK_LEVEL_THRESHOLDS.MONITOR_MIN, 10);
    assert.equal(RISK_LEVEL_THRESHOLDS.CAUTION_MIN, 30);
    assert.equal(RISK_LEVEL_THRESHOLDS.HIGH_MIN, 50);

    currentStep = "DB 연결과 조회";
    const originalCwd = process.cwd();
    let repository;
    try {
      process.chdir(DATABASE_DIR);
      repository = require(path.join(DATABASE_DIR, "transactionRepository.js"));
      ({ close } = require(path.join(DATABASE_DIR, "db.js")));
    } finally {
      process.chdir(originalCwd);
    }
    const transactions = await repository.getAllTransactions();
    assert.equal(transactions.length, EXPECTED_TRANSACTION_COUNT);

    currentStep = "cutoff와 학습 feature";
    const cutoff = requiredTransaction(CUTOFF_TRANSACTION_ID, transactions);
    const cutoffTime = getTime(cutoff);
    const trainingTransactions = transactions.filter((item) => getTime(item) < cutoffTime);
    assert.equal(trainingTransactions.every((item) => getTime(item) < cutoffTime), true);
    assert.equal(trainingTransactions.some((item) => item.transaction_id === CUTOFF_TRANSACTION_ID), false);
    const trainingResult = buildTrainingFeatures(trainingTransactions);
    const { trainingFeatures } = trainingResult;
    assert.ok(trainingFeatures.length > 0);
    assert.equal(trainingFeatures.length, trainingResult.usableFeatureCount);
    console.log(`PASS - DB ${transactions.length}, cutoff ${cutoff.transaction_id} (${cutoff.transaction_datetime})`);
    console.log(`PASS - 학습 원천 ${trainingTransactions.length}, feature ${trainingFeatures.length}`);

    currentStep = "평가 입력 및 실제 Rule 분석";
    const inputs = Object.fromEntries(ALL_IDS.map((id) => {
      const transaction = requiredTransaction(id, transactions);
      assert.ok(getTime(transaction) >= cutoffTime);
      const history = getHistoryBefore(transaction, transactions);
      assert.equal(history.every(
        (item) => item.user_id === transaction.user_id && getTime(item) < getTime(transaction),
      ), true);
      return [id, { transaction, history }];
    }));
    const ruleResults = Object.fromEntries(ALL_IDS.map((id) => {
      const result = runDetection(inputs[id].transaction, inputs[id].history);
      assert.ok(Number.isFinite(result.ruleScore) && result.ruleScore >= 0 && result.ruleScore <= 100);
      assert.ok(Array.isArray(result.detectedRules));
      return [id, result];
    }));
    const results = Object.fromEntries(ALL_IDS.map((id) => [id, {
      group: CONTROL_IDS.includes(id) ? "CONTROL" : "TEST_ANOMALY",
      ruleScore: ruleResults[id].ruleScore, detectedRules: ruleResults[id].detectedRules,
      rawScores: [], percentiles: [], calibratedAiScores: [], weightedScores: [],
      combinedScores: [], riskLevels: [], observations: [],
    }]));
    const features = {};

    currentStep = "30회 정식 최종 파이프라인";
    for (let runNumber = 1; runNumber <= RUN_COUNT; runNumber += 1) {
      resetModel();
      assert.equal(trainModel(trainingFeatures).trained, true);
      const referenceScores = trainingFeatures.map((feature) => predictAnomaly(feature).anomalyScore);
      assert.equal(referenceScores.length, trainingFeatures.length);
      assert.equal(referenceScores.every(Number.isFinite), true);
      const mutationId = "T0281";
      const before = [JSON.stringify(inputs[mutationId].transaction), JSON.stringify(inputs[mutationId].history), JSON.stringify(referenceScores)];
      for (const id of ALL_IDS) {
        const ruleResult = ruleResults[id];
        const aiResult = scoreTransactionWithAI(inputs[id].transaction, inputs[id].history, referenceScores);
        assert.equal(aiResult.available, true, `${id}: ${aiResult.unavailableReason}`);
        assert.equal(aiResult.unavailableReason, null);
        assert.notEqual(aiResult.features, null);
        assert.equal(Number.isFinite(aiResult.rawScore), true);
        assert.ok(Number.isFinite(aiResult.percentile) && aiResult.percentile >= 0 && aiResult.percentile <= 100);
        assert.ok(Number.isFinite(aiResult.calibratedAiScore) && aiResult.calibratedAiScore >= 0 && aiResult.calibratedAiScore <= 100);
        const combined = combineRiskScore(ruleResult.ruleScore, aiResult.calibratedAiScore);
        assert.equal(combined.ruleWeight, 0.7);
        assert.equal(combined.aiWeight, 0.3);
        assert.equal(combined.ruleScore, ruleResult.ruleScore);
        assert.equal(combined.calibratedAiScore, aiResult.calibratedAiScore);
        assert.equal(Number.isFinite(combined.weightedScore), true);
        assert.equal(Number.isInteger(combined.combinedScore), true);
        assert.ok(combined.combinedScore >= 0 && combined.combinedScore <= 100);
        const riskLevel = getRiskLevel(combined.combinedScore);
        assert.ok(LEVELS.includes(riskLevel));
        const observation = {
          transactionId: id, userId: inputs[id].transaction.user_id,
          ruleScore: ruleResult.ruleScore, detectedRules: ruleResult.detectedRules,
          rawScore: aiResult.rawScore, percentile: aiResult.percentile,
          calibratedAiScore: aiResult.calibratedAiScore,
          weightedScore: combined.weightedScore, combinedScore: combined.combinedScore, riskLevel,
        };
        results[id].rawScores.push(aiResult.rawScore);
        results[id].percentiles.push(aiResult.percentile);
        results[id].calibratedAiScores.push(aiResult.calibratedAiScore);
        results[id].weightedScores.push(combined.weightedScore);
        results[id].combinedScores.push(combined.combinedScore);
        results[id].riskLevels.push(riskLevel);
        results[id].observations.push(observation);
        features[id] ||= aiResult.features;
        if (runNumber === 1 && DIRECT_IDS.includes(id)) {
          assert.equal(ruleResult.ruleScore, combined.ruleScore);
          assert.equal(aiResult.calibratedAiScore, combined.calibratedAiScore);
          assert.equal(getRiskLevel(combined.combinedScore), observation.riskLevel);
        }
      }
      assert.deepEqual([JSON.stringify(inputs[mutationId].transaction), JSON.stringify(inputs[mutationId].history), JSON.stringify(referenceScores)], before);
      console.log(`PASS - Final pipeline ${runNumber}/${RUN_COUNT}`);
    }

    const summaries = Object.fromEntries(ALL_IDS.map((id) => {
      for (const key of ["rawScores", "percentiles", "calibratedAiScores", "weightedScores", "combinedScores", "riskLevels", "observations"]) {
        assert.equal(results[id][key].length, RUN_COUNT);
      }
      return [id, { AI: statistics(results[id].calibratedAiScores), combined: statistics(results[id].combinedScores) }];
    }));
    console.log("CONTROL 최종 결과");
    console.table(CONTROL_IDS.map((id) => tableRow(id, results, summaries)));
    console.log("TEST ANOMALY 최종 결과");
    console.table(ANOMALY_IDS.map((id) => tableRow(id, results, summaries)));

    for (const [groupName, ids] of Object.entries({ CONTROL: CONTROL_IDS, TEST_ANOMALY: ANOMALY_IDS })) {
      const levels = ids.flatMap((id) => results[id].riskLevels);
      const counts = levelCounts(levels);
      console.log(`${groupName} Risk Level 분포`, Object.fromEntries(LEVELS.map((level) => [level, { count: counts[level], ratio: counts[level] / levels.length }])));
    }

    const ranking = [...ALL_IDS].sort((a, b) => summaries[b].combined.mean - summaries[a].combined.mean);
    console.log("combined mean 순위");
    console.table(ranking.map((id, index) => ({ rank: index + 1, group: results[id].group, ...tableRow(id, results, summaries) })));
    for (const id of ["T0245", "T0281", "T0292", "T0299", "T0302"]) printDetail(id, results, summaries, features);

    for (const [label, ids] of Object.entries({
      "U002 반복 결제": ["T0257", "T0258", "T0259", "T0260", "T0261"],
      "U004 반복 결제": ["T0299", "T0300", "T0301", "T0302"],
    })) {
      console.log(label);
      console.table(ids.map((id) => ({ transaction_id: id, recent10MinCount: features[id].recent10MinCount, ...tableRow(id, results, summaries) })));
    }
    const unstableIds = ALL_IDS.filter((id) => !riskSummary(results[id].riskLevels).stable);
    console.log("불안정 Risk Level 거래");
    console.table(unstableIds.map((id) => tableRow(id, results, summaries)));

    const stdRows = [...ALL_IDS].sort((a, b) => summaries[b].combined.stdDev - summaries[a].combined.stdDev);
    console.log("combined stdDev 상위 5");
    console.table(stdRows.slice(0, 5).map((id) => tableRow(id, results, summaries)));
    console.log("combined stdDev 하위 5");
    console.table(stdRows.slice(-5).reverse().map((id) => tableRow(id, results, summaries)));

    const roleRows = (ids) => ids.map((id) => ({ transaction_id: id, ruleScore: results[id].ruleScore, ai_mean: summaries[id].AI.mean, combined_mean: summaries[id].combined.mean, dominantLevel: dominant(results[id].riskLevels).join("/"), detectedRules: results[id].detectedRules.join(", ") || "NONE" }));
    console.log("Rule 높음 / AI 낮음");
    console.table(roleRows([...ALL_IDS].sort((a, b) => (results[b].ruleScore - summaries[b].AI.mean) - (results[a].ruleScore - summaries[a].AI.mean)).slice(0, 3)));
    console.log("Rule 낮음 / AI 높음");
    console.table(roleRows([...ALL_IDS].sort((a, b) => (summaries[b].AI.mean - results[b].ruleScore) - (summaries[a].AI.mean - results[a].ruleScore)).slice(0, 3)));

    const observations = ALL_IDS.flatMap((id) => results[id].observations);
    const lowWithRules = observations.filter((item) => item.riskLevel === RISK_LEVEL.LOW && item.detectedRules.length > 0);
    const ruleZeroUpper = observations.filter((item) => item.ruleScore === 0 && [RISK_LEVEL.CAUTION, RISK_LEVEL.HIGH].includes(item.riskLevel));
    console.log(`LOW이면서 detectedRules 존재: ${lowWithRules.length}`);
    console.table(lowWithRules.slice(0, 10));
    console.log(`Rule 0이면서 CAUTION/HIGH: ${ruleZeroUpper.length}`);
    console.table(ruleZeroUpper.slice(0, 10));

    console.log("Risk Level별 평균 구성");
    console.table(LEVELS.map((level) => {
      const selected = observations.filter((item) => item.riskLevel === level);
      return { riskLevel: level, count: selected.length,
        ruleScore_mean: selected.length ? statistics(selected.map((item) => item.ruleScore)).mean : null,
        aiScore_mean: selected.length ? statistics(selected.map((item) => item.calibratedAiScore)).mean : null,
        combinedScore_mean: selected.length ? statistics(selected.map((item) => item.combinedScore)).mean : null };
    }));
    const ruleFrequency = Object.fromEntries(LEVELS.map((level) => {
      const frequency = {};
      for (const observation of observations.filter((item) => item.riskLevel === level)) {
        for (const rule of observation.detectedRules) frequency[rule] = (frequency[rule] || 0) + 1;
      }
      return [level, frequency];
    }));
    console.log("Risk Level별 탐지 Rule 빈도", ruleFrequency);
    console.log("PASS - Rule → AI → Combiner → Risk Level 정식 연결 600회");
    console.log("PASS - Data Leakage 및 mutation 없음");
    console.log("INFO - fraud probability/Alert/API 미구현");
    console.log("=== DB Final Risk Pipeline E2E Test PASS ===");
  } catch (error) {
    console.error(`FAIL - 단계: ${currentStep}`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    resetModel();
    try {
      assert.equal(isModelTrained(), false);
      console.log("PASS - finally 모델 untrained 확인");
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
    if (typeof close === "function") {
      try { await close(); console.log("PASS - DB pool 종료"); }
      catch (error) { console.error(error); process.exitCode = 1; }
    }
  }
}

run();
