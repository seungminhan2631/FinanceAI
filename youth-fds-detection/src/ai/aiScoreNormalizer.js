// raw anomaly score와 기준 score 분포를 percentile 기반 AI Score로 변환합니다.
function normalizeAiScore(rawScore, referenceScores) {
  if (typeof rawScore !== "number" || !Number.isFinite(rawScore)) {
    throw new TypeError("rawScore는 유효한 숫자여야 합니다.");
  }

  if (!Array.isArray(referenceScores) || referenceScores.length === 0) {
    throw new TypeError("referenceScores는 비어 있지 않은 배열이어야 합니다.");
  }

  if (
    !referenceScores.every(
      (score) => typeof score === "number" && Number.isFinite(score),
    )
  ) {
    throw new TypeError("referenceScores의 모든 값은 유효한 숫자여야 합니다.");
  }

  // 현재 score보다 낮은 기준 score와 동일한 기준 score 개수를 계산합니다.
  let lowerCount = 0;
  let equalCount = 0;

  for (const referenceScore of referenceScores) {
    if (referenceScore < rawScore) {
      lowerCount += 1;
    } else if (referenceScore === rawScore) {
      equalCount += 1;
    }
  }

  // 동일 score는 해당 구간의 중간 순위로 반영합니다.
  const calculatedPercentile =
    ((lowerCount + 0.5 * equalCount) / referenceScores.length) * 100;
  const percentile = Math.min(100, Math.max(0, calculatedPercentile));

  // referenceScores는 rawScore와 동일한 학습 모델에서 생성된 값이어야 합니다.
  // percentile을 반올림해 0~100 정수 AI Score로 변환합니다.
  const aiScore = Math.min(100, Math.max(0, Math.round(percentile)));

  return {
    rawScore,
    percentile,
    aiScore,
  };
}

module.exports = {
  normalizeAiScore,
};
