require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function initDatabase() {
  try {
    const client = await pool.connect();
    console.log('✅ DB 연결 성공! 테이블 재설정을 시작합니다...');

    // 기존에 잘못 생성되었을 수 있는 테이블 삭제 (초기화)
    await client.query(`DROP TABLE IF EXISTS fds_alerts CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS transactions CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS users CASCADE;`);

    // 1. users (유저) 테이블 생성
    await client.query(`
      CREATE TABLE users (
        user_id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. transactions (결제 내역) 테이블 생성
    await client.query(`
      CREATE TABLE transactions (
        transaction_id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(user_id),
        amount INT NOT NULL,
        merchant_name VARCHAR(100) NOT NULL,
        merchant_category VARCHAR(50) NOT NULL,
        approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. fds_alerts (이상탐지/스코어링 알림) 테이블 생성
    await client.query(`
      CREATE TABLE fds_alerts (
        alert_id SERIAL PRIMARY KEY,
        transaction_id INT REFERENCES transactions(transaction_id),
        risk_score INT NOT NULL,
        risk_level VARCHAR(20) NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('🎉 모든 테이블(users, transactions, fds_alerts)이 성공적으로 생성되었습니다!');
    client.release();
  } catch (err) {
    console.error('❌ 테이블 생성 실패:', err.message);
  } finally {
    await pool.end();
  }
}

initDatabase();