const assert = require("node:assert/strict");

const { runDetection } = require("../src/services/detectionService");
const {
  updateRiskState,
  getRiskState,
} = require("../src/services/riskStateService");
const {
  TRANSACTION_STATUS,
  RULE_STATUS,
  ANALYSIS_STATUS,
  DETECTION_TYPE,
  NIGHT_PAYMENT,
  RAPID_PAYMENT,
  HIGH_AMOUNT,
  NEW_CATEGORY,
  DAILY_SPEND_SPIKE,
} = require("../src/config/constants");

let passedScenarios = 0;

function runScenario(name, testFunction) {
  testFunction();
  passedScenarios += 1;
  console.log(`PASS - ${name}`);
}

function createTransaction({
  userId,
  transactionId,
  datetime,
  amount = 10000,
  category = "FOOD",
  status = TRANSACTION_STATUS.APPROVED,
}) {
  return {
    user_id: userId,
    transaction_id: transactionId,
    transaction_datetime: datetime,
    transaction_status: status,
    amount,
    merchant_category: category,
  };
}

// 최근 30일에 일정한 소비 이력이 충분히 존재하도록 만듭니다.
function createBaseHistory(userId, currentDatetime, prefix = "BASE") {
  const currentTime = new Date(currentDatetime).getTime();
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const history = [];

  for (let dayOffset = 1; dayOffset <= 30; dayOffset += 1) {
    for (let index = 0; index < 2; index += 1) {
      const historyTime =
        currentTime - dayOffset * millisecondsPerDay + index * 60 * 1000;

      history.push(
        createTransaction({
          userId,
          transactionId: `${prefix}_${dayOffset}_${index}`,
          datetime: new Date(historyTime).toISOString(),
          amount: 30000,
          category: "FOOD",
        }),
      );
    }
  }

  return history;
}

function getRuleResult(detectionResult, type) {
  const result = detectionResult.results.find((item) => item.type === type);
  assert.ok(result, `${type} 결과가 존재해야 합니다.`);
  return result;
}

function getActiveDetection(riskState, type) {
  return riskState.activeDetections.find((item) => item.type === type);
}

function detectAndUpdate(transaction, history) {
  const detectionResult = runDetection(transaction, history);
  const riskState = updateRiskState(
    transaction.user_id,
    detectionResult.results,
    transaction.transaction_datetime,
  );

  return { detectionResult, riskState };
}

runScenario("정상 거래 전체 흐름", () => {
  const userId = "TEST_NORMAL";
  const current = createTransaction({
    userId,
    transactionId: "NORMAL_CURRENT",
    datetime: "2026-08-25T12:00:00+09:00",
  });
  const history = createBaseHistory(userId, current.transaction_datetime);
  const { detectionResult, riskState } = detectAndUpdate(current, history);

  for (const result of detectionResult.results) {
    assert.equal(result.status, RULE_STATUS.NOT_DETECTED);
  }
  assert.equal(detectionResult.ruleScore, 0);
  assert.equal(detectionResult.analysisCoveragePercent, 100);
  assert.equal(detectionResult.analysisStatus, ANALYSIS_STATUS.COMPLETE);
  assert.equal(detectionResult.riskLevel, "LOW");
  assert.deepEqual(detectionResult.detectedRules, []);
  assert.equal(riskState.activeRiskScore, 0);
  assert.equal(riskState.activeDetections.length, 0);
});

runScenario("여러 Rule 동시 탐지", () => {
  const userId = "TEST_MULTI";
  const current = createTransaction({
    userId,
    transactionId: "MULTI_CURRENT",
    datetime: "2026-08-25T02:00:00+09:00",
    amount: 90000,
    category: "GAME",
  });
  const history = createBaseHistory(userId, current.transaction_datetime);
  const { detectionResult, riskState } = detectAndUpdate(current, history);
  const expectedTypes = [
    DETECTION_TYPE.NIGHT_PAYMENT,
    DETECTION_TYPE.HIGH_AMOUNT,
    DETECTION_TYPE.NEW_CATEGORY,
  ];

  assert.equal(detectionResult.ruleScore, 50);
  assert.deepEqual(detectionResult.detectedRules, expectedTypes);
  assert.equal(riskState.activeRiskScore, 50);
  assert.equal(riskState.activeDetections.length, 3);
  for (const type of expectedTypes) {
    assert.ok(getActiveDetection(riskState, type));
  }
});

