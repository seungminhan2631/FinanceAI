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
const LEVELS = ["LOW", "MONITOR", "CAUTION", "HIGH"];
const RISK_LEVEL_CANDIDATES = {
  A_DEFAULT: {
    LOW: [0, 19], MONITOR: [20, 39], CAUTION: [40, 59], HIGH: [60, 100],
  },
  B_SENSITIVE: {
    LOW: [0, 9], MONITOR: [10, 29], CAUTION: [30, 49], HIGH: [50, 100],
  },
  C_BALANCED: {
    LOW: [0, 14], MONITOR: [15, 34], CAUTION: [35, 54], HIGH: [55, 100],
  },
};

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

function getHistoryBefore(transaction, transactions) {
  const time = getTime(transaction);
  return transactions.filter(
    (item) => item.user_id === transaction.user_id && getTime(item) < time,
  );
}

function requiredTransaction(id, transactions) {
  const transaction = transactions.find((item) => item.transaction_id === id);
  assert.ok(transaction, `${id} 거래가 없습니다.`);
  return transaction;
}

function getRiskLevel(score, candidate) {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new TypeError("combinedScore는 0~100의 정수여야 합니다.");
  }
  const matches = Object.entries(candidate).filter(
    ([, [minimum, maximum]]) => score >= minimum && score <= maximum,
  );
  if (matches.length !== 1) throw new Error("Risk Level 범위가 누락되거나 중첩됩니다.");
  return matches[0][0];
}

function stats(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / values.length;
  return {
    count: values.length,
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    stdDev: Math.sqrt(variance),
  };
}

function levelCounts(levels) {
  return Object.fromEntries(LEVELS.map(
    (level) => [level, levels.filter((value) => value === level).length],
  ));
}

function dominantLevels(levels) {
  const counts = levelCounts(levels);
  const maximum = Math.max(...Object.values(counts));
  return LEVELS.filter((level) => counts[level] === maximum);
}

function stability(levels) {
  const uniqueLevelCount = new Set(levels).size;
  return { stable: uniqueLevelCount === 1, uniqueLevelCount };
}

function rulesText(rules) {
  return rules.join(", ") || "NONE";
}

function distribution(levels) {
  const counts = levelCounts(levels);
  return Object.fromEntries(LEVELS.map((level) => [level, {
    count: counts[level], ratio: counts[level] / levels.length,
  }]));
}

function detail(id, summaries, results) {
  const output = {
    transaction_id: id,
    ruleScore: results[id].ruleScore,
    detectedRules: results[id].detectedRules,
    combined: summaries[id],
  };
  for (const candidateName of Object.keys(RISK_LEVEL_CANDIDATES)) {
    output[candidateName] = {
      counts: levelCounts(results[id][candidateName]),
      dominantLevel: dominantLevels(results[id][candidateName]),
      ...stability(results[id][candidateName]),
    };
  }
  console.log(`DETAIL - ${id}`, output);
}

