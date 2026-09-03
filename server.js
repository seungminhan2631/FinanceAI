require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// 요구사항 16번: FDS 서비스 및 AI 모듈 로드
const { analyzeTransactionRisk } = require('./youth-fds-detection/src/services/finalRiskAnalysisService');
const { buildTrainingFeatures } = require('./youth-fds-detection/src/ai/trainingDataBuilder');
const { trainModel, predictAnomaly } = require('./youth-fds-detection/src/ai/aiModel');

const app = express();
app.use(cors());
app.use(express.json());

// DB 연결
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// 20자리 이하 고유 ID 생성 함수
function generateShortTxId() {
  const timestamp = Date.now().toString();
  const randomStr = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `tx_${timestamp.slice(-10)}_${randomStr}`;
}

// 업종 카테고리 매핑 (DB CHECK 제약조건 준수)
const CATEGORY_MAP = {
  '식비': 'FOOD',
  '음식점': 'FOOD',
  '식당': 'FOOD',
  '카페': 'CAFE',
  '편의점': 'CONVENIENCE',
  '쇼핑': 'SHOPPING',
  '주얼리': 'SHOPPING',
  '보석': 'SHOPPING',
  '교통': '교통',               // DB CHECK 제약조건 한글 '교통' 준수
  '게임': 'GAME_DIGITAL',
  '교육': 'EDUCATION',
  '학원': 'EDUCATION',
  '도서': 'BOOK_STATIONERY',
  '문구': 'BOOK_STATIONERY',
  '상품권': 'GIFT_CARD',
  '기타': '기타'                // DB CHECK 제약조건 한글 '기타' 준수
};

// 전역 상태 및 Readiness 플래그
let globalReferenceScores = [];
let isEngineReady = false;

// DB 및 AI 엔진 초기화
async function initAiEngine() {
  try {
    console.log('🔄 DB 테이블 점검 및 AI 엔진 초기화를 시작합니다...');

    // fds_alerts 테이블 자동 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fds_alerts (
        alert_id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(20) REFERENCES transactions(transaction_id),
        risk_score INT,
        risk_level VARCHAR(20),
        reason TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // DB 거래 내역 로드
    const result = await pool.query('SELECT transaction_id, user_id, amount, merchant_name, merchant_category, transaction_datetime, transaction_status FROM transactions ORDER BY transaction_datetime ASC');
    
    if (result.rows.length === 0) {
      console.log('⚠️ DB에 거래 데이터가 없습니다. AI 모델 미학습 상태로 준비를 마칩니다.');
      isEngineReady = true;
      return;
    }

    const { trainingFeatures, usableFeatureCount } = buildTrainingFeatures(result.rows);
    
    if (!trainingFeatures || trainingFeatures.length === 0 || usableFeatureCount === 0) {
      console.warn('⚠️ 학습 가능한 유효 Feature가 0개입니다. AI 모델을 미학습 상태로 유지합니다.');
      globalReferenceScores = [];
      isEngineReady = true;
      return;
    }

    trainModel(trainingFeatures);

    globalReferenceScores = trainingFeatures.map((feat) => {
      const pred = predictAnomaly(feat);
      return pred.anomalyScore; 
    });

    isEngineReady = true;
    console.log(`🤖 AI Engine Trained: 총 ${usableFeatureCount}건의 Feature 데이터로 Isolation Forest 학습 및 referenceScores 구축 완료!`);
  } catch (err) {
    console.error('❌ AI Engine / DB 초기화 중 오류 발생:', err.message);
    process.exit(1);
  }
}

// Readiness 미들웨어
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (!isEngineReady) {
    return res.status(503).json({
      success: false,
      error: 'MODEL_NOT_TRAINED',
      message: 'AI 엔진이 아직 초기화 중이거나 준비되지 않았습니다.'
    });
  }
  next();
});

// 1. 서버 상태 점검 API
app.get('/health', (req, res) => {
  res.json({ status: 'ok', engineReady: isEngineReady, message: 'FDS 백엔드 서버 상태 정상' });
});