runScenario("단시간 반복 결제", () => {
  const userId = "TEST_RAPID";
  const current = createTransaction({
    userId,
    transactionId: "RAPID_CURRENT",
    datetime: "2026-08-25T10:00:00+09:00",
  });
  const history = [
    createTransaction({ userId, transactionId: "R1", datetime: "2026-08-25T09:52:00+09:00" }),
    createTransaction({ userId, transactionId: "R2", datetime: "2026-08-25T09:55:00+09:00" }),
    createTransaction({ userId, transactionId: "R3", datetime: "2026-08-25T09:58:00+09:00" }),
  ];
  const { detectionResult, riskState } = detectAndUpdate(current, history);

  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.RAPID_PAYMENT).status,
    RULE_STATUS.DETECTED,
  );
  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.RAPID_PAYMENT).score,
    RAPID_PAYMENT.SCORE,
  );
  assert.equal(riskState.activeRiskScore, RAPID_PAYMENT.SCORE);
});

runScenario("정확히 10분 경계", () => {
  const userId = "TEST_RAPID_BOUNDARY";
  const current = createTransaction({
    userId,
    transactionId: "BOUNDARY_CURRENT",
    datetime: "2026-08-25T10:00:00+09:00",
  });
  const history = [
    createTransaction({ userId, transactionId: "B1", datetime: "2026-08-25T09:50:00+09:00" }),
    createTransaction({ userId, transactionId: "B2", datetime: "2026-08-25T09:54:00+09:00" }),
    createTransaction({ userId, transactionId: "B3", datetime: "2026-08-25T09:57:00+09:00" }),
  ];
  const { detectionResult } = detectAndUpdate(current, history);

  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.RAPID_PAYMENT).status,
    RULE_STATUS.DETECTED,
  );
});

runScenario("동일 Rule 재탐지 점수 중복 금지", () => {
  const userId = "TEST_RAPID_REPEAT";
  const first = createTransaction({
    userId,
    transactionId: "REPEAT_FIRST",
    datetime: "2026-08-25T10:00:00+09:00",
  });
  const firstHistory = [
    createTransaction({ userId, transactionId: "RR1", datetime: "2026-08-25T09:52:00+09:00" }),
    createTransaction({ userId, transactionId: "RR2", datetime: "2026-08-25T09:55:00+09:00" }),
    createTransaction({ userId, transactionId: "RR3", datetime: "2026-08-25T09:58:00+09:00" }),
  ];
  detectAndUpdate(first, firstHistory);

  const second = createTransaction({
    userId,
    transactionId: "REPEAT_SECOND",
    datetime: "2026-08-25T10:07:00+09:00",
  });
  const secondHistory = [
    ...firstHistory,
    first,
    createTransaction({ userId, transactionId: "RR4", datetime: "2026-08-25T10:04:00+09:00" }),
  ];
  const { detectionResult, riskState } = detectAndUpdate(second, secondHistory);
  const activeRapid = getActiveDetection(
    riskState,
    DETECTION_TYPE.RAPID_PAYMENT,
  );

  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.RAPID_PAYMENT).status,
    RULE_STATUS.DETECTED,
  );
  assert.equal(riskState.activeRiskScore, RAPID_PAYMENT.SCORE);
  assert.equal(activeRapid.score, RAPID_PAYMENT.SCORE);
  assert.equal(activeRapid.repeatCount, 2);
  assert.equal(activeRapid.lastDetectedAt, "2026-08-25T01:07:00.000Z");
  assert.equal(activeRapid.expiresAt, "2026-08-25T01:17:00.000Z");
});

runScenario("RAPID_PAYMENT 만료", () => {
  const state = getRiskState(
    "TEST_RAPID_REPEAT",
    "2026-08-25T10:18:00+09:00",
  );

  assert.equal(state.activeRiskScore, 0);
  assert.equal(
    getActiveDetection(state, DETECTION_TYPE.RAPID_PAYMENT),
    undefined,
  );
});

