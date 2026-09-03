const { IsolationForest } = require("isolation-forest");

const FEATURE_NAMES = [
  "amountRatio",
  "amountZScore",
  "recent10MinCount",
  "averageTransactionInterval",
  "timeSlotFrequency",
  "categoryFrequency",
  "dailySpendRatio",
];

let isolationForest = null;
let modelTrained = false;

// AI 모델에 사용할 7개 Feature가 정상인지 확인하고 필요한 값만 복사합니다.
function normalizeFeatureObject(features) {
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    throw new TypeError("Feature는 객체여야 합니다.");
  }

  const normalizedFeatures = {};

  for (const featureName of FEATURE_NAMES) {
    if (!Object.hasOwn(features, featureName)) {
      throw new TypeError(`필수 Feature가 없습니다: ${featureName}`);
    }

    const value = features[featureName];

    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(
        `${featureName}은(는) 유효한 숫자여야 합니다.`,
      );
    }

    normalizedFeatures[featureName] = value;
  }

  return normalizedFeatures;
}

// 전달받은 Feature 데이터로 Isolation Forest를 새로 학습합니다.
function trainModel(trainingFeatures) {
  if (!Array.isArray(trainingFeatures) || trainingFeatures.length === 0) {
    throw new TypeError("trainingFeatures는 비어 있지 않은 배열이어야 합니다.");
  }

  const normalizedTrainingFeatures = trainingFeatures.map(
    (features) => normalizeFeatureObject(features),
  );
  const newIsolationForest = new IsolationForest();

  newIsolationForest.fit(normalizedTrainingFeatures);

  isolationForest = newIsolationForest;
  modelTrained = true;

  return {
    trained: true,
    trainingSampleCount: normalizedTrainingFeatures.length,
  };
}

// 학습된 모델로 새로운 Feature의 raw anomaly score를 계산합니다.
function predictAnomaly(features) {
  if (!modelTrained || !isolationForest) {
    throw new Error("AI model is not trained.");
  }

  const normalizedFeatures = normalizeFeatureObject(features);
  const prediction = isolationForest.predict([normalizedFeatures]);
  const anomalyScore = prediction[0];

  if (typeof anomalyScore !== "number" || !Number.isFinite(anomalyScore)) {
    throw new Error("Isolation Forest가 유효한 anomaly score를 반환하지 않았습니다.");
  }

  return {
    available: true,
    anomalyScore,
  };
}

// 현재 메모리의 AI 모델이 정상적으로 학습되었는지 반환합니다.
function isModelTrained() {
  return modelTrained;
}

// 테스트나 재학습을 위해 현재 메모리 모델을 초기화합니다.
function resetModel() {
  isolationForest = null;
  modelTrained = false;
}

module.exports = {
  trainModel,
  predictAnomaly,
  isModelTrained,
  resetModel,
};