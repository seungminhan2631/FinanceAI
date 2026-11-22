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

let service;
runTest("모듈 require", () => {
  service = require("../src/services/riskLevelService");
  assert.ok(service);
});
runTest("getRiskLevel 함수 존재", () => assert.equal(typeof service.getRiskLevel, "function"));
runTest("RISK_LEVEL LOW", () => assert.equal(service.RISK_LEVEL.LOW, "LOW"));
runTest("RISK_LEVEL MONITOR", () => assert.equal(service.RISK_LEVEL.MONITOR, "MONITOR"));
runTest("RISK_LEVEL CAUTION", () => assert.equal(service.RISK_LEVEL.CAUTION, "CAUTION"));
runTest("RISK_LEVEL HIGH", () => assert.equal(service.RISK_LEVEL.HIGH, "HIGH"));
runTest("MONITOR 최소값", () => assert.equal(service.RISK_LEVEL_THRESHOLDS.MONITOR_MIN, 10));
runTest("CAUTION 최소값", () => assert.equal(service.RISK_LEVEL_THRESHOLDS.CAUTION_MIN, 30));
runTest("HIGH 최소값", () => assert.equal(service.RISK_LEVEL_THRESHOLDS.HIGH_MIN, 50));

const boundaryCases = [
  [0, "LOW"], [1, "LOW"], [9, "LOW"],
  [10, "MONITOR"], [11, "MONITOR"], [29, "MONITOR"],
  [30, "CAUTION"], [31, "CAUTION"], [49, "CAUTION"],
  [50, "HIGH"], [51, "HIGH"], [100, "HIGH"],
  [7, "LOW"], [18, "MONITOR"], [41, "CAUTION"], [66, "HIGH"],
];

for (const [score, expected] of boundaryCases) {
  runTest(`score ${score} -> ${expected}`, () => {
    const result = service.getRiskLevel(score);
    assert.equal(result, expected);
    assert.equal(typeof result, "string");
  });
}

const classifiedLevels = [];
runTest("0~100 전체 범위", () => {
  for (let score = 0; score <= 100; score += 1) {
    const result = service.getRiskLevel(score);
    assert.ok(Object.values(service.RISK_LEVEL).includes(result));
    classifiedLevels.push(result);
  }
  assert.equal(classifiedLevels.length, 101);
});
runTest("LOW score 개수", () => assert.equal(classifiedLevels.filter((level) => level === "LOW").length, 10));
runTest("MONITOR score 개수", () => assert.equal(classifiedLevels.filter((level) => level === "MONITOR").length, 20));
runTest("CAUTION score 개수", () => assert.equal(classifiedLevels.filter((level) => level === "CAUTION").length, 20));
runTest("HIGH score 개수", () => assert.equal(classifiedLevels.filter((level) => level === "HIGH").length, 51));
runTest("전체 score 개수", () => assert.equal(classifiedLevels.length, 101));
runTest("모든 결과가 상수 값 중 하나", () => {
  assert.equal(classifiedLevels.every((level) => Object.values(service.RISK_LEVEL).includes(level)), true);
});

for (const [label, value] of [
  ["NaN", NaN], ["Infinity", Infinity], ["-Infinity", -Infinity],
  ["문자열", "50"], ["null", null], ["undefined", undefined],
  ["음수", -1], ["100 초과", 101], ["소수 10.5", 10.5],
  ["소수 49.9", 49.9], ["빈 문자열", ""], ["boolean true", true],
  ["boolean false", false], ["객체", {}], ["배열", []],
]) {
  runTest(`잘못된 입력 TypeError: ${label}`, () => {
    assert.throws(() => service.getRiskLevel(value), TypeError);
  });
}

runTest("반환값에 불필요한 필드 없음", () => {
  const result = service.getRiskLevel(41);
  assert.equal(typeof result, "string");
  for (const field of [
    "fraudProbability", "combinedScore", "ruleScore",
    "calibratedAiScore", "detectedRules",
  ]) {
    assert.equal(Object.hasOwn(Object(result), field), false);
  }
});

console.log("================================");
console.log("Risk Level Service 테스트 완료");
console.log(`PASS: ${passedTests}`);
console.log(`FAIL: ${failedTests}`);
console.log("================================");