runScenario("서로 다른 Rule 점수 합산", () => {
  const userId = "TEST_SUM";
  const current = createTransaction({
    userId,
    transactionId: "SUM_CURRENT",
    datetime: "2026-08-25T02:00:00+09:00",
    amount: 90000,
  });
  const history = createBaseHistory(userId, current.transaction_datetime);
  history.push(
    createTransaction({ userId, transactionId: "SUM_R1", datetime: "2026-08-25T01:52:00+09:00", amount: 1 }),
    createTransaction({ userId, transactionId: "SUM_R2", datetime: "2026-08-25T01:55:00+09:00", amount: 1 }),
    createTransaction({ userId, transactionId: "SUM_R3", datetime: "2026-08-25T01:58:00+09:00", amount: 1 }),
  );
  const { riskState } = detectAndUpdate(current, history);
  const expectedTypes = [
    DETECTION_TYPE.HIGH_AMOUNT,
    DETECTION_TYPE.RAPID_PAYMENT,
    DETECTION_TYPE.NIGHT_PAYMENT,
  ];

  assert.equal(riskState.activeRiskScore, 65);
  for (const type of expectedTypes) {
    assert.equal(
      riskState.activeDetections.filter((item) => item.type === type).length,
      1,
    );
  }
});

runScenario("같은 점수지만 서로 다른 만료시간", () => {
  const userId = "TEST_SAME_SCORE";
  const current = createTransaction({
    userId,
    transactionId: "SAME_SCORE_CURRENT",
    datetime: "2026-08-25T15:00:00+09:00",
  });
  const history = createBaseHistory(userId, current.transaction_datetime);
  history.push(
    createTransaction({ userId, transactionId: "SS_R1", datetime: "2026-08-25T14:52:00+09:00", amount: 1000 }),
    createTransaction({ userId, transactionId: "SS_R2", datetime: "2026-08-25T14:55:00+09:00", amount: 1000 }),
    createTransaction({ userId, transactionId: "SS_R3", datetime: "2026-08-25T14:58:00+09:00", amount: 1000 }),
    createTransaction({ userId, transactionId: "SS_TODAY", datetime: "2026-08-25T12:00:00+09:00", amount: 107000 }),
  );
  const { detectionResult, riskState } = detectAndUpdate(current, history);
  const rapid = getActiveDetection(riskState, DETECTION_TYPE.RAPID_PAYMENT);
  const daily = getActiveDetection(
    riskState,
    DETECTION_TYPE.DAILY_SPEND_SPIKE,
  );

  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.RAPID_PAYMENT).status,
    RULE_STATUS.DETECTED,
  );
  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.DAILY_SPEND_SPIKE).status,
    RULE_STATUS.DETECTED,
  );
  assert.equal(riskState.activeRiskScore, 50);
  assert.equal(rapid.expiresAt, "2026-08-25T06:10:00.000Z");
  assert.equal(daily.expiresAt, "2026-08-25T15:00:00.000Z");

  const laterState = getRiskState(userId, "2026-08-25T15:11:00+09:00");
  assert.equal(laterState.activeRiskScore, DAILY_SPEND_SPIKE.SCORE);
  assert.equal(
    getActiveDetection(laterState, DETECTION_TYPE.RAPID_PAYMENT),
    undefined,
  );
  assert.ok(
    getActiveDetection(laterState, DETECTION_TYPE.DAILY_SPEND_SPIKE),
  );
});

runScenario("하루 소비 급증 자정 만료", () => {
  const userId = "TEST_MIDNIGHT";
  const current = createTransaction({
    userId,
    transactionId: "MIDNIGHT_CURRENT",
    datetime: "2026-08-25T23:59:00+09:00",
  });
  const history = createBaseHistory(userId, current.transaction_datetime);
  history.push(
    createTransaction({ userId, transactionId: "MIDNIGHT_TODAY", datetime: "2026-08-25T20:00:00+09:00", amount: 110000 }),
  );
  const { riskState } = detectAndUpdate(current, history);
  const daily = getActiveDetection(
    riskState,
    DETECTION_TYPE.DAILY_SPEND_SPIKE,
  );

  assert.equal(daily.expiresAt, "2026-08-25T15:00:00.000Z");
  assert.ok(
    getActiveDetection(
      getRiskState(userId, "2026-08-25T23:59:30+09:00"),
      DETECTION_TYPE.DAILY_SPEND_SPIKE,
    ),
  );
  assert.equal(
    getActiveDetection(
      getRiskState(userId, "2026-08-26T00:00:00+09:00"),
      DETECTION_TYPE.DAILY_SPEND_SPIKE,
    ),
    undefined,
  );
});

