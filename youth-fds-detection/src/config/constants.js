// ==============================
// 공통 설정
// ==============================

const TIMEZONE = "Asia/Seoul";
const MIN_VALID_AMOUNT = 1;

const TRANSACTION_STATUS = {
  APPROVED: "APPROVED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
  FAILED: "FAILED",
};

// ==============================
// 탐지 결과 상태
// ==============================

const RULE_STATUS = {
  DETECTED: "DETECTED",
  NOT_DETECTED: "NOT_DETECTED",
  INSUFFICIENT_HISTORY: "INSUFFICIENT_HISTORY",
  INVALID_DATA: "INVALID_DATA",
  CALCULATION_UNAVAILABLE: "CALCULATION_UNAVAILABLE",
  IGNORED_TRANSACTION: "IGNORED_TRANSACTION",
  DUPLICATE_TRANSACTION: "DUPLICATE_TRANSACTION",
};

// ==============================
// 전체 분석 상태
// ==============================

const ANALYSIS_STATUS = {
  COMPLETE: "ANALYSIS_COMPLETE",
  LIMITED: "ANALYSIS_LIMITED",
};

// ==============================
// 탐지 종류
// ==============================

const DETECTION_TYPE = {
  RAPID_PAYMENT: "RAPID_PAYMENT",
  HIGH_AMOUNT: "HIGH_AMOUNT",
  NIGHT_PAYMENT: "NIGHT_PAYMENT",
  NEW_CATEGORY: "NEW_CATEGORY",
  DAILY_SPEND_SPIKE: "DAILY_SPEND_SPIKE",
};

// ==============================
// 단시간 반복 결제
// ==============================

const RAPID_PAYMENT = {
  WINDOW_MINUTES: 10,
  MIN_COUNT: 4,
  SCORE: 25,
};

// ==============================
// 비정상 고액 결제
// ==============================

const HIGH_AMOUNT = {
  LOOKBACK_DAYS: 30,
  MULTIPLIER: 3,

  MIN_HISTORY_DAYS: 7,
  MIN_APPROVED_TRANSACTIONS: 10,

  SCORE: 30,
};

// ==============================
// 심야 결제
// ==============================

const NIGHT_PAYMENT = {
  START_HOUR: 0,
  END_HOUR: 5,

  SCORE: 10,
};

// ==============================
// 새로운 업종 결제
// ==============================

const NEW_CATEGORY = {
  LOOKBACK_DAYS: 30,

  MIN_HISTORY_DAYS: 30,
  MIN_APPROVED_TRANSACTIONS: 10,

  UNKNOWN_CATEGORY: "UNKNOWN",

  SCORE: 10,
};

// ==============================
// 하루 소비 급증
// ==============================

const DAILY_SPEND_SPIKE = {
  LOOKBACK_DAYS: 30,
  MULTIPLIER: 2,

  MIN_HISTORY_DAYS: 30,
  MIN_APPROVED_TRANSACTIONS: 10,

  SCORE: 25,
};

// ==============================
// AI 개인화 분석 최소 조건
// ==============================

const AI_REQUIREMENTS = {
  LOOKBACK_DAYS: 30,
  MIN_HISTORY_DAYS: 30,
  MIN_APPROVED_TRANSACTIONS: 30,
};

// ==============================
// 위험도
// ==============================

const RISK = {
  MAX_SCORE: 100,

  // 전체 Rule 가중치 중 최소 60% 이상
  // 분석 가능해야 전체 위험등급 산출
  MIN_ANALYSIS_COVERAGE_PERCENT: 60,

  LEVELS: {
    LOW: {
      MIN: 0,
      MAX: 19,
    },

    MONITOR: {
      MIN: 20,
      MAX: 39,
    },

    CAUTION: {
      MIN: 40,
      MAX: 59,
    },

    HIGH: {
      MIN: 60,
      MAX: 100,
    },
  },
};

// Rule별 탐지 점수 유지시간
const SCORE_RETENTION = {
  RAPID_PAYMENT: {
    TYPE: "MINUTES",
    VALUE: 10,
  },
  HIGH_AMOUNT: {
    TYPE: "HOURS",
    VALUE: 24,
  },
  NIGHT_PAYMENT: {
    TYPE: "HOURS",
    VALUE: 6,
  },
  NEW_CATEGORY: {
    TYPE: "HOURS",
    VALUE: 24,
  },
  DAILY_SPEND_SPIKE: {
    TYPE: "END_OF_DAY",
  },
};

// 같은 Rule이 반복 탐지됐을 때의 처리 기준
const REPEAT_DETECTION_POLICY = {
  ADD_SCORE_ON_REPEAT: false,
  TRACK_REPEAT_COUNT: true,
  UPDATE_LAST_DETECTED_AT: true,
  REFRESH_EXPIRATION_ON_REPEAT: true,
  RESET_REPEAT_COUNT_AFTER_EXPIRATION: true,
};

// ==============================
// 외부에서 사용할 수 있도록 내보내기
// ==============================

module.exports = {
  TIMEZONE,
  MIN_VALID_AMOUNT,
  TRANSACTION_STATUS,
  RULE_STATUS,
  ANALYSIS_STATUS,
  DETECTION_TYPE,
  RAPID_PAYMENT,
  HIGH_AMOUNT,
  NIGHT_PAYMENT,
  NEW_CATEGORY,
  DAILY_SPEND_SPIKE,
  AI_REQUIREMENTS,
  RISK,
  SCORE_RETENTION,
  REPEAT_DETECTION_POLICY,
};
