const assert = require("node:assert/strict");

const {
  START_PERCENTILE,
  calibrateAiScore,
} = require("../src/ai/aiScoreCalibrator");

const failures = [];
let passCount = 0;

function runTest(name, testFunction) {
  try {
    testFunction();
    passCount += 1;
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL - ${name}: ${error.message}`);
  }
}

function assertCalibratedScore(percentile, expectedScore) {
  const result = calibrateAiScore(percentile);
  assert.equal(result.percentile, percentile);
  assert.equal(result.calibratedAiScore, expectedScore);
}

runTest("모듈 require 성공", () => {
  assert.equal(typeof calibrateAiScore, "function");
});

runTest("START_PERCENTILE 값", () => {
  assert.equal(START_PERCENTILE, 90);
});

runTest("0 percentile", () => {
  assertCalibratedScore(0, 0);
});

runTest("50 percentile", () => {
  assertCalibratedScore(50, 0);
});

runTest("89 percentile", () => {
  assertCalibratedScore(89, 0);
});

runTest("90 percentile", () => {
  assertCalibratedScore(90, 0);
});

runTest("91 percentile", () => {
  assertCalibratedScore(91, 10);
});

runTest("92 percentile", () => {
  assertCalibratedScore(92, 20);
});

runTest("95 percentile", () => {
  assertCalibratedScore(95, 50);
});

runTest("98 percentile", () => {
  assertCalibratedScore(98, 80);
});

runTest("99 percentile", () => {
  assertCalibratedScore(99, 90);
});

runTest("100 percentile", () => {
  assertCalibratedScore(100, 100);
});

runTest("96.5 percentile", () => {
  assertCalibratedScore(96.5, 65);
});

runTest("소수 percentile 반올림", () => {
  assertCalibratedScore(96.54, 65);
  assertCalibratedScore(96.56, 66);
});

runTest("NaN 거부", () => {
  assert.throws(() => calibrateAiScore(NaN), TypeError);
});

runTest("Infinity 거부", () => {
  assert.throws(() => calibrateAiScore(Infinity), TypeError);
});

runTest("-Infinity 거부", () => {
  assert.throws(() => calibrateAiScore(-Infinity), TypeError);
});

runTest("문자열 거부", () => {
  assert.throws(() => calibrateAiScore("95"), TypeError);
});

runTest("null 거부", () => {
  assert.throws(() => calibrateAiScore(null), TypeError);
});

runTest("undefined 거부", () => {
  assert.throws(() => calibrateAiScore(undefined), TypeError);
});

runTest("음수 percentile 거부", () => {
  assert.throws(() => calibrateAiScore(-1), TypeError);
});

runTest("100 초과 percentile 거부", () => {
  assert.throws(() => calibrateAiScore(101), TypeError);
});

runTest("반환 필드 확인", () => {
  const result = calibrateAiScore(98);
  assert.deepEqual(Object.keys(result), ["percentile", "calibratedAiScore"]);
});

runTest("calibratedAiScore 정수", () => {
  assert.equal(Number.isInteger(calibrateAiScore(96.56).calibratedAiScore), true);
});

runTest("calibratedAiScore 0~100 범위", () => {
  for (const percentile of [0, 50, 90, 91, 95, 99, 100]) {
    const { calibratedAiScore } = calibrateAiScore(percentile);
    assert.ok(calibratedAiScore >= 0 && calibratedAiScore <= 100);
  }
});

runTest("입력 percentile 유지", () => {
  const percentile = 96.54;
  assert.equal(calibrateAiScore(percentile).percentile, percentile);
});

console.log("================================");
console.log("AI Score Calibrator 테스트 완료");
console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failures.length}`);
console.log("================================");

if (failures.length > 0) {
  process.exitCode = 1;
}