runScenario("HIGH_AMOUNT 24시간 유지", () => {
  const userId = "TEST_HIGH_EXPIRY";
  const current = createTransaction({
    userId,
    transactionId: "HIGH_EXPIRY_CURRENT",
    datetime: "2026-08-25T10:00:00+09:00",
    amount: 90000,
  });
  const history = createBaseHistory(userId, current.transaction_datetime);
  const { riskState } = detectAndUpdate(current, history);
  const high = getActiveDetection(riskState, DETECTION_TYPE.HIGH_AMOUNT);

  assert.equal(high.expiresAt, "2026-08-26T01:00:00.000Z");
  assert.ok(
    getActiveDetection(
      getRiskState(userId, "2026-08-26T09:59:00+09:00"),
      DETECTION_TYPE.HIGH_AMOUNT,
    ),
  );
  assert.equal(
    getActiveDetection(
      getRiskState(userId, "2026-08-26T10:00:00+09:00"),
      DETECTION_TYPE.HIGH_AMOUNT,
    ),
    undefined,
  );
});

runScenario("NOT_DETECTED가 기존 위험을 삭제하지 않음", () => {
  const userId = "TEST_PRESERVE";
  const first = createTransaction({
    userId,
    transactionId: "PRESERVE_HIGH",
    datetime: "2026-08-25T10:00:00+09:00",
    amount: 90000,
  });
  const history = createBaseHistory(userId, first.transaction_datetime);
  detectAndUpdate(first, history);

  const second = createTransaction({
    userId,
    transactionId: "PRESERVE_NORMAL",
    datetime: "2026-08-25T10:05:00+09:00",
  });
  const { detectionResult, riskState } = detectAndUpdate(second, [
    ...history,
    first,
  ]);

  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.HIGH_AMOUNT).status,
    RULE_STATUS.NOT_DETECTED,
  );
  assert.equal(riskState.activeRiskScore, HIGH_AMOUNT.SCORE);
  assert.ok(getActiveDetection(riskState, DETECTION_TYPE.HIGH_AMOUNT));
});

runScenario("만료 후 같은 Rule 재탐지", () => {
  const userId = "TEST_REACTIVATE";
  const first = createTransaction({
    userId,
    transactionId: "REACTIVATE_FIRST",
    datetime: "2026-08-25T10:00:00+09:00",
  });
  const firstHistory = [
    createTransaction({ userId, transactionId: "RA1", datetime: "2026-08-25T09:52:00+09:00" }),
    createTransaction({ userId, transactionId: "RA2", datetime: "2026-08-25T09:55:00+09:00" }),
    createTransaction({ userId, transactionId: "RA3", datetime: "2026-08-25T09:58:00+09:00" }),
  ];
  detectAndUpdate(first, firstHistory);

  const second = createTransaction({
    userId,
    transactionId: "REACTIVATE_SECOND",
    datetime: "2026-08-25T10:20:00+09:00",
  });
  const secondHistory = [
    createTransaction({ userId, transactionId: "RA4", datetime: "2026-08-25T10:12:00+09:00" }),
    createTransaction({ userId, transactionId: "RA5", datetime: "2026-08-25T10:15:00+09:00" }),
    createTransaction({ userId, transactionId: "RA6", datetime: "2026-08-25T10:18:00+09:00" }),
  ];
  const { riskState } = detectAndUpdate(second, secondHistory);
  const rapid = getActiveDetection(riskState, DETECTION_TYPE.RAPID_PAYMENT);

  assert.equal(rapid.score, RAPID_PAYMENT.SCORE);
  assert.equal(rapid.repeatCount, 1);
  assert.equal(rapid.firstDetectedAt, "2026-08-25T01:20:00.000Z");
});

