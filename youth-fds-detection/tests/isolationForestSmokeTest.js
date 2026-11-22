const { IsolationForest } = require("isolation-forest");

// 평범한 소비 패턴이라고 가정한 가짜 Feature 데이터
const trainingData = [
  {
    amountRatio: 1.0,
    amountZScore: 0.1,
    recent10MinCount: 1,
    averageTransactionInterval: 120,
    timeSlotFrequency: 0.3,
    categoryFrequency: 0.4,
    dailySpendRatio: 1.0,
  },
  {
    amountRatio: 1.1,
    amountZScore: 0.3,
    recent10MinCount: 1,
    averageTransactionInterval: 150,
    timeSlotFrequency: 0.25,
    categoryFrequency: 0.35,
    dailySpendRatio: 0.9,
  },
  {
    amountRatio: 0.9,
    amountZScore: -0.2,
    recent10MinCount: 1,
    averageTransactionInterval: 100,
    timeSlotFrequency: 0.4,
    categoryFrequency: 0.5,
    dailySpendRatio: 1.1,
  },
  {
    amountRatio: 1.2,
    amountZScore: 0.5,
    recent10MinCount: 2,
    averageTransactionInterval: 90,
    timeSlotFrequency: 0.3,
    categoryFrequency: 0.45,
    dailySpendRatio: 1.2,
  },
  {
    amountRatio: 0.8,
    amountZScore: -0.4,
    recent10MinCount: 1,
    averageTransactionInterval: 180,
    timeSlotFrequency: 0.35,
    categoryFrequency: 0.3,
    dailySpendRatio: 0.8,
  },
  {
    amountRatio: 1.05,
    amountZScore: 0.2,
    recent10MinCount: 1,
    averageTransactionInterval: 130,
    timeSlotFrequency: 0.28,
    categoryFrequency: 0.42,
    dailySpendRatio: 1.05,
  },
  {
    amountRatio: 1.3,
    amountZScore: 0.7,
    recent10MinCount: 2,
    averageTransactionInterval: 80,
    timeSlotFrequency: 0.22,
    categoryFrequency: 0.4,
    dailySpendRatio: 1.3,
  },
  {
    amountRatio: 0.95,
    amountZScore: -0.1,
    recent10MinCount: 1,
    averageTransactionInterval: 160,
    timeSlotFrequency: 0.32,
    categoryFrequency: 0.55,
    dailySpendRatio: 0.95,
  },
];

// Isolation Forest 생성
const isolationForest = new IsolationForest();

// 평범한 Feature 데이터 학습
isolationForest.fit(trainingData);

console.log("Isolation Forest 학습 성공");

// 비교용 평범한 거래
const normalTransaction = {
  amountRatio: 1.1,
  amountZScore: 0.2,
  recent10MinCount: 1,
  averageTransactionInterval: 125,
  timeSlotFrequency: 0.3,
  categoryFrequency: 0.4,
  dailySpendRatio: 1.0,
};

// 일부러 매우 이상하게 만든 거래
const abnormalTransaction = {
  amountRatio: 4.5,
  amountZScore: 5.0,
  recent10MinCount: 8,
  averageTransactionInterval: 1.5,
  timeSlotFrequency: 0.01,
  categoryFrequency: 0,
  dailySpendRatio: 4.2,
};

const normalScore = isolationForest.predict([normalTransaction])[0];
const abnormalScore = isolationForest.predict([abnormalTransaction])[0];

console.log("정상 거래 anomaly score:", normalScore);
console.log("이상 거래 anomaly score:", abnormalScore);

console.log("\n스모크 테스트 완료");
