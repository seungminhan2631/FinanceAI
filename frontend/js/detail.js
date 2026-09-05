const API_BASE_URL = "http://localhost:3000";

const CURRENT_USER_ID = "U002";


async function loadDetail() {
  try {
    const params = new URLSearchParams(window.location.search);
    const requestedTransactionId = params.get("id");

    const [transactionResponse, alertResponse] =
      await Promise.all([
        fetch(`${API_BASE_URL}/api/transactions`),
        fetch(`${API_BASE_URL}/api/alerts`)
      ]);

    const transactionData =
      await transactionResponse.json();

    const alertData =
      await alertResponse.json();

    if (!transactionResponse.ok || !transactionData.success) {
      throw new Error("거래내역 조회 실패");
    }

    if (!alertResponse.ok || !alertData.success) {
      throw new Error("FDS 조회 실패");
    }


    // 로그인 사용자 거래
    const userTransactions =
      (transactionData.transactions || [])
        .filter((tx) => {
          return String(tx.user_id || tx.userId)
            === CURRENT_USER_ID;
        })
        .sort((a, b) => {
          return new Date(b.transaction_datetime)
            - new Date(a.transaction_datetime);
        });


    if (userTransactions.length === 0) {
      throw new Error("사용자 거래내역이 없습니다.");
    }


    // URL에 거래 ID가 있으면 그 거래,
    // 없으면 로그인 사용자의 가장 최근 거래
    let transaction;

    if (requestedTransactionId) {
      transaction = userTransactions.find((tx) => {
        return String(tx.transaction_id)
          === String(requestedTransactionId);
      });
    } else {
      transaction = userTransactions[0];
    }


    if (!transaction) {
      throw new Error("해당 거래를 찾을 수 없습니다.");
    }


    // 해당 거래 FDS 알림
    const transactionAlerts =
      (alertData.alerts || []).filter((alert) => {
        return (
          String(alert.user_id || alert.userId)
            === CURRENT_USER_ID
          &&
          String(alert.transaction_id)
            === String(transaction.transaction_id)
        );
      });


    renderDetail(
      transaction,
      transactionAlerts,
      userTransactions
    );

  } catch (error) {
    console.error("상세 분석 조회 오류:", error);
  }
}


function renderDetail(
  transaction,
  alerts,
  userTransactions
) {

  updateUserInfo();

  const alert = alerts[0] || null;

  const score =
    alert ? Number(alert.risk_score || 0) : 0;

  const level =
    alert
      ? String(alert.risk_level || "").toUpperCase()
      : "NORMAL";


  // =============================
  // 상단 위험도
  // =============================

  const riskScore =
    document.querySelector(".detail-risk-score");

  const riskBadge =
    document.querySelector(".detail-risk-box strong");

  const headerTitle =
    document.querySelector(".detail-header-card h2");

  const headerSubtitle =
    document.querySelector(".detail-subtitle");


  if (riskScore) {
    riskScore.innerHTML = `
      ${score}
      <span>/ 100</span>
    `;
  }


  if (riskBadge) {
    const status = convertRiskLevel(level);

    riskBadge.textContent = status.text;
    riskBadge.className = status.badgeClass;
  }


  if (headerTitle) {
    headerTitle.textContent =
      alert
        ? "평소와 다른 금융 행동이 감지되었습니다."
        : "현재 거래에서 이상행동이 탐지되지 않았습니다.";
  }


  if (headerSubtitle) {
    headerSubtitle.textContent =
      "결제 정보와 기존 소비 패턴을 비교한 결과입니다.";
  }


  // =============================
  // 거래 기본 카드
  // =============================

  const detailCards =
    document.querySelectorAll(
      ".detail-grid .detail-info-card strong"
    );


  const amount =
    Number(transaction.amount || 0);

  const date =
    new Date(transaction.transaction_datetime);


  const timeText =
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);


  if (detailCards[0]) {
    detailCards[0].textContent =
      `${amount.toLocaleString("ko-KR")}원`;
  }

  if (detailCards[1]) {
    detailCards[1].textContent = timeText;
  }

  if (detailCards[2]) {
    detailCards[2].textContent =
      transaction.merchant_name || "가맹점";
  }

  // 현재 API에 지역 없음
  if (detailCards[3]) {
    detailCards[3].textContent = "정보 없음";
  }


  // =============================
  // 탐지된 이상행동
  // =============================

  renderDetectedRisk(alerts);


  // =============================
  // 평소 패턴 비교
  // =============================

  renderComparison(
    transaction,
    userTransactions
  );


  // =============================
  // AI 종합 분석 문구
  // =============================

  const aiMessage =
    document.querySelector(".ai-message");

  if (aiMessage) {

    if (alert) {
      aiMessage.textContent =
        alert.reason ||
        "평소 금융 행동과 다른 이상 패턴이 탐지되었습니다.";
    } else {
      aiMessage.textContent =
        "현재 거래는 사용자의 기존 결제 패턴과 비교했을 때 뚜렷한 이상행동이 탐지되지 않았습니다.";
    }
  }
}


