// 심야 결제 판단에 필요한 공통 설정과 유틸리티를 가져옵니다.
const {
  TIMEZONE,
  RULE_STATUS,
  DETECTION_TYPE,
  NIGHT_PAYMENT,
} = require("../config/constants");
const {
  validateBaseTransaction,
  isApprovedTransaction,
  isIgnoredTransaction,
  createRuleResult,
} = require("./ruleUtils");

// 현재 거래가 지정된 시간대 기준의 심야 승인 결제인지 판단합니다.
function detectNightPayment(transaction) {
  if (!validateBaseTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.INVALID_DATA,
      detected: false,
      type: DETECTION_TYPE.NIGHT_PAYMENT,
      score: 0,
      reason: "거래 기본 정보가 유효하지 않습니다.",
    });
  }

  if (isIgnoredTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.IGNORED_TRANSACTION,
      detected: false,
      type: DETECTION_TYPE.NIGHT_PAYMENT,
      score: 0,
      reason: "탐지 대상이 아닌 거래 상태입니다.",
    });
  }

  if (!isApprovedTransaction(transaction)) {
    return createRuleResult({
      status: RULE_STATUS.IGNORED_TRANSACTION,
      detected: false,
      type: DETECTION_TYPE.NIGHT_PAYMENT,
      score: 0,
      reason: "승인된 거래가 아니므로 탐지하지 않습니다.",
    });
  }

  // 서버 시간대와 관계없이 설정된 시간대의 0~23시 값으로 변환합니다.
  const transactionDate = new Date(transaction.transaction_datetime);
  const hourFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const hour = Number(hourFormatter.format(transactionDate));

  const isNightTime =
    hour >= NIGHT_PAYMENT.START_HOUR && hour < NIGHT_PAYMENT.END_HOUR;

  if (isNightTime) {
    return createRuleResult({
      status: RULE_STATUS.DETECTED,
      detected: true,
      type: DETECTION_TYPE.NIGHT_PAYMENT,
      score: NIGHT_PAYMENT.SCORE,
      reason: "심야 시간대 승인 결제가 감지되었습니다.",
    });
  }

  return createRuleResult({
    status: RULE_STATUS.NOT_DETECTED,
    detected: false,
    type: DETECTION_TYPE.NIGHT_PAYMENT,
    score: 0,
    reason: "심야 시간대 결제가 아닙니다.",
  });
}

module.exports = {
  detectNightPayment,
};
