const RULE_WEIGHT = 0.7;
const AI_WEIGHT = 0.3;

// Rule 70%, AI 30% 가중치의 합이 정확히 1인지 확인합니다.
if (Math.abs(RULE_WEIGHT + AI_WEIGHT - 1) >= 1e-12) {
  throw new Error("Rule과 AI 가중치의 합은 1이어야 합니다.");
}

function validateScore(score, fieldName) {
  if (
    typeof score !== "number"
    || !Number.isFinite(score)
    || score < 0
    || score > 100
  ) {
    throw new TypeError(`${fieldName}는 0~100의 유효한 숫자여야 합니다.`);
  }
}

// Rule 점수와 보정된 AI 점수에 각각 70%, 30% 가중치를 적용합니다.
function combineRiskScore(ruleScore, calibratedAiScore) {
  validateScore(ruleScore, "ruleScore");
  validateScore(calibratedAiScore, "calibratedAiScore");

  // 반올림 전 가중합은 분석을 위해 원래 계산값 그대로 유지합니다.
  const weightedScore =
    ruleScore * RULE_WEIGHT + calibratedAiScore * AI_WEIGHT;

  // 최종 점수만 정수로 반올림하고 안전하게 0~100 범위로 제한합니다.
  const combinedScore = Math.min(
    100,
    Math.max(0, Math.round(weightedScore)),
  );

  // combinedScore는 사기 확률이 아니라 Rule과 AI의 통합 위험 신호 점수입니다.
  return {
    ruleScore,
    calibratedAiScore,
    ruleWeight: RULE_WEIGHT,
    aiWeight: AI_WEIGHT,
    weightedScore,
    combinedScore,
  };
}

module.exports = {
  RULE_WEIGHT,
  AI_WEIGHT,
  combineRiskScore,
};
