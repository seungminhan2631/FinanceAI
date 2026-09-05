const API_BASE_URL = "http://localhost:3000";

const CURRENT_USER_ID = "U002";

async function loadTransactionDetail() {
  try {
    // URL에서 거래 ID 가져오기
    const params = new URLSearchParams(window.location.search);
    const transactionId = params.get("id");

    if (!transactionId) {
      throw new Error("거래 ID가 없습니다.");
    }

    // 거래내역 + FDS 알림 동시 조회
    const [transactionResponse, alertResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/api/transactions`),
      fetch(`${API_BASE_URL}/api/alerts`)
    ]);

    const transactionData = await transactionResponse.json();
    const alertData = await alertResponse.json();

    if (!transactionResponse.ok || !transactionData.success) {
      throw new Error("거래내역 조회 실패");
    }

    if (!alertResponse.ok || !alertData.success) {
      throw new Error("FDS 알림 조회 실패");
    }

    // 클릭한 거래 찾기
    const transaction = (transactionData.transactions || []).find((tx) => {
  return (
    String(tx.transaction_id) === String(transactionId) &&
    String(tx.user_id || tx.userId) === CURRENT_USER_ID
  );
});

    if (!transaction) {
      throw new Error("해당 거래를 찾을 수 없습니다.");
    }

    // 해당 거래의 FDS 알림 찾기
    const alert = (alertData.alerts || []).find((item) => {
      return String(item.transaction_id) === String(transactionId);
    });

    renderTransaction(transaction, alert, transactionData.transactions || []);

  } catch (error) {
    console.error("거래 상세 조회 오류:", error);

    const merchantName = document.querySelector("#merchantName");

    if (merchantName) {
      merchantName.textContent = "거래 정보를 불러오지 못했습니다.";
    }
  }
}


function renderTransaction(transaction, alert, allTransactions) {

  const date = new Date(transaction.transaction_datetime);

  const dateText = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);

  const timeText = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);

  const amount =
    Number(transaction.amount || 0).toLocaleString("ko-KR");

  const category =
    convertCategory(transaction.merchant_category);

  // 상단 가맹점명
  setText("#merchantName", transaction.merchant_name || "가맹점");

  // 결제 정보 카드
  setText("#transactionAmount", `${amount}원`);
  setText("#transactionTime", timeText);
  setText("#transactionDate", dateText);
  setText("#transactionCategory", category);

  // 거래 기본 정보
  setText("#detailMerchant", transaction.merchant_name || "가맹점");

  const detailRows =
    document.querySelectorAll(".transaction-detail-row strong");

  // 가맹점
  if (detailRows[0]) {
    detailRows[0].textContent =
      transaction.merchant_name || "가맹점";
  }

  // 업종
  if (detailRows[1]) {
    detailRows[1].textContent = category;
  }

  // 현재 API에 결제 지역 정보 없음
  if (detailRows[2]) {
    detailRows[2].textContent = "정보 없음";
  }

  // 현재 API에 결제 수단 정보 없음
  if (detailRows[3]) {
    detailRows[3].textContent = "정보 없음";
  }

  // 승인 상태
  if (detailRows[4]) {
    detailRows[4].textContent =
      convertTransactionStatus(transaction.transaction_status);
  }

  // FDS 결과
  renderRisk(alert);

  // 간단 분석
  renderQuickAnalysis(transaction, allTransactions);
}


function renderRisk(alert) {

  const statusElement =
    document.querySelector("#transactionRiskStatus");

  const riskScoreElement =
    document.querySelector(".risk-score-small strong");

  const ruleList =
    document.querySelector(".risk-rule-list");

  // FDS 알림이 없는 거래 = 정상
  if (!alert) {

    if (statusElement) {
      statusElement.textContent = "정상";
      statusElement.className = "transaction-status normal";
    }

    if (riskScoreElement) {
      riskScoreElement.innerHTML = `
        0
        <span>/ 100</span>
      `;
    }

    if (ruleList) {
      ruleList.innerHTML = `
        <span class="risk-rule">
          이상행동 탐지 없음
        </span>
      `;
    }

    return;
  }

  const level =
    String(alert.risk_level || "").toUpperCase();

  const score =
    Number(alert.risk_score || 0);

  if (riskScoreElement) {
    riskScoreElement.innerHTML = `
      ${score}
      <span>/ 100</span>
    `;
  }

  // HIGH = 위험
  if (level === "HIGH") {

    statusElement.textContent = "위험";
    statusElement.className =
      "transaction-status danger";

  }

  // CAUTION = 주의
  else if (level === "CAUTION") {

    statusElement.textContent = "주의";
    statusElement.className =
      "transaction-status warning";

  }

  // LOW / NORMAL / MONITOR
  else {

    statusElement.textContent = "정상";
    statusElement.className =
      "transaction-status normal";

  }

  if (ruleList) {

    const reason =
      alert.reason || "이상행동이 탐지되었습니다.";

    ruleList.innerHTML = `
      <span class="risk-rule ${
        level === "HIGH"
          ? "danger-rule"
          : ""
      }">
        ${escapeHtml(reason)}
      </span>
    `;
  }
}


function renderQuickAnalysis(transaction, allTransactions) {

  // 현재 거래 사용자의 과거 거래만
  const userTransactions = allTransactions.filter((tx) => {
    return String(tx.user_id) === String(transaction.user_id)
      && String(tx.transaction_id) !== String(transaction.transaction_id);
  });

  const cards =
    document.querySelectorAll(".quick-analysis-card");

  if (cards.length < 2) {
    return;
  }

  // 평균 결제 금액
  const averageAmount =
    userTransactions.length > 0
      ? userTransactions.reduce(
          (sum, tx) => sum + Number(tx.amount || 0),
          0
        ) / userTransactions.length
      : 0;

  const currentAmount =
    Number(transaction.amount || 0);

  const ratio =
    averageAmount > 0
      ? currentAmount / averageAmount
      : 0;

  const firstCardStrong =
    cards[0].querySelector("strong");

  const firstCardWarning =
    cards[0].querySelector(".quick-warning");

  if (firstCardStrong) {
    firstCardStrong.textContent =
      `${Math.round(averageAmount).toLocaleString("ko-KR")}원`;
  }

  if (firstCardWarning) {
    firstCardWarning.textContent =
      averageAmount > 0
        ? `현재 ${ratio.toFixed(1)}배`
        : "비교 데이터 부족";
  }


  // 사용자 주요 결제 시간대
  const timeRange =
    getMostCommonTimeRange(userTransactions);

  const secondCardStrong =
    cards[1].querySelector("strong");

  const secondCardWarning =
    cards[1].querySelector(".quick-warning");

  if (secondCardStrong) {
    secondCardStrong.textContent = timeRange;
  }

  if (secondCardWarning) {

    const currentTime =
      new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(
        new Date(transaction.transaction_datetime)
      );

    secondCardWarning.textContent =
      `현재 ${currentTime}`;
  }
}


// 가장 많이 결제한 시간대 계산
function getMostCommonTimeRange(transactions) {

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
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        hour12: false
      }).format(
        new Date(tx.transaction_datetime)
      )
    );

    if (hour < 6) {
      ranges["00:00 ~ 06:00"]++;
    }

    else if (hour < 12) {
      ranges["06:00 ~ 12:00"]++;
    }

    else if (hour < 18) {
      ranges["12:00 ~ 18:00"]++;
    }

    else {
      ranges["18:00 ~ 24:00"]++;
    }

  });

  return Object.entries(ranges)
    .sort((a, b) => b[1] - a[1])[0][0];
}


function convertCategory(category) {

  const categories = {
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

  return categories[category] || category || "기타";
}


function convertTransactionStatus(status) {

  const value =
    String(status || "").toUpperCase();

  if (value === "APPROVED") {
    return "승인 완료";
  }

  return status || "정보 없음";
}


function setText(selector, value) {

  const element =
    document.querySelector(selector);

  if (element) {
    element.textContent = value;
  }
}


function escapeHtml(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const analysisButton =
  document.querySelector(".analysis-button");

if (analysisButton) {

  analysisButton.onclick = () => {

    const params =
      new URLSearchParams(
        window.location.search
      );

    const transactionId =
      params.get("id");

    window.location.href =
      `./detail.html?id=${
        encodeURIComponent(transactionId)
      }`;
  };
}

document.addEventListener(
  "DOMContentLoaded",
  loadTransactionDetail
);