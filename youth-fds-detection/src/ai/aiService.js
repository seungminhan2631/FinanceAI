const { extractFeatures } = require("./featureExtractor");
const { predictAnomaly, isModelTrained } = require("./aiModel");

// 현재 거래와 과거 거래를 Feature 생성 및 AI 예측 단계로 연결합니다.
function analyzeTransactionWithAI(currentTransaction, transactionHistory) {
  // 현재 거래와 과거 거래를 이용해 AI Feature를 생성합니다.
  const featureResult = extractFeatures(
    currentTransaction,
    transactionHistory,
  );

  // Feature를 만들 수 없으면 AI 모델을 호출하지 않습니다.
  if (!featureResult.available) {
    return {
      available: false,
      unavailableReason: featureResult.unavailableReason,
      features: null,
      anomalyScore: null,
    };
  }

  // Feature는 생성됐지만 모델이 학습되지 않았다면 예측을 진행하지 않습니다.
  if (!isModelTrained()) {
    return {
      available: false,
      unavailableReason: "MODEL_NOT_TRAINED",
      features: featureResult.features,
      anomalyScore: null,
    };
  }

  // 학습된 모델로 raw anomaly score를 계산합니다.
  const predictionResult = predictAnomaly(featureResult.features);

  return {
    available: true,
    unavailableReason: null,
    features: featureResult.features,
    anomalyScore: predictionResult.anomalyScore,
  };
}

module.exports = {
  analyzeTransactionWithAI,
};
