const assert = require("node:assert/strict");

const {
  trainModel,
  predictAnomaly,
  isModelTrained,
  resetModel,
} = require("../src/ai/aiModel");

const FEATURE_NAMES = [
  "amountRatio",
  "amountZScore",
  "recent10MinCount",
  "averageTransactionInterval",
  "timeSlotFrequency",
  "categoryFrequency",
  "dailySpendRatio",
];

const trainingFeatures = [
  createFeature(1.0, 0.1, 1, 120, 0.3, 0.4, 1.0),
  createFeature(1.1, 0.3, 1, 150, 0.25, 0.35, 0.9),
  createFeature(0.9, -0.2, 1, 100, 0.4, 0.5, 1.1),
  createFeature(1.2, 0.5, 2, 90, 0.3, 0.45, 1.2),
  createFeature(0.8, -0.4, 1, 180, 0.35, 0.3, 0.8),
  createFeature(1.05, 0.2, 1, 130, 0.28, 0.42, 1.05),
  createFeature(1.3, 0.7, 2, 80, 0.22, 0.4, 1.3),
  createFeature(0.95, -0.1, 1, 160, 0.32, 0.55, 0.95),
  createFeature(1.15, 0.4, 1, 110, 0.27, 0.38, 1.15),
  createFeature(0.85, -0.3, 1, 170, 0.37, 0.48, 0.85),
];

const normalFeature = createFeature(1.1, 0.2, 1, 125, 0.3, 0.4, 1.0);
const abnormalFeature = createFeature(4.5, 5.0, 8, 1.5, 0.01, 0, 4.2);
const failures = [];
let passCount = 0;
let normalRawScore = null;
let abnormalRawScore = null;

