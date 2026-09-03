const START_PERCENTILE = 90;

// percentile을 프로토타입의 AI 위험 기여용 상대 점수로 변환합니다.
// calibratedAiScore는 사기 확률을 의미하지 않습니다.
function calibrateAiScore(percentile) {
  if (
    typeof percentile !== "number"
    || !Number.isFinite(percentile)
    || percentile < 0
    || percentile > 100
  ) {
    throw new TypeError("percentile은 0~100의 유효한 숫자여야 합니다.");
  }

  // 90 percentile 이하는 AI 위험 기여도를 0으로 처리합니다.
  if (percentile <= START_PERCENTILE) {
    return {
      percentile,
      calibratedAiScore: 0,
    };
  }

  // 상위 10% 구간을 0~100으로 선형 변환합니다.
  const normalizedPosition =
    (percentile - START_PERCENTILE) / (100 - START_PERCENTILE);
  const calibrated = normalizedPosition * 100;

  // 최종 점수를 정수로 반올림하고 0~100 범위로 제한합니다.
  const calibratedAiScore = Math.min(
    100,
    Math.max(0, Math.round(calibrated)),
  );

  return {
    percentile,
    calibratedAiScore,
  };
}

module.exports = {
  START_PERCENTILE,
  calibrateAiScore,
};