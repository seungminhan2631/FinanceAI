const API_BASE_URL = "http://localhost:3000";

const CURRENT_USER_ID = "U002";

let allUserTransactions = [];
let alertMap = new Map();
let currentFilter = "all";

async function loadTransactions() {
  const transactionList = document.querySelector(".full-transaction-list");

  try {
    // 거래 + FDS 알림 동시에 조회
    const [transactionsResponse, alertsResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/api/transactions`),
      fetch(`${API_BASE_URL}/api/alerts`)
    ]);

    const transactionData = await transactionsResponse.json();
    const alertData = await alertsResponse.json();

    if (!transactionsResponse.ok || !transactionData.success) {
      throw new Error(transactionData.error || "거래내역 조회 실패");
    }

    if (!alertsResponse.ok || !alertData.success) {
      throw new Error(alertData.error || "FDS 알림 조회 실패");
    }

    // U001 거래만
    allUserTransactions = (transactionData.transactions || []).filter((tx) => {
      return String(tx.user_id || tx.userId) === CURRENT_USER_ID;
    });

    // U001의 FDS 알림만
    const userAlerts = (alertData.alerts || []).filter((alert) => {
      return String(alert.user_id || alert.userId) === CURRENT_USER_ID;
    });

    // transaction_id 기준으로 알림 찾기 쉽게 저장
    alertMap = new Map();

    userAlerts.forEach((alert) => {
      alertMap.set(String(alert.transaction_id), alert);
    });

    updateTodaySummary(allUserTransactions, userAlerts);

    renderTransactions();
    setupFilters();

  } catch (error) {
    console.error("거래내역 API 오류:", error);

    transactionList.innerHTML = `
      <p style="padding: 30px;">
        거래내역을 불러오지 못했습니다.
      </p>
    `;
  }
}


// 거래 목록 표시
function renderTransactions() {
  const transactionList = document.querySelector(".full-transaction-list");

  let transactions = allUserTransactions;

  // 상태 필터
  if (currentFilter !== "all") {
    transactions = transactions.filter((tx) => {
      return getTransactionStatus(tx).type === currentFilter;
    });
  }

  // 최신 10건
  transactions = transactions.slice(0, 10);

  transactionList.innerHTML = "";

  if (transactions.length === 0) {
    transactionList.innerHTML = `
      <p style="padding: 30px;">
        해당 거래내역이 없습니다.
      </p>
    `;
    return;
  }

  transactions.forEach((tx) => {
    const date = new Date(tx.transaction_datetime);

    const dateText = date.toLocaleDateString("ko-KR");

    const timeText = date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit"
    });

    const amountText =
      Number(tx.amount).toLocaleString("ko-KR");

    const status = getTransactionStatus(tx);

    const item = document.createElement("div");

    item.className = "full-transaction-item";

    item.onclick = () => {
      location.href =
        `./transaction-detail.html?id=${encodeURIComponent(tx.transaction_id)}`;
    };

    item.innerHTML = `
      <div class="transaction-main-info">
        <strong>${tx.merchant_name || "가맹점"}</strong>
        <span>${tx.merchant_category || "기타"}</span>
      </div>

      <div class="transaction-time">
        <strong>${timeText}</strong>
        <span>${dateText}</span>
      </div>

      <div class="transaction-amount">
        ${amountText}원
      </div>

      <div>
        <span class="transaction-status ${status.cssClass}">
          ${status.text}
        </span>
      </div>
    `;

    transactionList.appendChild(item);
  });
}


// 거래의 FDS 상태 결정
function getTransactionStatus(tx) {

  const level =
    String(tx.analysis?.risk?.level || "").toUpperCase();

  // 위험
  if (level === "HIGH" || level === "DANGER") {
    return {
      type: "danger",
      text: "위험",
      cssClass: "danger"
    };
  }

  // 주의
  if (level === "CAUTION" || level === "WARNING") {
    return {
      type: "warning",
      text: "주의",
      cssClass: "warning"
    };
  }

  // LOW / NORMAL / 분석 결과 없음
  return {
    type: "normal",
    text: "정상",
    cssClass: "normal"
  };
}


// 상단 요약
function updateTodaySummary(userTransactions, userAlerts) {
  const summaryCards =
    document.querySelectorAll(".transaction-summary-card strong");

  const today = getKoreaDateKey(new Date());

  const todayTransactions = userTransactions.filter((tx) => {
    return getKoreaDateKey(
      new Date(tx.transaction_datetime)
    ) === today;
  });

  const todayTotalAmount = todayTransactions.reduce(
    (sum, tx) => sum + Number(tx.amount || 0),
    0
  );

  // 오늘 결제 금액
  if (summaryCards[0]) {
    summaryCards[0].textContent =
      `${todayTotalAmount.toLocaleString("ko-KR")}원`;
  }

  // 오늘 결제 횟수
  if (summaryCards[1]) {
    summaryCards[1].textContent =
      `${todayTransactions.length}건`;
  }

  // 오늘 이상행동 탐지
  const todayAlerts = userAlerts.filter((alert) => {
    return getKoreaDateKey(
      new Date(alert.created_at)
    ) === today;
  });

  if (summaryCards[2]) {
    summaryCards[2].textContent =
      `${todayAlerts.length}건`;
  }
}


// 전체 / 정상 / 주의 / 위험 버튼
function setupFilters() {
  const buttons =
    document.querySelectorAll(".filter-button");

  if (buttons.length < 4) {
    return;
  }

  const filters = [
    "all",
    "normal",
    "warning",
    "danger"
  ];

  buttons.forEach((button, index) => {
    button.onclick = () => {

      currentFilter = filters[index];

      buttons.forEach((btn) => {
        btn.classList.remove("active");
      });

      button.classList.add("active");

      renderTransactions();
    };
  });
}


// 한국 날짜 계산
function getKoreaDateKey(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}


document.addEventListener(
  "DOMContentLoaded",
  loadTransactions
);

function updateHeaderUserInfo() {
  const nameElement = document.getElementById("header-user-name");
  const ageElement = document.getElementById("header-user-age");

  const userName = localStorage.getItem("userName");
  const birthDate = localStorage.getItem("birthDate");

  if (nameElement) {
    nameElement.textContent = userName || "사용자";
  }

  if (ageElement && birthDate) {
    const birth = new Date(birthDate);
    const today = new Date();

    let age = today.getFullYear() - birth.getFullYear();

    const birthdayNotPassed =
      today.getMonth() < birth.getMonth() ||
      (today.getMonth() === birth.getMonth() &&
        today.getDate() < birth.getDate());

    if (birthdayNotPassed) {
      age--;
    }

    ageElement.textContent = `${age}세`;
  }
}

updateHeaderUserInfo();

