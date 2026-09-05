const API_BASE_URL = "http://localhost:3000";

const LOGIN_USER_ID =
  localStorage.getItem("userId");

const CURRENT_USER_ID = "U002";

if (!LOGIN_USER_ID) {
  window.location.href = "./login.html";
} else {
  loadDashboard();
}


async function loadDashboard() {
  try {

    // 거래 + FDS 알림 동시에 불러오기
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
      throw new Error("FDS 알림 조회 실패");
    }


    // 현재 로그인 사용자 거래
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


    // 현재 로그인 사용자 FDS 알림
    const userAlerts =
      (alertData.alerts || [])
        .filter((alert) => {
          return String(alert.user_id || alert.userId)
            === CURRENT_USER_ID;
        })
        .sort((a, b) => {
          return new Date(b.created_at)
            - new Date(a.created_at);
        });


    updateUserInfo();

    updateTodaySummary(
      userTransactions,
      userAlerts
    );

    updateCurrentRisk(
      userTransactions,
      userAlerts
    );

    renderAlerts(userAlerts);

    renderTransactions(userTransactions);


  } catch (error) {

    console.error(
      "대시보드 데이터 조회 오류:",
      error
    );
  }
}


// 상단 사용자 정보
function updateUserInfo() {

  const userName =
    document.querySelector(".user-name");

  const userAge =
    document.querySelector(".user-age");


  if (userName) {
  userName.textContent =
    localStorage.getItem("userName") || LOGIN_USER_ID;
}

  if (userAge) {
    userAge.textContent = "보호자";
  }
}


// 오늘 결제 금액 / 횟수 / 이상행동
function updateTodaySummary(
  transactions,
  alerts
) {

  const today =
    getKoreaDateKey(new Date());


  const todayTransactions =
    transactions.filter((tx) => {

      return getKoreaDateKey(
        new Date(tx.transaction_datetime)
      ) === today;

    });


  const todayAmount =
    todayTransactions.reduce(
      (sum, tx) =>
        sum + Number(tx.amount || 0),
      0
    );


  const todayAlerts =
    alerts.filter((alert) => {

      return getKoreaDateKey(
        new Date(alert.created_at)
      ) === today;

    });


  document.getElementById(
    "todayAmount"
  ).textContent =
    `${todayAmount.toLocaleString("ko-KR")}원`;


  document.getElementById(
    "todayCount"
  ).textContent =
    `${todayTransactions.length}건`;


  document.getElementById(
    "alertCount"
  ).textContent =
    `${todayAlerts.length}건`;
}


// 현재 위험도
function updateCurrentRisk(
  transactions,
  alerts
) {

  const riskScore =
    document.getElementById("riskScore");

  const riskLevel =
    document.getElementById("riskLevel");

  const messageTitle =
    document.querySelector(
      ".risk-message h2"
    );

  const messageText =
    document.querySelector(
      ".risk-message p"
    );


  if (transactions.length === 0) {

    riskScore.textContent = "0";
    riskLevel.textContent = "정상";

    messageTitle.textContent =
      "아직 결제 데이터가 없습니다.";

    messageText.textContent =
      "결제 내역이 쌓이면 금융 이상행동을 분석합니다.";

    return;
  }


  // 가장 최근 거래
  const latestTransaction =
    transactions[0];


  // 최근 거래에 연결된 FDS 알림 찾기
  const latestAlert =
    alerts.find((alert) => {

      return String(alert.transaction_id)
        ===
        String(latestTransaction.transaction_id);

    });


  // 최근 거래가 정상인 경우
  if (!latestAlert) {

    riskScore.textContent = "0";

    riskLevel.textContent = "정상";

    messageTitle.textContent =
      "현재 이상 금융행동이 탐지되지 않았습니다.";

    messageText.textContent =
      "최근 거래는 정상적인 결제 패턴으로 확인되었습니다.";

    return;
  }


  const score =
    Number(latestAlert.risk_score || 0);

  const level =
    String(
      latestAlert.risk_level || ""
    ).toUpperCase();


  riskScore.textContent = score;

  riskLevel.textContent =
    convertRiskLevel(level);


  messageTitle.textContent =
    "평소와 다른 결제 행동이 감지되었습니다.";

  messageText.textContent =
    latestAlert.reason
    || "이상 금융행동이 탐지되었습니다.";
}


