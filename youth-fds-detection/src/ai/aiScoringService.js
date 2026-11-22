const {
  analyzeTransactionWithAI,
} = require("./aiService");
const {
  normalizeAiScore,
} = require("./aiScoreNormalizer");
const {
  calibrateAiScore,
} = require("./aiScoreCalibrator");

// 기존 AI 분석, percentile 변환, Calibration을 한 흐름으로 연결합니다.
function scoreTransactionWithAI(
  currentTransaction,
  transactionHistory,
  referenceScores,
) {
  // 기존 AI 서비스에서 Feature와 raw anomaly score를 계산합니다.
  const analysis = analyzeTransactionWithAI(
    currentTransaction,
    transactionHistory,
  );

  // AI 분석이 불가능하면 점수 변환 없이 기존 상태를 전달합니다.
  if (analysis.available !== true || analysis.anomalyScore === null) {
    return {
      available: false,
      unavailableReason: analysis.unavailableReason,
      features: analysis.features,
      rawScore: null,
      percentile: null,
      calibratedAiScore: null,
    };
  }

  const rawScore = analysis.anomalyScore;

  if (typeof rawScore !== "number" || !Number.isFinite(rawScore)) {
    throw new TypeError("AI 분석 결과의 rawScore가 유효한 숫자가 아닙니다.");
  }

  // referenceScores는 rawScore와 동일한 학습 모델에서 생성해야 합니다.
  // raw score를 기준 분포의 percentile로 변환합니다.
  const normalized = normalizeAiScore(rawScore, referenceScores);

  // percentile을 정식 Calibration 점수로 변환합니다.
  const calibrated = calibrateAiScore(normalized.percentile);

  return {
    available: true,
    unavailableReason: null,
    features: analysis.features,
    rawScore,
    percentile: normalized.percentile,
    calibratedAiScore: calibrated.calibratedAiScore,
  };
}

module.exports = {
  scoreTransactionWithAI,
};