// 탐지 항목
function renderDetectedRisk(alerts) {

  const list =
    document.querySelector(".detect-list");

  if (!list) return;

  list.innerHTML = "";


  if (alerts.length === 0) {

    list.innerHTML = `
      <div class="detect-item">
        <div>
          <h3>이상행동 탐지 없음</h3>
          <p>
            현재 거래에서 금융 이상행동이 탐지되지 않았습니다.
          </p>
        </div>

        <span class="detect-score">
          0
        </span>
      </div>
    `;

    return;
  }


  alerts.forEach((alert) => {

    const item =
      document.createElement("div");

    item.className = "detect-item";

    item.innerHTML = `
      <div>
        <h3>
          ${escapeHtml(
            alert.reason || "이상행동 탐지"
          )}
        </h3>

        <p>
          FDS 분석을 통해 평소와 다른 결제 행동이 확인되었습니다.
        </p>
      </div>

      <span class="detect-score">
        ${Number(alert.risk_score || 0)}
      </span>
    `;

    list.appendChild(item);
  });
}


// 소비 패턴 비교
function renderComparison(
  transaction,
  userTransactions
) {

  const pastTransactions =
    userTransactions.filter((tx) => {
      return String(tx.transaction_id)
        !== String(transaction.transaction_id);
    });


  // 평균 금액
  const averageAmount =
    pastTransactions.length > 0
      ? pastTransactions.reduce(
          (sum, tx) =>
            sum + Number(tx.amount || 0),
          0
        ) / pastTransactions.length
      : 0;


  const currentAmount =
    Number(transaction.amount || 0);


  // 주요 시간대
  const commonTime =
    getCommonTimeRange(pastTransactions);


  const currentTime =
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(
      new Date(transaction.transaction_datetime)
    );


  // 주요 업종
  const commonCategory =
    getCommonCategory(pastTransactions);

  const currentCategory =
    convertCategory(
      transaction.merchant_category
    );


  const rows =
    document.querySelectorAll(
      ".comparison-row"
    );


  // 평균 결제 금액
  if (rows[0]) {

    const values =
      rows[0].querySelectorAll("strong");

    if (values[0]) {
      values[0].textContent =
        `${Math.round(
          averageAmount
        ).toLocaleString("ko-KR")}원`;
    }

    if (values[1]) {
      values[1].textContent =
        `${currentAmount.toLocaleString("ko-KR")}원`;
    }
  }


  // 결제 시간
  if (rows[1]) {

    const values =
      rows[1].querySelectorAll("strong");

    if (values[0]) {
      values[0].textContent =
        commonTime;
    }

    if (values[1]) {
      values[1].textContent =
        currentTime;
    }
  }


  // 업종
  if (rows[2]) {

    const values =
      rows[2].querySelectorAll("strong");

    if (values[0]) {
      values[0].textContent =
        commonCategory;
    }

    if (values[1]) {
      values[1].textContent =
        currentCategory;
    }
  }
}


// 상단 사용자 정보
function updateUserInfo() {

  const name =
    document.querySelector(".user-name");

  const age =
    document.querySelector(".user-age");

  if (name) {
    name.textContent =
      `${CURRENT_USER_ID} 보호자`;
  }

  if (age) {
    age.textContent = "보호자";
  }
}


// 가장 자주 결제한 시간대
function getCommonTimeRange(transactions) {

  if (transactions.length === 0) {
    return "데이터 부족";
  }


  const ranges = {
    "00:00 ~ 06:00": 0,
    "06:00 ~ 12:00": 0,
    "12:00 ~ 18:00": 0,
    "18:00 ~ 24:00": 0
  };


  transactions.forEach((tx) => {

    const hour = Number(
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone: "Asia/Seoul",
          hour: "2-digit",
          hour12: false
        }
      ).format(
        new Date(tx.transaction_datetime)
      )
    );


    if (hour < 6) {
      ranges["00:00 ~ 06:00"]++;
    } else if (hour < 12) {
      ranges["06:00 ~ 12:00"]++;
    } else if (hour < 18) {
      ranges["12:00 ~ 18:00"]++;
    } else {
      ranges["18:00 ~ 24:00"]++;
    }

  });


  return Object.entries(ranges)
    .sort((a, b) => b[1] - a[1])[0][0];
}


// 가장 많이 사용한 업종
function getCommonCategory(transactions) {

  if (transactions.length === 0) {
    return "데이터 부족";
  }

  const counts = {};

  transactions.forEach((tx) => {

    const category =
      convertCategory(
        tx.merchant_category
      );

    counts[category] =
      (counts[category] || 0) + 1;
  });


  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])[0][0];
}


function convertCategory(category) {

  const map = {
    FOOD: "식비",
    CAFE: "카페",
    CONVENIENCE: "편의점",
    SHOPPING: "쇼핑",
    TRANSPORT: "교통",
    GAME_DIGITAL: "게임",
    EDUCATION: "교육",
    BOOK_STATIONERY: "도서",
    GIFT_CARD: "상품권",
    ETC: "기타"
  };

  return map[category]
    || category
    || "기타";
}


function convertRiskLevel(level) {

  if (level === "HIGH") {
    return {
      text: "위험",
      badgeClass: "danger-badge"
    };
  }

  if (level === "CAUTION") {
    return {
      text: "주의",
      badgeClass: "danger-badge"
    };
  }

  return {
    text: "정상",
    badgeClass: "risk-level"
  };
}


function escapeHtml(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


document.addEventListener(
  "DOMContentLoaded",
  loadDetail
);