require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// 🤖 AI 모듈 불러오기 (aiModel에서 predictAnomaly 활용)
const { buildTrainingFeatures } = require('./services/ai/trainingDataBuilder');
const { trainModel, predictAnomaly } = require('./services/ai/aiModel');
const { scoreTransactionWithAI } = require('./services/ai/aiScoringService');

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

// 🤖 AI 엔진 및 DB 테이블 초기화
let globalReferenceScores = [];

async function initAiEngine() {
  try {
    // 1) fds_alerts 테이블 자동 생성 (없을 경우)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fds_alerts (
        alert_id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(20) REFERENCES transactions(transaction_id),
        risk_score INT NOT NULL,
        risk_level VARCHAR(20) NOT NULL,
        reason TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 2) AI 학습 데이터 로드
    const result = await pool.query('SELECT * FROM transactions');
    
    if (result.rows.length === 0) {
      console.log('⚠️ DB에 거래 데이터가 없습니다. AI 모델 학습을 대기합니다.');
      return;
    }

    const { trainingFeatures, usableFeatureCount } = buildTrainingFeatures(result.rows);
    
    // 3) Isolation Forest 모델 학습
    trainModel(trainingFeatures);

    // 4) predictAnomaly 함수를 사용하여 기준 점수 분포 세팅
    globalReferenceScores = trainingFeatures.map((feat) => {
      const res = predictAnomaly(feat);
      return typeof res === 'number' ? res : (res?.score || res?.rawScore || 0.5);
    });

    console.log(`🤖 AI Engine Trained: 총 ${usableFeatureCount}건의 데이터로 Isolation Forest 학습 완료!`);
  } catch (err) {
    console.error('❌ AI Engine / DB 초기화 중 오류 발생:', err.message);
  }
}

// 1. 서버 상태 점검 API
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'FDS 백엔드 서버가 정상 작동 중입니다.' });
});

// 2. 결제 발생 및 이상 탐지(FDS) API
app.post('/api/transactions', async (req, res) => {
  const { userId, amount, merchantName, merchantCategory } = req.body;
  const targetUserId = userId || 'U003';
  const newTransactionId = generateShortTxId();

  try {
    // 1) transactions 테이블에 결제 저장
    const txResult = await pool.query(
      `INSERT INTO transactions (transaction_id, user_id, amount, merchant_name, merchant_category, transaction_datetime)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING transaction_id, transaction_datetime`,
      [newTransactionId, targetUserId, amount, merchantName, merchantCategory]
    );
    const newTx = txResult.rows[0];

    // 2) 과거 거래 내역 조회 (AI Feature 추출용)
    const historyResult = await pool.query(
      `SELECT * FROM transactions WHERE user_id = $1 ORDER BY transaction_datetime ASC`,
      [targetUserId]
    );

    // 3) AI 파이프라인으로 위험 점수 계산
    const currentTxData = {
      transaction_id: newTx.transaction_id,
      user_id: targetUserId,
      amount,
      merchant_category: merchantCategory,
      transaction_datetime: newTx.transaction_datetime || new Date().toISOString()
    };

    const aiAnalysis = scoreTransactionWithAI(
      currentTxData,
      historyResult.rows,
      globalReferenceScores
    );

    const riskScore = aiAnalysis.available ? aiAnalysis.calibratedAiScore : 10;
    
    let riskLevel = 'NORMAL';
    if (riskScore >= 70) riskLevel = 'DANGER';
    else if (riskScore >= 40) riskLevel = 'WARNING';

    const reason = aiAnalysis.available 
      ? `AI 이상 탐지 (점수: ${riskScore})` 
      : `기본 위험 평가 (${aiAnalysis.unavailableReason || '데이터 부족'})`;

    // 4) fds_alerts 테이블에 탐지 결과 저장
    try {
      await pool.query(
        `INSERT INTO fds_alerts (transaction_id, risk_score, risk_level, reason)
         VALUES ($1, $2, $3, $4)`,
        [newTx.transaction_id, riskScore, riskLevel, reason]
      );
    } catch (alertErr) {
      console.warn('⚠️ Alert 저장 생략:', alertErr.message);
    }

    // 5) 프론트엔드 응답
    res.status(201).json({
      success: true,
      transactionId: newTx.transaction_id,
      approvedAt: newTx.transaction_datetime,
      analysis: {
        riskScore,
        riskLevel,
        reason,
        aiDetails: aiAnalysis
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
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

// 4. 거래 데이터 전체 조회
app.get('/api/transactions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transactions LIMIT 10');
    res.json({ success: true, count: result.rowCount, transactions: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 백엔드 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  initAiEngine();
});