runScenario("사용자 상태 분리", () => {
  const highUser = "U001";
  const nightUser = "U002";
  const highCurrent = createTransaction({
    userId: highUser,
    transactionId: "U001_HIGH",
    datetime: "2026-08-25T10:00:00+09:00",
    amount: 90000,
  });
  const nightCurrent = createTransaction({
    userId: nightUser,
    transactionId: "U002_NIGHT",
    datetime: "2026-08-25T02:00:00+09:00",
  });

  detectAndUpdate(
    highCurrent,
    createBaseHistory(highUser, highCurrent.transaction_datetime, "U1"),
  );
  detectAndUpdate(nightCurrent, []);
  const highState = getRiskState(highUser, "2026-08-25T10:01:00+09:00");
  const nightState = getRiskState(nightUser, "2026-08-25T02:01:00+09:00");

  assert.equal(highState.activeRiskScore, HIGH_AMOUNT.SCORE);
  assert.equal(nightState.activeRiskScore, NIGHT_PAYMENT.SCORE);
  assert.equal(
    getActiveDetection(highState, DETECTION_TYPE.NIGHT_PAYMENT),
    undefined,
  );
  assert.equal(
    getActiveDetection(nightState, DETECTION_TYPE.HIGH_AMOUNT),
    undefined,
  );
});

runScenario("신규 사용자와 거래 이력 부족", () => {
  const userId = "TEST_NEW_USER";
  const current = createTransaction({
    userId,
    transactionId: "NEW_USER_CURRENT",
    datetime: "2026-08-25T12:00:00+09:00",
  });
  const detectionResult = runDetection(current, []);

  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.NIGHT_PAYMENT).status,
    RULE_STATUS.NOT_DETECTED,
  );
  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.RAPID_PAYMENT).status,
    RULE_STATUS.NOT_DETECTED,
  );
  for (const type of [
    DETECTION_TYPE.HIGH_AMOUNT,
    DETECTION_TYPE.NEW_CATEGORY,
    DETECTION_TYPE.DAILY_SPEND_SPIKE,
  ]) {
    assert.equal(
      getRuleResult(detectionResult, type).status,
      RULE_STATUS.INSUFFICIENT_HISTORY,
    );
  }
  assert.equal(detectionResult.analysisCoveragePercent, 35);
  assert.equal(detectionResult.analysisStatus, ANALYSIS_STATUS.LIMITED);
  assert.equal(detectionResult.riskLevel, null);
});

runScenario("취소 환불 실패 거래", () => {
  const userId = "TEST_IGNORED";
  const activeCurrent = createTransaction({
    userId,
    transactionId: "IGNORED_ACTIVE",
    datetime: "2026-08-25T02:00:00+09:00",
  });
  detectAndUpdate(activeCurrent, []);

  for (const [index, status] of [
    TRANSACTION_STATUS.CANCELLED,
    TRANSACTION_STATUS.REFUNDED,
    TRANSACTION_STATUS.FAILED,
  ].entries()) {
    const current = createTransaction({
      userId,
      transactionId: `IGNORED_${status}`,
      datetime: `2026-08-25T02:0${index + 1}:00+09:00`,
      status,
    });
    const { detectionResult, riskState } = detectAndUpdate(current, []);

    assert.equal(detectionResult.results.length, 5);
    for (const result of detectionResult.results) {
      assert.equal(result.status, RULE_STATUS.IGNORED_TRANSACTION);
    }
    assert.equal(riskState.activeRiskScore, NIGHT_PAYMENT.SCORE);
    assert.equal(riskState.activeDetections.length, 1);
  }
});

runScenario("다른 사용자 과거 거래 제외", () => {
  const userId = "TEST_OTHER_USER";
  const current = createTransaction({
    userId,
    transactionId: "OTHER_USER_CURRENT",
    datetime: "2026-08-25T12:00:00+09:00",
    amount: 90000,
    category: "GAME",
  });
  const otherHistory = createBaseHistory(
    "OTHER_ACCOUNT",
    current.transaction_datetime,
    "OTHER",
  );
  otherHistory.push(
    createTransaction({ userId: "OTHER_ACCOUNT", transactionId: "O_R1", datetime: "2026-08-25T11:52:00+09:00" }),
    createTransaction({ userId: "OTHER_ACCOUNT", transactionId: "O_R2", datetime: "2026-08-25T11:55:00+09:00" }),
    createTransaction({ userId: "OTHER_ACCOUNT", transactionId: "O_R3", datetime: "2026-08-25T11:58:00+09:00" }),
  );
  const detectionResult = runDetection(current, otherHistory);

  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.RAPID_PAYMENT).status,
    RULE_STATUS.NOT_DETECTED,
  );
  for (const type of [
    DETECTION_TYPE.HIGH_AMOUNT,
    DETECTION_TYPE.NEW_CATEGORY,
    DETECTION_TYPE.DAILY_SPEND_SPIKE,
  ]) {
    assert.equal(
      getRuleResult(detectionResult, type).status,
      RULE_STATUS.INSUFFICIENT_HISTORY,
    );
  }
});

