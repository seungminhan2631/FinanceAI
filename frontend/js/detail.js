(() => {
  "use strict";
  const F = window.FinanceAI;
  if (!F.requireUser()) return;
  const content = document.getElementById("detailContent");
  const back = document.getElementById("detailBack");
  const requestedId = new URLSearchParams(location.search).get("id");
  back.href = requestedId ? F.transactionUrl("transaction-detail", requestedId) : "./dashboard.html";
  back.textContent = requestedId ? "← 거래 상세로 돌아가기" : "← 대시보드로 돌아가기";

  async function load() {
    try {
      const items = await F.transactions();
      const tx = requestedId ? items.find((item) => String(item.transaction_id) === requestedId) : items[0];
      if (!tx) throw new Error(requestedId
        ? "해당 거래를 찾을 수 없습니다. 거래내역에서 다시 선택해주세요."
        : "분석할 거래내역이 없습니다.");
      const status = F.risk(tx.analysis);
      const score = document.querySelector(".detail-risk-score");
      score.replaceChildren(document.createTextNode(String(status.score ?? "-")), F.element("span", "", " / 100"));
      F.badge(".detail-risk-box strong", status);
      F.text(".detail-header-card h2", status.type === "unavailable"
        ? "분석 데이터가 없거나 부족합니다." : "선택한 거래의 분석 결과: " + status.text);
      F.text(".detail-subtitle", F.formatDate(tx.transaction_datetime) + " · 거래 " + tx.transaction_id);

      const cards = document.querySelectorAll(".detail-grid .detail-info-card strong");
      const values = [F.money(tx.amount), F.formatTime(tx.transaction_datetime), tx.merchant_name || "가맹점"];
      cards.forEach((card, index) => { card.textContent = values[index]; });

      const reasons = F.reasons(tx.analysis);
      const list = document.querySelector(".detect-list");
      list.replaceChildren();
      reasons.forEach((reason) => {
        const item = F.element("div", "detect-item");
        item.append(F.element("p", "", reason));
        list.append(item);
      });

      const history = F.historyFor(tx, items);
      const pattern = F.pattern(history);
      const rows = document.querySelectorAll(".comparison-row");
      const comparison = [
        [pattern.average == null ? "데이터 부족" : F.money(Math.round(pattern.average)), F.money(tx.amount)],
        [pattern.time, F.formatTime(tx.transaction_datetime)],
        [pattern.category, F.category(tx.merchant_category)]
      ];
      rows.forEach((row, index) => {
        row.querySelectorAll("strong").forEach((node, column) => {
          node.textContent = comparison[index][column];
        });
      });
      F.text("#comparisonDescription", "선택한 거래 이전의 거래 " + history.length
        + "건으로 계산한 참고 비교입니다. FDS 점수 산정 기준과 다를 수 있습니다.");
      F.text(".ai-message", status.type === "unavailable"
        ? "분석 데이터가 없거나 부족하여 위험도를 확인할 수 없습니다."
        : "최종 FDS 위험도는 " + status.text + (status.score == null ? "입니다. 점수는 제공되지 않았습니다." : " " + status.score + "점입니다.")
          + " " + reasons.join(" · "));
      const followup = document.getElementById("followupNote");
      followup.hidden = !status.detected;
      content.hidden = false;
      document.getElementById("pageStatus").hidden = true;
    } catch (error) {
      content.hidden = true;
      F.showError("#pageStatus", error);
    }
  }
  load();
})();