function createFeature(
  amountRatio,
  amountZScore,
  recent10MinCount,
  averageTransactionInterval,
  timeSlotFrequency,
  categoryFrequency,
  dailySpendRatio,
) {
  return {
    amountRatio,
    amountZScore,
    recent10MinCount,
    averageTransactionInterval,
    timeSlotFrequency,
    categoryFrequency,
    dailySpendRatio,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function trainDefaultModel() {
  resetModel();
  return trainModel(trainingFeatures);
}

function assertFinitePrediction(result) {
  assert.equal(result.available, true);
  assert.equal(typeof result.anomalyScore, "number");
  assert.ok(Number.isFinite(result.anomalyScore));
}

runTest("초기 상태", () => {
  resetModel();
  assert.equal(isModelTrained(), false);
});

runTest("학습 전 predict 거부", () => {
  resetModel();
  assert.throws(() => predictAnomaly(normalFeature), /not trained/i);
});

runTest("정상 학습", () => {
  resetModel();
  const result = trainModel(trainingFeatures);

  assert.deepEqual(result, {
    trained: true,
    trainingSampleCount: trainingFeatures.length,
  });
  assert.equal(isModelTrained(), true);
});

runTest("빈 배열 학습 거부", () => {
  resetModel();
  assert.throws(() => trainModel([]), TypeError);
  assert.equal(isModelTrained(), false);
});

runTest("배열이 아닌 학습값 거부", () => {
  for (const invalidValue of [null, {}, "data"]) {
    resetModel();
    assert.throws(() => trainModel(invalidValue), TypeError);
    assert.equal(isModelTrained(), false);
  }
});

runTest("정상 Feature 예측", () => {
  trainDefaultModel();
  const result = predictAnomaly(normalFeature);

  assertFinitePrediction(result);
  normalRawScore = result.anomalyScore;
});

runTest("이상 Feature 예측", () => {
  trainDefaultModel();
  const result = predictAnomaly(abnormalFeature);

  assertFinitePrediction(result);
  abnormalRawScore = result.anomalyScore;
});

runTest("정상 이상 점수 방향 정보", () => {
  trainDefaultModel();
  normalRawScore = predictAnomaly(normalFeature).anomalyScore;
  abnormalRawScore = predictAnomaly(abnormalFeature).anomalyScore;

  assert.ok(Number.isFinite(normalRawScore));
  assert.ok(Number.isFinite(abnormalRawScore));
  console.log(`INFO - normal raw anomaly score: ${normalRawScore}`);
  console.log(`INFO - abnormal raw anomaly score: ${abnormalRawScore}`);
  console.log(
    `INFO - abnormal score greater than normal: ${abnormalRawScore > normalRawScore}`,
  );
});

runTest("Feature 하나 누락 거부", () => {
  trainDefaultModel();
  const { amountRatio, ...missingAmountRatio } = normalFeature;

  assert.throws(() => predictAnomaly(missingAmountRatio), TypeError);
});

runTest("각 필수 Feature 누락 검사", () => {
  trainDefaultModel();

  for (const featureName of FEATURE_NAMES) {
    const missingFeature = { ...normalFeature };
    delete missingFeature[featureName];
    assert.throws(() => predictAnomaly(missingFeature), TypeError);
  }
});

runTest("NaN 거부", () => {
  trainDefaultModel();
  assert.throws(
    () => predictAnomaly({ ...normalFeature, amountRatio: NaN }),
    TypeError,
  );
});

runTest("Infinity 거부", () => {
  trainDefaultModel();
  assert.throws(
    () => predictAnomaly({ ...normalFeature, dailySpendRatio: Infinity }),
    TypeError,
  );
});

runTest("-Infinity 거부", () => {
  trainDefaultModel();
  assert.throws(
    () => predictAnomaly({ ...normalFeature, amountZScore: -Infinity }),
    TypeError,
  );
});

runTest("문자열 숫자 거부", () => {
  trainDefaultModel();
  assert.throws(
    () => predictAnomaly({ ...normalFeature, amountRatio: "2.5" }),
    TypeError,
  );
});

runTest("null Feature 값 거부", () => {
  trainDefaultModel();
  assert.throws(
    () => predictAnomaly({ ...normalFeature, categoryFrequency: null }),
    TypeError,
  );
});

runTest("boolean Feature 값 거부", () => {
  trainDefaultModel();
  assert.throws(
    () => predictAnomaly({ ...normalFeature, recent10MinCount: true }),
    TypeError,
  );
});

runTest("학습 데이터 내부 오류와 상태", () => {
  resetModel();
  const invalidTrainingData = trainingFeatures.map((feature) => ({ ...feature }));
  invalidTrainingData[3].amountRatio = NaN;

  assert.throws(() => trainModel(invalidTrainingData), TypeError);
  assert.equal(isModelTrained(), false);
});

runTest("추가 필드 허용", () => {
  const trainingWithExtraFields = trainingFeatures.map((feature, index) => ({
    ...feature,
    user_id: `U${index}`,
    extraValue: 999,
  }));
  resetModel();
  assert.equal(
    trainModel(trainingWithExtraFields).trainingSampleCount,
    trainingWithExtraFields.length,
  );

  const baseResult = predictAnomaly(normalFeature);
  const extraResult = predictAnomaly({
    ...normalFeature,
    user_id: "U001",
    extraValue: 999,
  });
  assert.equal(extraResult.anomalyScore, baseResult.anomalyScore);
});

runTest("입력 객체 변경 금지", () => {
  trainDefaultModel();
  const featureWithExtraFields = {
    ...normalFeature,
    user_id: "U001",
    extraValue: 999,
  };
  const before = clone(featureWithExtraFields);

  predictAnomaly(featureWithExtraFields);
  assert.deepEqual(featureWithExtraFields, before);
});

runTest("resetModel", () => {
  trainDefaultModel();
  resetModel();

  assert.equal(isModelTrained(), false);
  assert.throws(() => predictAnomaly(normalFeature), /not trained/i);
});

runTest("재학습", () => {
  trainDefaultModel();
  const secondTrainingFeatures = trainingFeatures.slice(0, 8).map(
    (feature) => ({
      ...feature,
      averageTransactionInterval: feature.averageTransactionInterval + 20,
    }),
  );
  const result = trainModel(secondTrainingFeatures);

  assert.equal(result.trained, true);
  assert.equal(result.trainingSampleCount, secondTrainingFeatures.length);
  assert.equal(isModelTrained(), true);
  assertFinitePrediction(predictAnomaly(normalFeature));
});

runTest("reset 후 재학습", () => {
  trainDefaultModel();
  resetModel();
  assert.equal(isModelTrained(), false);

  const result = trainModel(trainingFeatures);
  assert.equal(result.trained, true);
  assert.equal(isModelTrained(), true);
});

runTest("raw anomaly score finite 계약", () => {
  trainDefaultModel();
  const { anomalyScore } = predictAnomaly(normalFeature);

  assert.equal(typeof anomalyScore, "number");
  assert.ok(Number.isFinite(anomalyScore));
});

runTest("0~100 변환 필드 없음", () => {
  trainDefaultModel();
  const result = predictAnomaly(normalFeature);

  assert.deepEqual(Object.keys(result), ["available", "anomalyScore"]);
  assert.equal(Object.hasOwn(result, "aiScore"), false);
  assert.equal(Object.hasOwn(result, "scorePercent"), false);
});

runTest("threshold 판정 없음", () => {
  trainDefaultModel();
  const result = predictAnomaly(abnormalFeature);

  for (const field of ["isAnomalous", "riskLevel", "threshold", "HIGH", "LOW"]) {
    assert.equal(Object.hasOwn(result, field), false);
  }
});

runTest("Rule 점수 없음", () => {
  trainDefaultModel();
  const result = predictAnomaly(normalFeature);

  for (const field of ["ruleScore", "finalRiskScore", "combinedScore"]) {
    assert.equal(Object.hasOwn(result, field), false);
  }
});

runTest("Feature 7개만으로 실행", () => {
  resetModel();
  const result = trainModel(trainingFeatures);

  assert.equal(result.trained, true);
  assertFinitePrediction(predictAnomaly(normalFeature));
  assert.equal(Object.hasOwn(normalFeature, "user_id"), false);
  assert.equal(Object.hasOwn(normalFeature, "transaction_id"), false);
});

runTest("여러 샘플 학습", () => {
  resetModel();
  const result = trainModel(trainingFeatures);

  assert.equal(result.trainingSampleCount, trainingFeatures.length);
  assert.ok(trainingFeatures.length >= 8);
});

runTest("반복 predict", () => {
  trainDefaultModel();
  const predictionInputs = [
    normalFeature,
    abnormalFeature,
    normalFeature,
    createFeature(0.92, -0.15, 1, 145, 0.31, 0.46, 0.98),
  ];

  for (const feature of predictionInputs) {
    assertFinitePrediction(predictAnomaly(feature));
  }
});

runTest("전체 상태 흐름", () => {
  resetModel();
  assert.equal(isModelTrained(), false);

  trainModel(trainingFeatures);
  assert.equal(isModelTrained(), true);
  assertFinitePrediction(predictAnomaly(normalFeature));

  resetModel();
  assert.equal(isModelTrained(), false);
});

console.log("================================");

if (failures.length === 0) {
  console.log("AI Model 테스트 전체 통과");
} else {
  console.log("AI Model 테스트 실패");
}

console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failures.length}`);
console.log("================================");

if (normalRawScore !== null) {
  console.log(`INFO - final normal raw anomaly score: ${normalRawScore}`);
}

if (abnormalRawScore !== null) {
  console.log(`INFO - final abnormal raw anomaly score: ${abnormalRawScore}`);
}

if (failures.length > 0) {
  process.exitCode = 1;
}
