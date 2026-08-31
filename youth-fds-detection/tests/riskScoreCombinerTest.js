const assert = require("node:assert/strict");

let passedTests = 0;
let failedTests = 0;

function runTest(name, testFunction) {
  try {
    testFunction();
    passedTests += 1;
    console.log(`PASS - ${name}`);
  } catch (error) {
    failedTests += 1;
    process.exitCode = 1;
    console.error(`FAIL - ${name}: ${error.message}`);
  }
}

let combiner;
runTest("모듈 require 성공", () => {
  combiner = require("../src/services/riskScoreCombiner");
  assert.equal(typeof combiner.combineRiskScore, "function");
});

runTest("RULE_WEIGHT === 0.7", () => assert.equal(combiner.RULE_WEIGHT, 0.7));
runTest("AI_WEIGHT === 0.3", () => assert.equal(combiner.AI_WEIGHT, 0.3));
runTest("가중치 합 === 1", () => {
  assert.ok(Math.abs(combiner.RULE_WEIGHT + combiner.AI_WEIGHT - 1) < 1e-12);
});

const { combineRiskScore } = combiner;

runTest("Rule 60 AI 80", () => {
  const result = combineRiskScore(60, 80);
  assert.equal(result.weightedScore, 66);
  assert.equal(result.combinedScore, 66);
});
runTest("Rule 20 AI 100", () => assert.equal(combineRiskScore(20, 100).combinedScore, 44));
runTest("Rule 독립 영향", () => assert.equal(combineRiskScore(100, 0).combinedScore, 70));
runTest("AI 독립 영향", () => assert.equal(combineRiskScore(0, 100).combinedScore, 30));
runTest("최대 점수", () => assert.equal(combineRiskScore(100, 100).combinedScore, 100));
runTest("최소 점수", () => assert.equal(combineRiskScore(0, 0).combinedScore, 0));
runTest("Rule 55 AI 84", () => {
  const result = combineRiskScore(55, 84);
  assert.ok(Math.abs(result.weightedScore - 63.7) < 1e-12);
  assert.equal(result.combinedScore, 64);
});
runTest("Rule 30 AI 0", () => assert.equal(combineRiskScore(30, 0).combinedScore, 21));
runTest("Rule 0 AI 80", () => assert.equal(combineRiskScore(0, 80).combinedScore, 24));
runTest("동일 점수 입력", () => assert.equal(combineRiskScore(50, 50).combinedScore, 50));
runTest("소수 입력", () => {
  const result = combineRiskScore(50.5, 70.5);
  assert.ok(Math.abs(result.weightedScore - 56.5) < 1e-12);
  assert.equal(result.combinedScore, Math.round(result.weightedScore));
});
runTest("combinedScore 정수", () => assert.equal(Number.isInteger(combineRiskScore(50.5, 70.5).combinedScore), true));
runTest("combinedScore 0~100", () => {
  const score = combineRiskScore(99.9, 0.1).combinedScore;
  assert.ok(score >= 0 && score <= 100);
});
runTest("weightedScore finite", () => assert.equal(Number.isFinite(combineRiskScore(50.5, 70.5).weightedScore), true));
runTest("반환 구조", () => {
  assert.deepEqual(Object.keys(combineRiskScore(60, 80)), [
    "ruleScore", "calibratedAiScore", "ruleWeight", "aiWeight",
    "weightedScore", "combinedScore",
  ]);
});
runTest("입력 ruleScore 유지", () => assert.equal(combineRiskScore(50.5, 80).ruleScore, 50.5));
runTest("입력 calibratedAiScore 유지", () => assert.equal(combineRiskScore(50, 80.5).calibratedAiScore, 80.5));
runTest("반환 ruleWeight 0.7", () => assert.equal(combineRiskScore(50, 50).ruleWeight, 0.7));
runTest("반환 aiWeight 0.3", () => assert.equal(combineRiskScore(50, 50).aiWeight, 0.3));

for (const [label, value] of [
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["문자열", "50"],
  ["null", null],
  ["undefined", undefined],
  ["음수", -1],
  ["100 초과", 101],
]) {
  runTest(`잘못된 Rule Score 거부: ${label}`, () => {
    assert.throws(() => combineRiskScore(value, 50), TypeError);
  });
}

for (const [label, value] of [
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["문자열", "80"],
  ["null", null],
  ["undefined", undefined],
  ["음수", -1],
  ["100 초과", 101],
]) {
  runTest(`잘못된 AI Score 거부: ${label}`, () => {
    assert.throws(() => combineRiskScore(50, value), TypeError);
  });
}

runTest("fraudProbability 미포함", () => assert.equal(Object.hasOwn(combineRiskScore(50, 50), "fraudProbability"), false));
runTest("Risk Level 미포함", () => assert.equal(Object.hasOwn(combineRiskScore(50, 50), "riskLevel"), false));
runTest("detectedRules 미포함", () => assert.equal(Object.hasOwn(combineRiskScore(50, 50), "detectedRules"), false));
runTest("features 미포함", () => assert.equal(Object.hasOwn(combineRiskScore(50, 50), "features"), false));

console.log("================================");
console.log("Risk Score Combiner 테스트 완료");
console.log(`PASS: ${passedTests}`);
console.log(`FAIL: ${failedTests}`);
console.log("================================");
