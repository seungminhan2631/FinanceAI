const path = require("path");
const { extractFeatures } = require("./featureExtractor");

// 상위 config/constants 경로를 절대 경로로 안전하게 로드합니다.
const { RULE_STATUS } = require(path.join(__dirname, "../../config/constants"));

// 정렬에 사용할 거래 시각을 숫자로 변환합니다.
function getTransactionTime(transaction) {
  if (!transaction || typeof transaction !== "object") {
    return Number.POSITIVE_INFINITY;
  }

  const transactionTime = new Date(transaction.transaction_datetime).getTime();

  return Number.isNaN(transactionTime)
    ? Number.POSITIVE_INFINITY
    : transactionTime;
}

// 동일 시각 거래의 정렬 순서를 일정하게 유지하기 위한 ID를 반환합니다.
function getTransactionId(transaction) {
  if (!transaction || typeof transaction.transaction_id !== "string") {
    return "";
  }

  return transaction.transaction_id;
}

// 여러 원본 거래를 Isolation Forest 학습용 Feature 배열로 변환합니다.
function buildTrainingFeatures(transactions) {
  if (!Array.isArray(transactions)) {
    throw new TypeError("transactions는 배열이어야 합니다.");
  }

  const transactionsByUser = new Map();
  const trainingFeatures = [];
  const skippedReasons = {};

  // 사용자별로 거래를 나눕니다. 유효성 판단은 extractFeatures에 맡깁니다.
  for (const transaction of transactions) {
    const userId =
      transaction && typeof transaction === "object"
        ? transaction.user_id
        : undefined;

    if (!transactionsByUser.has(userId)) {
      transactionsByUser.set(userId, []);
    }

    transactionsByUser.get(userId).push(transaction);
  }

  for (const userTransactions of transactionsByUser.values()) {
    // 원본 배열을 변경하지 않고 오래된 거래부터 정렬합니다.
    const sortedTransactions = [...userTransactions].sort(
      (firstTransaction, secondTransaction) => {
        const firstTime = getTransactionTime(firstTransaction);
        const secondTime = getTransactionTime(secondTransaction);

        if (firstTime !== secondTime) {
          return firstTime - secondTime;
        }

        return getTransactionId(firstTransaction).localeCompare(
          getTransactionId(secondTransaction),
        );
      },
    );
    const processedTransactionIds = new Set();

    for (let index = 0; index < sortedTransactions.length; index += 1) {
      const currentTransaction = sortedTransactions[index];
      const transactionId = getTransactionId(currentTransaction);

      // 같은 사용자의 동일한 거래는 current 거래로 한 번만 처리합니다.
      if (
        transactionId !== "" &&
        processedTransactionIds.has(transactionId)
      ) {
        skippedReasons[RULE_STATUS.DUPLICATE_TRANSACTION] =
          (skippedReasons[RULE_STATUS.DUPLICATE_TRANSACTION] || 0) + 1;
        continue;
      }

      if (transactionId !== "") {
        processedTransactionIds.add(transactionId);
      }

      // Data Leakage 방지를 위해 현재 거래보다 앞선 거래만 사용합니다.
      const previousTransactions = sortedTransactions.slice(0, index);
      const featureResult = extractFeatures(
        currentTransaction,
        previousTransactions,
      );

      // Feature 생성이 가능한 거래만 값을 가공하지 않고 추가합니다.
      if (featureResult.available) {
        trainingFeatures.push(featureResult.features);
        continue;
      }

      const skippedReason = featureResult.unavailableReason || "UNKNOWN";
      skippedReasons[skippedReason] =
        (skippedReasons[skippedReason] || 0) + 1;
    }
  }

  return {
    trainingFeatures,
    totalTransactions: transactions.length,
    usableFeatureCount: trainingFeatures.length,
    skippedFeatureCount: transactions.length - trainingFeatures.length,
    skippedReasons,
  };
}

module.exports = {
  buildTrainingFeatures,
};