const analysisByTransactionId = new Map();
const latestAnalysisByUserId = new Map();

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function saveAnalysisResult(analysis) {
  if (!analysis || typeof analysis !== "object") {
    throw new TypeError("analysis는 객체여야 합니다.");
  }

  const { transactionId, userId } = analysis;
  if (typeof transactionId !== "string" || !transactionId) {
    throw new TypeError("analysis.transactionId가 필요합니다.");
  }
  if (typeof userId !== "string" || !userId) {
    throw new TypeError("analysis.userId가 필요합니다.");
  }

  const snapshot = clone(analysis);
  analysisByTransactionId.set(transactionId, snapshot);
  latestAnalysisByUserId.set(userId, snapshot);
}

function getLatestAnalysisByUserId(userId) {
  return clone(latestAnalysisByUserId.get(userId));
}

function getAnalysisByTransactionId(transactionId) {
  return clone(analysisByTransactionId.get(transactionId));
}

function clearAnalysisResults() {
  analysisByTransactionId.clear();
  latestAnalysisByUserId.clear();
}

module.exports = {
  saveAnalysisResult,
  getLatestAnalysisByUserId,
  getAnalysisByTransactionId,
  clearAnalysisResults,
};
