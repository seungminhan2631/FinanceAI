const {
  TIMEZONE,
  RULE_STATUS,
  DETECTION_TYPE,
  SCORE_RETENTION,
  REPEAT_DETECTION_POLICY,
  RISK,
} = require("../config/constants");

// 사용자별 활성 Rule 상태를 메모리에 저장합니다.
const userRiskStates = new Map();

const RETENTION_BY_TYPE = {
  [DETECTION_TYPE.RAPID_PAYMENT]: SCORE_RETENTION.RAPID_PAYMENT,
  [DETECTION_TYPE.HIGH_AMOUNT]: SCORE_RETENTION.HIGH_AMOUNT,
  [DETECTION_TYPE.NIGHT_PAYMENT]: SCORE_RETENTION.NIGHT_PAYMENT,
  [DETECTION_TYPE.NEW_CATEGORY]: SCORE_RETENTION.NEW_CATEGORY,
  [DETECTION_TYPE.DAILY_SPEND_SPIKE]: SCORE_RETENTION.DAILY_SPEND_SPIKE,
};

// 입력된 시간값을 유효한 Date 객체로 변환합니다.
function parseDate(value, fieldName) {
  if (value === null || value === undefined || value === "") {
    throw new TypeError(`${fieldName}이(가) 유효한 날짜가 아닙니다.`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${fieldName}이(가) 유효한 날짜가 아닙니다.`);
  }

  return date;
}

// 설정된 시간대에서 보이는 연월일시를 숫자로 가져옵니다.
function getZonedDateParts(date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  return values;
}

// 특정 시각에 설정된 시간대가 UTC와 얼마나 차이 나는지 계산합니다.
function getTimeZoneOffset(date) {
  const parts = getZonedDateParts(date);
  const zonedTimeAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return zonedTimeAsUtc - date.getTime();
}

// 설정된 시간대 기준 다음 날짜 00:00의 실제 시각을 구합니다.
function getNextDayStart(date) {
  const parts = getZonedDateParts(date);
  const nextCalendarDate = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + 1),
  );
  const targetWallTime = Date.UTC(
    nextCalendarDate.getUTCFullYear(),
    nextCalendarDate.getUTCMonth(),
    nextCalendarDate.getUTCDate(),
  );

  let result = new Date(targetWallTime);
  result = new Date(targetWallTime - getTimeZoneOffset(result));
  result = new Date(targetWallTime - getTimeZoneOffset(result));

  return result;
}

// Rule 종류에 설정된 정책을 이용해 만료시간을 계산합니다.
function calculateExpiresAt(type, detectedAt) {
  const retention = RETENTION_BY_TYPE[type];

  if (!retention) {
    throw new TypeError(`지원하지 않는 탐지 Rule입니다: ${type}`);
  }

  if (retention.TYPE === "MINUTES") {
    return new Date(detectedAt.getTime() + retention.VALUE * 60 * 1000);
  }

  if (retention.TYPE === "HOURS") {
    return new Date(detectedAt.getTime() + retention.VALUE * 60 * 60 * 1000);
  }

  if (retention.TYPE === "END_OF_DAY") {
    return getNextDayStart(detectedAt);
  }

  throw new TypeError(`지원하지 않는 점수 유지 정책입니다: ${retention.TYPE}`);
}

// 기준시각에 이미 만료된 Rule만 사용자 상태에서 제거합니다.
function removeExpiredDetections(userId, referenceDate) {
  const userDetections = userRiskStates.get(userId);

  if (!userDetections) {
    return;
  }

  for (const [type, detection] of userDetections) {
    if (referenceDate.getTime() >= new Date(detection.expiresAt).getTime()) {
      userDetections.delete(type);
    }
  }

  if (userDetections.size === 0) {
    userRiskStates.delete(userId);
  }
}

// 현재 활성 상태인 서로 다른 Rule의 점수만 합산합니다.
function calculateActiveRiskScore(activeDetections) {
  const totalScore = activeDetections.reduce(
    (sum, detection) => sum + detection.score,
    0,
  );

  return Math.min(totalScore, RISK.MAX_SCORE);
}

// 현재 사용자의 활성 Rule을 조회하고 만료된 상태를 제거합니다.
function getRiskState(userId, referenceTime) {
  const referenceDate = parseDate(referenceTime, "referenceTime");
  removeExpiredDetections(userId, referenceDate);

  const userDetections = userRiskStates.get(userId);
  const activeDetections = userDetections
    ? Array.from(userDetections.values(), (detection) => ({ ...detection }))
    : [];

  return {
    userId,
    referenceTime: referenceDate.toISOString(),
    activeRiskScore: calculateActiveRiskScore(activeDetections),
    activeDetections,
  };
}

// 새 Rule 결과를 반영하고 현재 사용자의 활성 위험 상태를 반환합니다.
function updateRiskState(userId, ruleResults, detectedAt) {
  const detectedDate = parseDate(detectedAt, "detectedAt");

  if (!Array.isArray(ruleResults)) {
    throw new TypeError("ruleResults는 배열이어야 합니다.");
  }

  // 새 탐지를 반영하기 전에 기존의 만료된 Rule을 제거합니다.
  removeExpiredDetections(userId, detectedDate);

  const detectedResults = ruleResults.filter(
    (result) =>
      result &&
      result.status === RULE_STATUS.DETECTED &&
      result.detected === true &&
      typeof result.score === "number" &&
      Number.isFinite(result.score) &&
      result.score >= 0,
  );

  for (const result of detectedResults) {
    const expiresAt = calculateExpiresAt(result.type, detectedDate);
    let userDetections = userRiskStates.get(userId);

    if (!userDetections) {
      userDetections = new Map();
      userRiskStates.set(userId, userDetections);
    }

    const existingDetection = userDetections.get(result.type);

    if (!existingDetection) {
      const detectedAtIso = detectedDate.toISOString();

      userDetections.set(result.type, {
        type: result.type,
        score: result.score,
        repeatCount: 1,
        firstDetectedAt: detectedAtIso,
        lastDetectedAt: detectedAtIso,
        expiresAt: expiresAt.toISOString(),
      });
      continue;
    }

    // 같은 Rule 재탐지 시 설정에 따라 반복 정보와 만료시간을 갱신합니다.
    if (REPEAT_DETECTION_POLICY.ADD_SCORE_ON_REPEAT) {
      existingDetection.score += result.score;
    }

    if (REPEAT_DETECTION_POLICY.TRACK_REPEAT_COUNT) {
      existingDetection.repeatCount += 1;
    }

    if (REPEAT_DETECTION_POLICY.UPDATE_LAST_DETECTED_AT) {
      existingDetection.lastDetectedAt = detectedDate.toISOString();
    }

    if (REPEAT_DETECTION_POLICY.REFRESH_EXPIRATION_ON_REPEAT) {
      existingDetection.expiresAt = expiresAt.toISOString();
    }
  }

  return getRiskState(userId, detectedDate);
}

module.exports = {
  updateRiskState,
  getRiskState,
};
