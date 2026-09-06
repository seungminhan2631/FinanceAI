(() => {
  "use strict";
  const F = window.FinanceAI;
  if (!F.requireUser()) return;
  const content = document.getElementById("detailContent");
  const button = document.querySelector(".analysis-button");
  button.disabled = true;

  async function load() {
    try {
      const id = new URLSearchParams(location.search).get("id");
      if (!id) throw new Error("선택한 거래가 없습니다. 거래내역에서 거래를 선택해주세요.");
      const items = await F.transactions();
      const tx = items.find((item) => String(item.transaction_id) === id);
      if (!tx) throw new Error("해당 거래를 찾을 수 없습니다. 거래내역에서 다시 선택해주세요.");
      F.text("#merchantName", tx.merchant_name || "가맹점");
      F.text("#transactionAmount", F.money(tx.amount));
      F.text("#transactionTime", F.formatTime(tx.transaction_datetime));
      F.text("#transactionDate", F.formatDate(tx.transaction_datetime));
      F.text("#transactionCategory", F.category(tx.merchant_category));
      const rows = document.querySelectorAll(".transaction-detail-row strong");
      const values = [
  tx.merchant_name || "가맹점",

  F.category(tx.merchant_category),

  ({
    APPROVED: "승인 완료",
    DECLINED: "승인 거절",
    REJECTED: "승인 거절",
    CANCELLED: "취소",
    CANCELED: "취소",
    REFUNDED: "환불"
  })[String(tx.transaction_status || "").toUpperCase()]
    || tx.transaction_status
    || "정보 없음"
];
      rows.forEach((row, index) => { row.textContent = values[index] ?? "정보 없음"; });
      const status = F.risk(tx.analysis);
      F.badge("#transactionRiskStatus", status);
      const score = document.querySelector(".risk-score-small strong");
      score.replaceChildren(document.createTextNode(String(status.score ?? "-")), F.element("span", "", " / 100"));
      const rules = document.querySelector(".risk-rule-list");
      rules.replaceChildren();
      F.reasons(tx.analysis).forEach((reason) => {
        rules.append(F.element("span", "risk-rule", reason));
      });
      const pattern = F.pattern(F.historyFor(tx, items));
      const cards = document.querySelectorAll(".quick-analysis-card");
      cards[0].querySelector("strong").textContent =
        pattern.average == null ? "데이터 부족" : F.money(Math.round(pattern.average));
      const amount = F.number(tx.amount);
      cards[0].querySelector(".quick-comparison").textContent =
        pattern.average > 0 && amount != null ? "현재 " + (amount / pattern.average).toFixed(1) + "배" : "비교 데이터 부족";
      cards[1].querySelector("strong").textContent = pattern.time;
      cards[1].querySelector(".quick-comparison").textContent = "현재 " + F.formatTime(tx.transaction_datetime);
      button.onclick = () => { location.href = F.transactionUrl("detail", tx.transaction_id); };
      button.disabled = false;
      content.hidden = false;
      document.getElementById("pageStatus").hidden = true;
    } catch (error) {
      content.hidden = true;
      button.disabled = true;
      F.showError("#pageStatus", error);
    }
  }
  load();
})();