runScenario("중복 transaction_id", () => {
  const userId = "TEST_DUPLICATE";
  const current = createTransaction({
    userId,
    transactionId: "DUP_CURRENT",
    datetime: "2026-08-25T10:00:00+09:00",
  });
  const duplicate = createTransaction({
    userId,
    transactionId: "DUP_SAME",
    datetime: "2026-08-25T09:55:00+09:00",
  });
  const history = [
    duplicate,
    { ...duplicate },
    createTransaction({ userId, transactionId: "DUP_UNIQUE", datetime: "2026-08-25T09:58:00+09:00" }),
  ];
  const detectionResult = runDetection(current, history);

  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.RAPID_PAYMENT).status,
    RULE_STATUS.NOT_DETECTED,
  );
});

runScenario("현재 거래 중복 포함", () => {
  const userId = "TEST_CURRENT_DUPLICATE";
  const current = createTransaction({
    userId,
    transactionId: "CURRENT_DUP",
    datetime: "2026-08-25T10:00:00+09:00",
  });
  const history = [
    { ...current },
    { ...current },
    createTransaction({ userId, transactionId: "CD1", datetime: "2026-08-25T09:55:00+09:00" }),
    createTransaction({ userId, transactionId: "CD2", datetime: "2026-08-25T09:58:00+09:00" }),
  ];
  const detectionResult = runDetection(current, history);

  assert.equal(
    getRuleResult(detectionResult, DETECTION_TYPE.RAPID_PAYMENT).status,
    RULE_STATUS.NOT_DETECTED,
  );
  assert.equal(detectionResult.results.length, 5);
});

runScenario("잘못된 현재 거래 데이터", () => {
  const base = createTransaction({
    userId: "TEST_INVALID",
    transactionId: "INVALID_CURRENT",
    datetime: "2026-08-25T12:00:00+09:00",
  });
  const invalidTransactions = [
    { ...base, amount: null, transaction_id: "INVALID_NULL" },
    { ...base, amount: 0, transaction_id: "INVALID_ZERO" },
    { ...base, transaction_datetime: "not-a-date", transaction_id: "INVALID_DATE" },
    { ...base, user_id: undefined, transaction_id: "INVALID_USER" },
    { ...base, transaction_id: undefined },
  ];

  for (const transaction of invalidTransactions) {
    const detectionResult = runDetection(transaction, []);

    assert.equal(detectionResult.results.length, 5);
    assert.ok(
      detectionResult.results.some(
        (result) => result.status === RULE_STATUS.INVALID_DATA,
      ),
    );
  }
});

runScenario("전체 결과 구조", () => {
  const userId = "TEST_STRUCTURE";
  const current = createTransaction({
    userId,
    transactionId: "STRUCTURE_CURRENT",
    datetime: "2026-08-25T12:00:00+09:00",
  });
  const history = createBaseHistory(userId, current.transaction_datetime);
  const { detectionResult, riskState } = detectAndUpdate(current, history);

  for (const field of [
    "transactionId",
    "analysisStatus",
    "analysisCoveragePercent",
    "ruleScore",
    "riskLevel",
    "detectedRules",
    "results",
  ]) {
    assert.ok(Object.hasOwn(detectionResult, field));
  }
  assert.equal(detectionResult.results.length, 5);

  for (const field of [
    "userId",
    "referenceTime",
    "activeRiskScore",
    "activeDetections",
  ]) {
    assert.ok(Object.hasOwn(riskState, field));
  }
});

console.log("================================");
console.log("통합 테스트 전체 통과");
console.log(`총 ${passedScenarios}개 시나리오 PASS`);
console.log("================================");
