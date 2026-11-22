// 구현된 5개의 탐지 Rule을 가져옵니다.
const { detectNightPayment } = require("../rules/nightPayment");
const { detectRapidPayment } = require("../rules/rapidPayment");
const { detectHighAmount } = require("../rules/highAmount");
const { detectNewCategory } = require("../rules/newCategory");
const { detectDailySpendSpike } = require("../rules/dailySpendSpike");
const {
  RULE_STATUS,
  ANALYSIS_STATUS,
  DETECTION_TYPE,
  NIGHT_PAYMENT,
  RAPID_PAYMENT,
  HIGH_AMOUNT,
  NEW_CATEGORY,
  DAILY_SPEND_SPIKE,
  RISK,
} = require("../config/constants");

// Rule type별 기본 가중치를 정의합니다.
const RULE_WEIGHTS = {
  [DETECTION_TYPE.NIGHT_PAYMENT]: NIGHT_PAYMENT.SCORE,
  [DETECTION_TYPE.RAPID_PAYMENT]: RAPID_PAYMENT.SCORE,
  [DETECTION_TYPE.HIGH_AMOUNT]: HIGH_AMOUNT.SCORE,
  [DETECTION_TYPE.NEW_CATEGORY]: NEW_CATEGORY.SCORE,
  [DETECTION_TYPE.DAILY_SPEND_SPIKE]: DAILY_SPEND_SPIKE.SCORE,
};

// 현재 Rule 점수가 설정된 어느 위험등급에 속하는지 확인합니다.
function determineRiskLevel(ruleScore) {
  for (const [levelName, range] of Object.entries(RISK.LEVELS)) {
    if (ruleScore >= range.MIN && ruleScore <= range.MAX) {
      return levelName;
    }
  }

  return null;
}

// 현재 거래에 5개 Rule을 실행하고 분석 결과를 하나로 통합합니다.
function runDetection(transaction, transactionHistory) {
  // 5개의 탐지 Rule을 정해진 순서로 모두 실행합니다.
  const nightResult = detectNightPayment(transaction);
  const rapidResult = detectRapidPayment(transaction, transactionHistory);
  const highAmountResult = detectHighAmount(transaction, transactionHistory);
  const newCategoryResult = detectNewCategory(transaction, transactionHistory);
  const dailySpendSpikeResult = detectDailySpendSpike(
    transaction,
    transactionHistory,
  );

  const results = [
    nightResult,
    rapidResult,
    highAmountResult,
    newCategoryResult,
    dailySpendSpikeResult,
  ];

  // 실제로 탐지된 Rule의 type과 현재 점수를 모읍니다.
  const detectedResults = results.filter(
    (result) =>
      result.status === RULE_STATUS.DETECTED && result.detected === true,
  );
  const detectedRules = detectedResults.map((result) => result.type);
  const calculatedScore = detectedResults.reduce(
    (totalScore, result) => totalScore + result.score,
    0,
  );
  const ruleScore = Math.min(calculatedScore, RISK.MAX_SCORE);

  // DETECTED와 NOT_DETECTED Rule의 기본 가중치로 분석 커버리지를 계산합니다.
  const analyzableStatuses = new Set([
    RULE_STATUS.DETECTED,
    RULE_STATUS.NOT_DETECTED,
  ]);
  const totalRuleWeight = Object.values(RULE_WEIGHTS).reduce(
    (totalWeight, ruleWeight) => totalWeight + ruleWeight,
    0,
  );
  const availableRuleWeight = results.reduce((totalWeight, result) => {
    if (!analyzableStatuses.has(result.status)) {
      return totalWeight;
    }

    return totalWeight + (RULE_WEIGHTS[result.type] || 0);
  }, 0);
  const analysisCoveragePercent =
    totalRuleWeight > 0
      ? Math.round((availableRuleWeight / totalRuleWeight) * 100)
      : 0;

  const analysisStatus =
    analysisCoveragePercent >= RISK.MIN_ANALYSIS_COVERAGE_PERCENT
      ? ANALYSIS_STATUS.COMPLETE
      : ANALYSIS_STATUS.LIMITED;

  // 분석 커버리지가 충분한 경우에만 위험등급을 확정합니다.
  const riskLevel =
    analysisStatus === ANALYSIS_STATUS.COMPLETE
      ? determineRiskLevel(ruleScore)
      : null;

  return {
    transactionId: transaction ? transaction.transaction_id : undefined,
    analysisStatus,
    analysisCoveragePercent,
    ruleScore,
    riskLevel,
    detectedRules,
    results,
  };
}

module.exports = {
  runDetection,
};
