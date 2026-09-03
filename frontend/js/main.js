const alerts = [
  {
    title: "비정상 고액 결제",
    description: "평소 평균 결제 금액보다 약 6.8배 높은 금액이 결제되었습니다.",
    score: 87
  },
  {
    title: "심야 결제",
    description: "평소 사용하지 않는 심야 시간대에 결제가 발생했습니다.",
    score: 72
  }
];

const transactions = [
  {
    merchant: "OO편의점",
    time: "23:42",
    amount: 85000
  },
  {
    merchant: "XX게임",
    time: "23:36",
    amount: 32000
  },
  {
    merchant: "카페",
    time: "18:20",
    amount: 6500
  },
  {
    merchant: "분식집",
    time: "16:15",
    amount: 5000
  }
];

function renderAlerts() {
  const alertList = document.getElementById("alertList");

  alertList.innerHTML = "";

  alerts.forEach((alert) => {
    const item = document.createElement("div");

    item.className = "alert-item";

    item.innerHTML = `
      <div>
        <p class="item-title">${alert.title}</p>
        <p class="item-description">${alert.description}</p>
      </div>

      <span class="alert-score">
        위험도 ${alert.score}
      </span>
    `;

    alertList.appendChild(item);
  });
}

function renderTransactions() {
  const transactionList = document.getElementById("transactionList");

  transactionList.innerHTML = "";

  transactions.forEach((transaction) => {
    const item = document.createElement("div");

    item.className = "transaction-item";

    item.innerHTML = `
      <div>
        <p class="item-title">${transaction.merchant}</p>
        <p class="item-description">${transaction.time}</p>
      </div>

      <span class="amount">
        ${transaction.amount.toLocaleString()}원
      </span>
    `;

    transactionList.appendChild(item);
  });
}

document
  .getElementById("detailButton")
  .addEventListener("click", () => {
    window.location.href = "./detail.html";
  });
renderAlerts();
renderTransactions();