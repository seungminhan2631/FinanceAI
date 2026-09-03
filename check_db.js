// check_db.js
require('dotenv').config();
const { Pool } = require('pg');

// 개별 변수 설정을 이용해 DB 연결 객체 생성
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const constraintRes = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint 
      WHERE conname = 'transactions_merchant_category_check';
    `);

    console.log('\n====================================');
    console.log('📌 DB 제약조건 허용값:');
    console.log(constraintRes.rows[0]?.def || '제약조건 정의를 찾을 수 없습니다.');
    console.log('====================================\n');

  } catch (err) {
    console.log('❌ DB 조회 에러 상세:', err.message);
  } finally {
    await pool.end();
    process.exit();
  }
}

run();