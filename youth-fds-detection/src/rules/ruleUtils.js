//모든 탐지 Rule이 공통으로 사용하는 거래 유효성 검사, 승인/제외 여부 판단, 결과 형식 통일 기능을 모아둔 파일

const { TRANSACTION_STATUS } = require("../config/constants");

// 거래 객체에 공통 필수값이 있고, 각 값이 기본 형식에 맞는지 확인합니다.
// 유효하면 true, INVALID_DATA로 처리해야 하면 false를 반환합니다.
function validateBaseTransaction(transaction) {
  if (!transaction || typeof transaction !== "object") {
    return false;
  }

  const hasValidUserId =
    typeof transaction.user_id === "string" &&
    transaction.user_id.trim() !== "";
  const hasValidTransactionId =
    typeof transaction.transaction_id === "string" &&
    transaction.transaction_id.trim() !== "";
  const transactionDate = new Date(transaction.transaction_datetime);

  const hasValidDatetime =
    transaction.transaction_datetime !== null &&
    transaction.transaction_datetime !== undefined &&
    !Number.isNaN(transactionDate.getTime()) &&
    transactionDate.getTime() <= Date.now();
  const hasValidStatus = Object.values(TRANSACTION_STATUS).includes(
    transaction.transaction_status,
  );

  return (
    hasValidUserId &&
    hasValidTransactionId &&
    hasValidDatetime &&
    hasValidStatus
  );
}

// 거래 상태가 승인 완료 상태인지 확인합니다.
function isApprovedTransaction(transaction) {
  if (!transaction) {
    return false;
  }

  return transaction.transaction_status === TRANSACTION_STATUS.APPROVED;
}

// 취소, 환불 또는 실패 거래처럼 탐지에서 제외할 상태인지 확인합니다.
function isIgnoredTransaction(transaction) {
  if (!transaction) {
    return false;
  }

  return (
    transaction.transaction_status === TRANSACTION_STATUS.CANCELLED ||
    transaction.transaction_status === TRANSACTION_STATUS.REFUNDED ||
    transaction.transaction_status === TRANSACTION_STATUS.FAILED
  );
}

// 모든 탐지 Rule이 공통된 형태의 결과 객체를 만들도록 도와줍니다.
function createRuleResult({ status, detected, type, score, reason }) {
  return {
    status,
    detected,
    type,
    score,
    reason,
  };
}

module.exports = {
  validateBaseTransaction,
  isApprovedTransaction,
  isIgnoredTransaction,
  createRuleResult,
};
