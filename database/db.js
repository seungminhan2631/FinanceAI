// db.js
// ─────────────────────────────────────────────────────────────
// DB 연결 담당 파일. 프로젝트 전체에서 이 파일 하나만 DB에 연결하고,
// 다른 파일들은 여기서 export 하는 query() 를 가져다 씁니다.
// 파일마다 따로 연결을 만들면 커넥션이 금방 고갈되니 주의.
// ─────────────────────────────────────────────────────────────

require("dotenv").config({ quiet: true });
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error(".env 에 DATABASE_URL 이 없습니다. Supabase Connect 버튼에서 복사해 넣으세요.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase는 SSL 필수
  max: 5,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("[db] 유휴 커넥션 오류:", err.message);
});

/**
 * SQL 실행 헬퍼
 * @param {string} text   SQL 문 ($1, $2 형태 파라미터 사용)
 * @param {Array}  params 파라미터 배열
 * @returns {Promise<Array>} 결과 행 배열
 */
async function query(text, params = []) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.DB_DEBUG === "true") {
    console.log(`[db] ${Date.now() - start}ms | ${res.rowCount} rows`);
  }
  return res.rows;
}

/** 앱 종료 시 커넥션 정리 */
async function close() {
  await pool.end();
}

module.exports = { pool, query, close };
