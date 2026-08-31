const assert = require("node:assert/strict");

const {
  normalizeAiScore,
} = require("../src/ai/aiScoreNormalizer");

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

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${expected}, actual ${actual}`,
  );
}

runTest("normalizeAiScore require 성공", () => {
  assert.equal(typeof normalizeAiScore, "function");
});

runTest("일반 percentile 계산", () => {
  const result = normalizeAiScore(0.5, [0.4, 0.45, 0.5, 0.55]);
  assertClose(result.percentile, 62.5);
  assert.equal(result.aiScore, 63);
});

runTest("최솟값 아래", () => {
  const result = normalizeAiScore(0.3, [0.4, 0.45, 0.5, 0.55]);
  assert.equal(result.percentile, 0);
  assert.equal(result.aiScore, 0);
});

runTest("최댓값 위", () => {
  const result = normalizeAiScore(0.7, [0.4, 0.45, 0.5, 0.55]);
  assert.equal(result.percentile, 100);
  assert.equal(result.aiScore, 100);
});

runTest("모든 기준 score 동일", () => {
  const result = normalizeAiScore(0.5, [0.5, 0.5, 0.5, 0.5]);
  assert.equal(result.percentile, 50);
  assert.equal(result.aiScore, 50);
});

runTest("동점 중간 순위", () => {
  const result = normalizeAiScore(0.5, [0.4, 0.5, 0.5, 0.5, 0.6]);
  assert.equal(result.percentile, 50);
  assert.equal(result.aiScore, 50);
});

runTest("rawScore NaN 거부", () => {
  assert.throws(() => normalizeAiScore(NaN, [0.5]), TypeError);
});

runTest("rawScore Infinity 거부", () => {
  assert.throws(() => normalizeAiScore(Infinity, [0.5]), TypeError);
});

runTest("rawScore 문자열 거부", () => {
  assert.throws(() => normalizeAiScore("0.5", [0.5]), TypeError);
});

runTest("빈 referenceScores 거부", () => {
  assert.throws(() => normalizeAiScore(0.5, []), TypeError);
});

runTest("배열이 아닌 referenceScores 거부", () => {
  assert.throws(() => normalizeAiScore(0.5, {}), TypeError);
});

runTest("referenceScores 내부 NaN 거부", () => {
  assert.throws(() => normalizeAiScore(0.5, [0.4, NaN]), TypeError);
});

runTest("referenceScores 내부 Infinity 거부", () => {
  assert.throws(() => normalizeAiScore(0.5, [0.4, Infinity]), TypeError);
});

runTest("referenceScores 내부 문자열 거부", () => {
  assert.throws(() => normalizeAiScore(0.5, [0.4, "0.5"]), TypeError);
});

runTest("원본 배열 mutation 없음", () => {
  const referenceScores = [0.6, 0.4, 0.5];
  const snapshot = [...referenceScores];
  normalizeAiScore(0.5, referenceScores);
  assert.deepEqual(referenceScores, snapshot);
});

runTest("반환 필드 확인", () => {
  const result = normalizeAiScore(0.5, [0.4, 0.5, 0.6]);
  assert.deepEqual(Object.keys(result), ["rawScore", "percentile", "aiScore"]);
});

runTest("aiScore 정수 확인", () => {
  const result = normalizeAiScore(0.5, [0.4, 0.45, 0.5, 0.55]);
  assert.equal(Number.isInteger(result.aiScore), true);
});

runTest("aiScore 0~100 범위", () => {
  for (const rawScore of [-10, 0.5, 10]) {
    const { aiScore } = normalizeAiScore(rawScore, [0.4, 0.5, 0.6]);
    assert.ok(aiScore >= 0 && aiScore <= 100);
  }
});

runTest("percentile 0~100 범위", () => {
  for (const rawScore of [-10, 0.5, 10]) {
    const { percentile } = normalizeAiScore(rawScore, [0.4, 0.5, 0.6]);
    assert.ok(percentile >= 0 && percentile <= 100);
  }
});

runTest("입력 순서 무관", () => {
  const first = normalizeAiScore(0.5, [0.4, 0.5, 0.6]);
  const second = normalizeAiScore(0.5, [0.6, 0.4, 0.5]);
  assert.deepEqual(second, first);
});

console.log("================================");
console.log("AI Score Normalizer 테스트 완료");
console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failures.length}`);
console.log("================================");

if (failures.length > 0) {
  process.exitCode = 1;
}
