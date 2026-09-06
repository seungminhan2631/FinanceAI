(() => {
  "use strict";
  const F = window.FinanceAI;
  if (!F.requireUser()) return;

  const detailButton = document.getElementById("detailButton");
  detailButton.disabled = true;

  async function loadDashboard() {
    try {
      const items = await F.transactions();
      const summary = F.summary(items);
      F.text("#todayAmount", F.money(summary.amount));
      F.text("#todayCount", summary.count + "건");
      F.text("#alertCount", summary.detectedTotal + "건");

      const latest = items[0];
const average = F.averageRisk(items);

F.text("#riskScore", average.score ?? "-");

F.badge("#riskLevel", {
  type: "unavailable",
  text: average.count
    ? `${average.year}년 ${average.month}월 월간 위험도`
    : "평균 산출 불가"
});

F.text(
  ".risk-message h2",
  average.count
    ? `${average.year}년 ${average.month}월 분석 가능한 거래 ${average.count}건의 가중 평균입니다.`
    : "평균을 계산할 분석 점수가 없습니다."
);

F.text(
  ".risk-message p",
  average.count
    ? `정상 ×1.0 · 관찰 ×1.2 · 주의 ×1.5 · 위험 ×2.0 · 0점 포함 · 분석 불가 ${average.excluded}건 제외`
    : "분석 가능한 거래 데이터가 없습니다."
);
      if (latest) {
        detailButton.disabled = false;
        detailButton.onclick = () => {
          location.href = F.transactionUrl("detail", latest.transaction_id);
        };
      }

      const alertList = document.getElementById("alertList");
      alertList.replaceChildren();
      const detected = items.filter((tx) => F.risk(tx.analysis).detected).slice(0, 3);
      if (!detected.length) alertList.append(F.element("p", "empty-state", "주의·위험으로 탐지된 거래가 없습니다."));
      detected.forEach((tx) => {
        const status = F.risk(tx.analysis);
        const link = F.element("a", "alert-item");
        link.href = F.transactionUrl("transaction-detail", tx.transaction_id);
        const info = F.element("div");
        info.append(
          F.element("p", "item-title", F.reasons(tx.analysis).join(" · ")),
          F.element("p", "item-description", (tx.merchant_name || "가맹점") + " · " + F.money(tx.amount))
        );
        link.append(info, F.element("span", "transaction-status " + status.type,
          status.text + " · " + (status.score ?? "-") + "점"));
        alertList.append(link);
      });

      const list = document.getElementById("transactionList");
      list.replaceChildren();
      if (!items.length) list.append(F.element("p", "empty-state", "거래내역이 없습니다."));
      items.slice(0, 5).forEach((tx) => {
        const link = F.element("a", "transaction-item");
        link.href = F.transactionUrl("transaction-detail", tx.transaction_id);
        const info = F.element("div");
        info.append(
          F.element("p", "item-title", tx.merchant_name || "가맹점"),
          F.element("p", "item-description",
            F.formatDate(tx.transaction_datetime) + " " + F.formatTime(tx.transaction_datetime)
            + " · " + F.category(tx.merchant_category))
        );
        link.append(info, F.element("span", "amount", F.money(tx.amount)));
        list.append(link);
      });
    } catch (error) {
      ["#riskScore", "#todayAmount", "#todayCount", "#alertCount"].forEach((s) => F.text(s, "-"));
      F.badge("#riskLevel", { type: "unavailable", text: "조회 실패" });
      F.text(".risk-message h2", "거래 정보를 불러오지 못했습니다.");
      F.showError(".risk-message p", error);
      F.text("#alertList", "이상행동 내역을 불러오지 못했습니다.");
      F.text("#transactionList", "거래내역을 불러오지 못했습니다.");
      detailButton.disabled = true;
    }
  }
  loadDashboard();
})();
