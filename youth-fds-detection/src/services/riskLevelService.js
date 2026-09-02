const RISK_LEVEL = Object.freeze({
  LOW: "LOW",
  MONITOR: "MONITOR",
  CAUTION: "CAUTION",
  HIGH: "HIGH",
});

const RISK_LEVEL_THRESHOLDS = Object.freeze({
  MONITOR_MIN: 10,
  CAUTION_MIN: 30,
  HIGH_MIN: 50,
});

// Risk Level은 사기 확정 여부가 아니라 통합 위험 신호 점수를 설명하는 범주입니다.
function getRiskLevel(combinedScore) {
  if (
    typeof combinedScore !== "number"
    || !Number.isFinite(combinedScore)
    || !Number.isInteger(combinedScore)
    || combinedScore < 0
    || combinedScore > 100
  ) {
    throw new TypeError("combinedScore는 0~100의 유효한 정수여야 합니다.");
  }

  if (combinedScore >= RISK_LEVEL_THRESHOLDS.HIGH_MIN) {
    return RISK_LEVEL.HIGH;
  }

  if (combinedScore >= RISK_LEVEL_THRESHOLDS.CAUTION_MIN) {
    return RISK_LEVEL.CAUTION;
  }

  if (combinedScore >= RISK_LEVEL_THRESHOLDS.MONITOR_MIN) {
    return RISK_LEVEL.MONITOR;
  }

  return RISK_LEVEL.LOW;
}

module.exports = {
  RISK_LEVEL,
  RISK_LEVEL_THRESHOLDS,
  getRiskLevel,
};
