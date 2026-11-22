const { runDetection } = require("./detectionService");
const { scoreTransactionWithAI } = require("../ai/aiScoringService");
const { combineRiskScore } = require("./riskScoreCombiner");
const { getRiskLevel } = require("./riskLevelService");

function analyzeTransactionRisk(transaction, history, referenceScores) {
  const ruleResult = runDetection(transaction, history);
  const aiResult = scoreTransactionWithAI(
    transaction,
    history,
    referenceScores,
  );

  const result = {
    available: aiResult.available,
    unavailableReason: aiResult.unavailableReason,
    transactionId: transaction ? transaction.transaction_id : undefined,
    userId: transaction ? transaction.user_id : undefined,
    rule: {
      score: ruleResult.ruleScore,
      detectedRules: ruleResult.detectedRules,
    },
    ai: {
      available: aiResult.available,
      features: aiResult.features,
      rawScore: aiResult.rawScore,
      percentile: aiResult.percentile,
      calibratedScore: aiResult.calibratedAiScore,
    },
  };

  if (aiResult.available !== true || aiResult.calibratedAiScore === null) {
    return {
      ...result,
      risk: {
        combinedScore: null,
        level: null,
      },
    };
  }

  const combined = combineRiskScore(
    ruleResult.ruleScore,
    aiResult.calibratedAiScore,
  );

  return {
    ...result,
    risk: {
      weightedScore: combined.weightedScore,
      combinedScore: combined.combinedScore,
      level: getRiskLevel(combined.combinedScore),
    },
  };
}

module.exports = {
  analyzeTransactionRisk,
};
