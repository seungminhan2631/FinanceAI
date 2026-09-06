// check-db.js
// 실행: node check-db.js
// DB 연결 + 데이터 적재 + 타임존이 모두 정상인지 한 번에 확인하는 스크립트입니다.

const { query, close } = require("./db");
const repo = require("./transactionRepository");

(async () => {
  try {
    console.log("① 연결 확인");
    const [now] = await query(
      "SELECT NOW() AT TIME ZONE 'Asia/Seoul' AS kst, current_database() AS db"
    );
    console.log("   DB:", now.db, "| 현재 한국시간:", now.kst);

    console.log("\n② 사용자별 거래 요약 (기대: U001 76 / U002 71 / U003 91 / U004 62)");
    const summary = await query(
      `SELECT user_id,
              COUNT(*) FILTER (WHERE transaction_status = 'APPROVED')::int AS approved,
              COUNT(*) FILTER (WHERE transaction_status <> 'APPROVED')::int AS others,
              ROUND(AVG(amount) FILTER (WHERE transaction_status = 'APPROVED'))::int AS avg_amt
       FROM transactions GROUP BY user_id ORDER BY user_id`
    );
    console.table(summary);

    console.log("③ 콜드스타트 확인 (전원 false 여야 정상)");
    for (const u of ["U001", "U002", "U003", "U004"]) {
      const { isLowConfidence, count } = await repo.isColdStart(u);
      console.log(`   ${u} 최근30일 ${count}건 → 데이터부족: ${isLowConfidence}`);
    }

    console.log("\n④ 타임존 확인 (심야 거래가 00~05시로 나와야 정상)");
    const night = await query(
      `SELECT transaction_id, user_id,
              to_char(transaction_datetime AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS kst
       FROM approved_transactions
       WHERE EXTRACT(HOUR FROM transaction_datetime AT TIME ZONE 'Asia/Seoul') < 5
       ORDER BY 3`
    );
    console.table(night);

    console.log("⑤ 탐지 코드가 받게 될 데이터 형태");
    const [sample] = await repo.getRecentTransactions("U001", 1);
    console.log(JSON.stringify(sample, null, 2));

    console.log("\n⑥ 룰별 기준값 (U001)");
    console.log("   30일 통계:", await repo.getStats30d("U001"));
    console.log("   오늘 누적:", await repo.getTodayTotal("U001"), "원");
    console.log("   이용 업종:", (await repo.getCategories30d("U001")).join(", "));

    console.log("\n✅ 모두 정상입니다.");
  } catch (err) {
    console.error("\n❌ 실패:", err.message);
    console.error("   → DATABASE_URL 오타, 비밀번호, 또는 SQL 미실행을 확인하세요.");
  } finally {
    await close();
  }
})();