// 최근 이상행동
function renderAlerts(alerts) {

  const alertList =
    document.getElementById("alertList");

  alertList.innerHTML = "";


  // 최근 3개
  const recentAlerts =
    alerts.slice(0, 3);


  if (recentAlerts.length === 0) {

    alertList.innerHTML = `
      <div class="alert-item">
        <div>
          <p class="item-title">
            최근 이상행동 없음
          </p>

          <p class="item-description">
            현재 탐지된 이상 금융행동이 없습니다.
          </p>
        </div>

        <span class="alert-score">
          정상
        </span>
      </div>
    `;

    return;
  }


  recentAlerts.forEach((alert) => {

    const item =
      document.createElement("div");

    item.className = "alert-item";


    const amount =
      Number(alert.amount || 0)
        .toLocaleString("ko-KR");


    item.innerHTML = `
      <div>
        <p class="item-title">
          ${escapeHtml(
            alert.reason || "이상행동 탐지"
          )}
        </p>

        <p class="item-description">
          ${escapeHtml(
            alert.merchant_name || "가맹점"
          )}
          · ${amount}원
        </p>
      </div>

      <span class="alert-score">
        위험도 ${Number(
          alert.risk_score || 0
        )}
      </span>
    `;


    alertList.appendChild(item);
  });
}


// 최근 거래내역
function renderTransactions(transactions) {

  const transactionList =
    document.getElementById(
      "transactionList"
    );

  transactionList.innerHTML = "";


  // 최근 5건
  const recentTransactions =
    transactions.slice(0, 5);


  if (recentTransactions.length === 0) {

    transactionList.innerHTML = `
      <div class="transaction-item">
        <div>
          <p class="item-title">
            거래내역 없음
          </p>

          <p class="item-description">
            아직 결제 내역이 없습니다.
          </p>
        </div>
      </div>
    `;

    return;
  }


  recentTransactions.forEach((tx) => {

    const item =
      document.createElement("div");

    item.className =
      "transaction-item";


    const amount =
      Number(tx.amount || 0)
        .toLocaleString("ko-KR");


    const time =
      new Intl.DateTimeFormat(
        "ko-KR",
        {
          timeZone: "Asia/Seoul",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        }
      ).format(
        new Date(tx.transaction_datetime)
      );


    item.innerHTML = `
      <div>
        <p class="item-title">
          ${escapeHtml(
            tx.merchant_name || "가맹점"
          )}
        </p>

        <p class="item-description">
          ${time}
          ·
          ${convertCategory(
            tx.merchant_category
          )}
        </p>
      </div>

      <span class="amount">
        ${amount}원
      </span>
    `;


    // 클릭하면 실제 거래 상세
    item.addEventListener(
      "click",
      () => {

        window.location.href =
          `./transaction-detail.html?id=${
            encodeURIComponent(
              tx.transaction_id
            )
          }`;

      }
    );


    transactionList.appendChild(item);
  });
}


// 위험도 한글 변환
function convertRiskLevel(level) {

  if (level === "HIGH") {
    return "위험";
  }

  if (level === "CAUTION") {
    return "주의";
  }

  if (level === "MONITOR") {
    return "모니터링";
  }

  return "정상";
}


// 카테고리 한글 변환
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

  return categories[category]
    || category
    || "기타";
}


// 한국 날짜 YYYY-MM-DD
function getKoreaDateKey(date) {

  return new Intl.DateTimeFormat(
    "sv-SE",
    {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(date);
}


// HTML 문자 보호
function escapeHtml(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


// 상세 분석 버튼
const detailButton =
  document.getElementById("detailButton");

if (detailButton) {

  detailButton.addEventListener(
    "click",
    () => {
      window.location.href =
        "./detail.html";
    }
  );
}


// 최근 거래 전체보기 버튼
const textButtons =
  document.querySelectorAll(".text-button");

if (textButtons[1]) {

  textButtons[1].addEventListener(
    "click",
    () => {
      window.location.href =
        "./transactions.html";
    }
  );
}