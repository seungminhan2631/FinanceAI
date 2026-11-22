const assert = require("node:assert/strict");
const path = require("node:path");

const DATABASE_DIR = "C:\\Users\\dtdt7\\FinanceAI\\database";
const EXPECTED_TRANSACTION_COUNT = 312;
const REQUIRED_TRANSACTION_FIELDS = [
  "user_id",
  "transaction_id",
  "amount",
  "transaction_datetime",
  "merchant_category",
  "transaction_status",
];
const FEATURE_NAMES = [
  "amountRatio",
  "amountZScore",
  "recent10MinCount",
  "averageTransactionInterval",
  "timeSlotFrequency",
  "categoryFrequency",
  "dailySpendRatio",
];

const { buildTrainingFeatures } = require("../src/ai/trainingDataBuilder");

let close;
let currentStep = "모듈 연결";

function printTransaction(label, transaction) {
  console.log(`${label}:`);
  console.log({
    transaction_id: transaction.transaction_id,
    user_id: transaction.user_id,
    transaction_datetime: transaction.transaction_datetime,
  });
}

function failDetails(error) {
  console.error("========================================");
  console.error("DB → Training Data Builder 통합 테스트 실패");
  console.error("========================================");
  console.error(`실패한 단계: ${currentStep}`);
  console.error(`오류 메시지: ${error.message}`);
  if (error.expected !== undefined) {
    console.error("예상 결과:", error.expected);
  }
  if (error.actual !== undefined) {
    console.error("실제 결과:", error.actual);
  }
  console.error(
    "추정 원인: DB 연결/조회 결과 또는 trainingDataBuilder 반환값이 검증 조건과 다릅니다.",
  );
}

async function run() {
  try {
    console.log("========================================");
    console.log("DB → Training Data Builder 통합 테스트");
    console.log("========================================");

    currentStep = "DB repository 연결";
    const originalWorkingDirectory = process.cwd();
    let repo;
    try {
      // db.js의 dotenv 설정이 FinanceAI/database/.env를 찾도록 연결 시에만
      // 작업 디렉터리를 바꾸고, 모듈 로드 직후 원래 위치로 복원합니다.
      process.chdir(DATABASE_DIR);
      repo = require(path.join(DATABASE_DIR, "transactionRepository.js"));
      ({ close } = require(path.join(DATABASE_DIR, "db.js")));
    } finally {
      process.chdir(originalWorkingDirectory);
    }
    assert.equal(typeof repo.getAllTransactions, "function");
    assert.equal(typeof close, "function");
    console.log("PASS - DB repository 연결");

    currentStep = "DB 전체 거래 조회";
    const transactions = await repo.getAllTransactions();
    assert.equal(Array.isArray(transactions), true);
    assert.equal(transactions.length, EXPECTED_TRANSACTION_COUNT);
    console.log("PASS - DB 전체 거래 조회");
    console.log(`INFO - DB transactions: ${transactions.length}`);
    printTransaction("INFO - First transaction", transactions[0]);
    printTransaction(
      "INFO - Last transaction",
      transactions[transactions.length - 1],
    );

    currentStep = "원본 거래 필드 확인";
    for (const transaction of transactions) {
      for (const field of REQUIRED_TRANSACTION_FIELDS) {
        assert.equal(
          Object.hasOwn(transaction, field),
          true,
          `${transaction.transaction_id || "알 수 없는 거래"}에 ${field} 필드가 없습니다.`,
        );
      }
    }
    console.log("PASS - 원본 거래 필드 확인");
    console.log("INFO - First raw transaction:");
    console.log(transactions[0]);

    currentStep = "Training Data Builder 연결";
    const transactionsSnapshot = JSON.stringify(transactions);
    const trainingResult = buildTrainingFeatures(transactions);
    console.log("PASS - Training Data Builder 연결");

    currentStep = "Training Data Builder 반환 결과 확인";
    assert.equal(trainingResult.totalTransactions, EXPECTED_TRANSACTION_COUNT);
    assert.ok(trainingResult.usableFeatureCount > 0);
    assert.ok(trainingResult.skippedFeatureCount > 0);
    assert.equal(
      trainingResult.trainingFeatures.length,
      trainingResult.usableFeatureCount,
    );
    console.log(
      `INFO - Total transactions: ${trainingResult.totalTransactions}`,
    );
    console.log(`INFO - Usable features: ${trainingResult.usableFeatureCount}`);
    console.log(
      `INFO - Skipped transactions: ${trainingResult.skippedFeatureCount}`,
    );
    console.log("INFO - Skipped reasons:");
    console.log(trainingResult.skippedReasons);

    currentStep = "total = usable + skipped 확인";
    assert.equal(
      trainingResult.usableFeatureCount + trainingResult.skippedFeatureCount,
      trainingResult.totalTransactions,
    );
    console.log("PASS - total = usable + skipped");

    currentStep = "Feature 7개 구조 확인";
    for (const feature of trainingResult.trainingFeatures) {
      assert.deepEqual(Object.keys(feature), FEATURE_NAMES);
      for (const rawField of REQUIRED_TRANSACTION_FIELDS) {
        assert.equal(Object.hasOwn(feature, rawField), false);
      }
    }
    console.log("PASS - Feature 7개 구조");

    currentStep = "모든 Feature finite number 확인";
    for (const feature of trainingResult.trainingFeatures) {
      for (const featureName of FEATURE_NAMES) {
        assert.equal(typeof feature[featureName], "number");
        assert.equal(Number.isFinite(feature[featureName]), true);
      }
    }
    console.log("PASS - 모든 Feature finite number");

    currentStep = "원본 거래 mutation 확인";
    assert.equal(JSON.stringify(transactions), transactionsSnapshot);
    console.log("PASS - 원본 거래 mutation 없음");

    console.log("INFO - First training feature:");
    console.log(trainingResult.trainingFeatures[0]);
    console.log("========================================");
    console.log("DB → AI 학습 데이터 생성 성공");
    console.log("========================================");
  } catch (error) {
    failDetails(error);
    process.exitCode = 1;
  } finally {
    if (typeof close === "function") {
      try {
        await close();
      } catch (error) {
        console.error(`DB 종료 실패: ${error.message}`);
        process.exitCode = 1;
      }
    }
  }
}

run();