async function run() {
  try {
    console.log("=== DB Risk Level Candidate Comparison Test ===");
    currentStep = "후보 범위 및 경계 검증";
    for (const candidate of Object.values(RISK_LEVEL_CANDIDATES)) {
      for (let score = 0; score <= 100; score += 1) {
        assert.ok(LEVELS.includes(getRiskLevel(score, candidate)));
      }
    }
    for (const [name, cases] of Object.entries({
      A_DEFAULT: [[0, "LOW"], [19, "LOW"], [20, "MONITOR"], [39, "MONITOR"], [40, "CAUTION"], [59, "CAUTION"], [60, "HIGH"], [100, "HIGH"]],
      B_SENSITIVE: [[0, "LOW"], [9, "LOW"], [10, "MONITOR"], [29, "MONITOR"], [30, "CAUTION"], [49, "CAUTION"], [50, "HIGH"], [100, "HIGH"]],
      C_BALANCED: [[0, "LOW"], [14, "LOW"], [15, "MONITOR"], [34, "MONITOR"], [35, "CAUTION"], [54, "CAUTION"], [55, "HIGH"], [100, "HIGH"]],
    })) {
      for (const [score, expected] of cases) {
        assert.equal(getRiskLevel(score, RISK_LEVEL_CANDIDATES[name]), expected);
      }
    }
    console.log("PASS - A/B/C 0~100 전체 범위와 경계값 검증");

    currentStep = "DB 연결 및 조회";
    const originalDirectory = process.cwd();
    let repository;
    try {
      process.chdir(DATABASE_DIR);
      repository = require(path.join(DATABASE_DIR, "transactionRepository.js"));
      ({ close } = require(path.join(DATABASE_DIR, "db.js")));
    } finally {
      process.chdir(originalDirectory);
    }
    const transactions = await repository.getAllTransactions();
    assert.equal(transactions.length, EXPECTED_TRANSACTION_COUNT);

    currentStep = "cutoff와 학습 데이터";
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

    currentStep = "평가 입력과 Rule 분석";
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
      return [id, result];
    }));
    const results = Object.fromEntries(ALL_IDS.map((id) => [id, {
      group: CONTROL_IDS.includes(id) ? "CONTROL" : "TEST_ANOMALY",
      ruleScore: ruleResults[id].ruleScore,
      detectedRules: ruleResults[id].detectedRules,
      aiScores: [], combinedScores: [],
      A_DEFAULT: [], B_SENSITIVE: [], C_BALANCED: [],
    }]));
    const features = {};

    currentStep = "30회 AI 학습/Combined/후보 분류";
    for (let runNumber = 1; runNumber <= RUN_COUNT; runNumber += 1) {
      resetModel();
      assert.equal(trainModel(trainingFeatures).trained, true);
      const referenceScores = trainingFeatures.map((feature) => predictAnomaly(feature).anomalyScore);
      assert.equal(referenceScores.length, trainingFeatures.length);
      assert.equal(referenceScores.every(Number.isFinite), true);
      const snapshotId = "T0281";
      const snapshots = [
        JSON.stringify(inputs[snapshotId].transaction),
        JSON.stringify(inputs[snapshotId].history),
        JSON.stringify(referenceScores),
      ];
      for (const id of ALL_IDS) {
        const ai = scoreTransactionWithAI(inputs[id].transaction, inputs[id].history, referenceScores);
        assert.equal(ai.available, true, `${id}: ${ai.unavailableReason}`);
        assert.ok(Number.isFinite(ai.calibratedAiScore) && ai.calibratedAiScore >= 0 && ai.calibratedAiScore <= 100);
        const combined = combineRiskScore(results[id].ruleScore, ai.calibratedAiScore);
        assert.equal(Number.isInteger(combined.combinedScore), true);
        assert.ok(combined.combinedScore >= 0 && combined.combinedScore <= 100);
        results[id].aiScores.push(ai.calibratedAiScore);
        results[id].combinedScores.push(combined.combinedScore);
        features[id] ||= ai.features;
        for (const [name, candidate] of Object.entries(RISK_LEVEL_CANDIDATES)) {
          results[id][name].push(getRiskLevel(combined.combinedScore, candidate));
        }
      }
      assert.deepEqual([
        JSON.stringify(inputs[snapshotId].transaction),
        JSON.stringify(inputs[snapshotId].history),
        JSON.stringify(referenceScores),
      ], snapshots);
      console.log(`PASS - 독립 학습 및 후보 분류 ${runNumber}/${RUN_COUNT}`);
    }

    const summaries = Object.fromEntries(ALL_IDS.map((id) => {
      assert.equal(results[id].combinedScores.length, RUN_COUNT);
      for (const name of Object.keys(RISK_LEVEL_CANDIDATES)) assert.equal(results[id][name].length, RUN_COUNT);
      return [id, stats(results[id].combinedScores)];
    }));

    currentStep = "후보별 전체 분포";
    const candidateReports = {};
    for (const name of Object.keys(RISK_LEVEL_CANDIDATES)) {
      const controlLevels = CONTROL_IDS.flatMap((id) => results[id][name]);
      const anomalyLevels = ANOMALY_IDS.flatMap((id) => results[id][name]);
      const controlDistribution = distribution(controlLevels);
      const anomalyDistribution = distribution(anomalyLevels);
      candidateReports[name] = {
        CONTROL: controlDistribution,
        TEST_ANOMALY: anomalyDistribution,
        controlUpperLevelCount: controlDistribution.CAUTION.count + controlDistribution.HIGH.count,
        controlUpperLevelRatio: controlDistribution.CAUTION.ratio + controlDistribution.HIGH.ratio,
        anomalyLowCount: anomalyDistribution.LOW.count,
        anomalyLowRatio: anomalyDistribution.LOW.ratio,
        controlHighRatio: controlDistribution.HIGH.ratio,
        anomalyHighRatio: anomalyDistribution.HIGH.ratio,
      };
      console.log(`DISTRIBUTION - ${name}`, candidateReports[name]);
    }

    currentStep = "거래별 dominant와 안정성";
    console.log("20개 거래 A/B/C dominant 비교");
    console.table(ALL_IDS.map((id) => ({
      transaction_id: id, group: results[id].group, ruleScore: results[id].ruleScore,
      combined_mean: summaries[id].mean,
      A_dominant: dominantLevels(results[id].A_DEFAULT).join("/"),
      B_dominant: dominantLevels(results[id].B_SENSITIVE).join("/"),
      C_dominant: dominantLevels(results[id].C_BALANCED).join("/"),
    })));
    const stabilityReports = {};
    for (const name of Object.keys(RISK_LEVEL_CANDIDATES)) {
      const entries = ALL_IDS.map((id) => ({ id, ...stability(results[id][name]) }));
      stabilityReports[name] = {
        stable: entries.filter((item) => item.uniqueLevelCount === 1).length,
        twoLevels: entries.filter((item) => item.uniqueLevelCount === 2).length,
        atLeastThreeLevels: entries.filter((item) => item.uniqueLevelCount >= 3).length,
      };
      console.log(`STABILITY - ${name}`, stabilityReports[name]);
      console.log(`UNSTABLE - ${name}`);
      console.table(entries.filter((item) => !item.stable).map(({ id }) => ({
        transaction_id: id, group: results[id].group, ruleScore: results[id].ruleScore,
        combined_mean: summaries[id].mean, combined_min: summaries[id].min, combined_max: summaries[id].max,
        ...levelCounts(results[id][name]),
      })));
    }

    const dominantSignature = (id, name) => dominantLevels(results[id][name]).join("/");
    const sameAll = ALL_IDS.filter((id) => dominantSignature(id, "A_DEFAULT") === dominantSignature(id, "B_SENSITIVE")
      && dominantSignature(id, "B_SENSITIVE") === dominantSignature(id, "C_BALANCED")).length;
    console.log("후보 간 dominant 차이", {
      sameAll,
      A_B_different: ALL_IDS.filter((id) => dominantSignature(id, "A_DEFAULT") !== dominantSignature(id, "B_SENSITIVE")).length,
      B_C_different: ALL_IDS.filter((id) => dominantSignature(id, "B_SENSITIVE") !== dominantSignature(id, "C_BALANCED")).length,
      A_C_different: ALL_IDS.filter((id) => dominantSignature(id, "A_DEFAULT") !== dominantSignature(id, "C_BALANCED")).length,
    });

    for (const id of ["T0245", "T0281", "T0292", "T0299", "T0302"]) detail(id, summaries, results);
    for (const [label, ids] of Object.entries({
      "U002 반복 결제": ["T0257", "T0258", "T0259", "T0260", "T0261"],
      "U004 반복 결제": ["T0299", "T0300", "T0301", "T0302"],
    })) {
      console.log(label);
      console.table(ids.map((id) => ({
        transaction_id: id, recent10MinCount: features[id].recent10MinCount,
        ruleScore: results[id].ruleScore, combined_mean: summaries[id].mean,
        A_dominant: dominantSignature(id, "A_DEFAULT"), B_dominant: dominantSignature(id, "B_SENSITIVE"),
        C_dominant: dominantSignature(id, "C_BALANCED"),
        A_stable: stability(results[id].A_DEFAULT).stable, B_stable: stability(results[id].B_SENSITIVE).stable,
        C_stable: stability(results[id].C_BALANCED).stable,
      })));
    }

    const comparisonRows = (ids) => ids.map((id) => ({
      transaction_id: id, ruleScore: results[id].ruleScore,
      ai_mean: stats(results[id].aiScores).mean, combined_mean: summaries[id].mean,
      A_dominant: dominantSignature(id, "A_DEFAULT"), B_dominant: dominantSignature(id, "B_SENSITIVE"),
      C_dominant: dominantSignature(id, "C_BALANCED"),
    }));
    console.log("Rule 높음 / AI 낮음 후보");
    console.table(comparisonRows([...ALL_IDS].sort((a, b) =>
      (results[b].ruleScore - stats(results[b].aiScores).mean) - (results[a].ruleScore - stats(results[a].aiScores).mean)).slice(0, 3)));
    console.log("Rule 낮음 / AI 높음 후보");
    console.table(comparisonRows([...ALL_IDS].sort((a, b) =>
      (stats(results[b].aiScores).mean - results[b].ruleScore) - (stats(results[a].aiScores).mean - results[a].ruleScore)).slice(0, 3)));

    for (const [name, candidate] of Object.entries(RISK_LEVEL_CANDIDATES)) {
      const boundaries = Object.values(candidate).slice(1).map(([minimum]) => minimum);
      console.log(`BOUNDARY DISTANCE - ${name}`);
      console.table([...ALL_IDS].map((id) => ({
        transaction_id: id, combined_mean: summaries[id].mean,
        nearestBoundary: boundaries.reduce((best, value) =>
          Math.abs(value - summaries[id].mean) < Math.abs(best - summaries[id].mean) ? value : best),
      })).map((row) => ({ ...row, distance: Math.abs(row.nearestBoundary - row.combined_mean) }))
        .sort((a, b) => a.distance - b.distance).slice(0, 5));
    }

    console.log("PASS - 600개 Combined Score에 A/B/C 후보 분류 완료");
    console.log("PASS - Data Leakage 및 mutation 없음");
    console.log("INFO - 정식 Risk Level 모듈 없음, 후보 자동 선택 없음");
    console.log("=== DB Risk Level Candidate Comparison Test PASS ===");
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