// 2. 결제 발생 및 이상 탐지(FDS) API
app.post('/api/transactions', async (req, res) => {
  const { userId, amount, merchantName, merchantCategory } = req.body;

  // 입력값 검증
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId는 필수 입력 항목입니다.' });
  }
  if (amount === undefined || amount === null || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 1) {
    return res.status(400).json({ success: false, error: 'amount는 1 이상의 유효한 숫자여야 합니다.' });
  }
  if (!merchantName || typeof merchantName !== 'string' || merchantName.trim() === '') {
    return res.status(400).json({ success: false, error: 'merchantName은 필수 입력 항목입니다.' });
  }
  if (!merchantCategory || typeof merchantCategory !== 'string' || merchantCategory.trim() === '') {
    return res.status(400).json({ success: false, error: 'merchantCategory는 필수 입력 항목입니다.' });
  }

  const formattedUserId = typeof userId === 'number' ? `U${String(userId).padStart(3, '0')}` : String(userId);
  const rawCategory = String(merchantCategory).trim();
  const normalizedCategory = CATEGORY_MAP[rawCategory] || rawCategory;
  const newTransactionId = generateShortTxId();

  try {
    // DB INSERT (소문자 merchant_name)
    const txResult = await pool.query(
      `INSERT INTO transactions (transaction_id, user_id, amount, merchant_name, merchant_category, transaction_datetime, transaction_status)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'APPROVED') 
       RETURNING transaction_id, user_id, amount, merchant_name, merchant_category, transaction_datetime, transaction_status`,
      [newTransactionId, formattedUserId, amount, merchantName, normalizedCategory]
    );
    const newTx = txResult.rows[0];

    // 과거 history 데이터 조회
    const historyResult = await pool.query(
      `SELECT transaction_id, user_id, amount, merchant_name, merchant_category, transaction_datetime, transaction_status
       FROM transactions 
       WHERE user_id = $1 
         AND transaction_datetime < $2 
         AND transaction_id != $3
       ORDER BY transaction_datetime ASC`,
      [formattedUserId, newTx.transaction_datetime, newTx.transaction_id]
    );

    // FDS 입력 데이터 규격 (hasValidDatetime 검증 안전 통과)
    const currentTxData = {
      transaction_id: String(newTx.transaction_id),
      user_id: String(newTx.user_id),
      amount: Number(newTx.amount),
      merchant_name: String(merchantName).trim(),
      merchant_category: String(newTx.merchant_category).trim(),
      // 💡 서버 현재 시간(Date.now())보다 미세하게 과거 시점으로 보장하여 validateBaseTransaction 통과
      transaction_datetime: new Date(Date.now() - 1000).toISOString(),
      transaction_status: 'APPROVED',
      transaction_type: 'CARD'
    };

    const formattedHistory = historyResult.rows.map(r => ({
      transaction_id: String(r.transaction_id),
      user_id: String(r.user_id),
      amount: Number(r.amount),
      merchant_name: String(r.merchant_name || '기타가맹점').trim(),
      merchant_category: String(r.merchant_category || '기타').trim(),
      transaction_datetime: new Date(r.transaction_datetime).toISOString(),
      transaction_status: 'APPROVED',
      transaction_type: 'CARD'
    }));

    // FDS 위험 분석 호출
    const analysisResult = analyzeTransactionRisk(
      currentTxData,
      formattedHistory,
      globalReferenceScores
    );

    // Alert 저장
    if (analysisResult.available && analysisResult.risk && analysisResult.risk.level) {
      const riskLevel = analysisResult.risk.level;
      if (riskLevel === 'HIGH' || riskLevel === 'CAUTION') {
        try {
          const detectedRuleNames = analysisResult.rule?.detectedRules?.map(r => r.ruleName || r.ruleId).join(', ');
          const alertReason = detectedRuleNames 
            ? `[${riskLevel}] 탐지 규칙: ${detectedRuleNames}`
            : `[${riskLevel}] AI 종합 위험도 초과`;

          await pool.query(
            `INSERT INTO fds_alerts (transaction_id, risk_score, risk_level, reason)
             VALUES ($1, $2, $3, $4)`,
            [newTx.transaction_id, analysisResult.risk.combinedScore, riskLevel, alertReason]
          );
        } catch (alertErr) {
          console.warn('⚠️ fds_alerts DB 저장 중 경고:', alertErr.message);
        }
      }
    }

    return res.status(201).json({
      success: true,
      transactionId: newTx.transaction_id,
      approvedAt: newTx.transaction_datetime,
      analysis: analysisResult
    });

  } catch (err) {
    console.error('❌ Transactions API 처리 중 예외 발생:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. 위험 탐지 내역 조회 API
app.get('/api/alerts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.alert_id,
        a.risk_score,
        a.risk_level,
        a.reason,
        a.created_at,
        t.transaction_id,
        t.user_id,
        t.amount,
        t.merchant_name,
        t.merchant_category
      FROM fds_alerts a
      JOIN transactions t ON a.transaction_id = t.transaction_id
      ORDER BY a.created_at DESC
    `);
    res.json({ success: true, alerts: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. 전체 거래 목록 조회 API
app.get('/api/transactions', async (req, res) => {
  try {
    const result = await pool.query('SELECT transaction_id, user_id, amount, merchant_name, merchant_category, transaction_datetime, transaction_status FROM transactions ORDER BY transaction_datetime DESC');
    res.json({ success: true, count: result.rowCount, transactions: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  await initAiEngine();
  app.listen(PORT, () => {
    console.log(`🚀 백엔드 서버가 http://localhost:${PORT} 에서 정상 실행 중입니다.`);
  });
}

startServer();