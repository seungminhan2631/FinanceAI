(() => {
  "use strict";
  const F = window.FinanceAI;
  if (!F.requireUser()) return;
  let items = [];
  let filter = "all";
  const list = document.querySelector(".full-transaction-list");
  const buttons = [...document.querySelectorAll("[data-filter]")];
  buttons.forEach((button) => {
    button.disabled = true;
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      buttons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      render();
    });
  });

  function render() {
    list.replaceChildren();
    const filtered = items.filter((tx) => filter === "all" || F.risk(tx.analysis).type === filter);
    if (!filtered.length) {
      list.append(F.element("p", "empty-state", "해당 거래내역이 없습니다."));
      return;
    }
    filtered.forEach((tx) => {
      const status = F.risk(tx.analysis);
      const link = F.element("a", "full-transaction-item");
      link.href = F.transactionUrl("transaction-detail", tx.transaction_id);
      const info = F.element("div", "transaction-main-info");
      info.append(F.element("strong", "", tx.merchant_name || "가맹점"),
        F.element("span", "", F.category(tx.merchant_category)));
      const time = F.element("div", "transaction-time");
      time.append(F.element("strong", "", F.formatTime(tx.transaction_datetime)),
        F.element("span", "", F.formatDate(tx.transaction_datetime)));
      const state = F.element("div");
      state.append(F.element("span", "transaction-status " + status.type, status.text));
      link.append(info, time, F.element("div", "transaction-amount", F.money(tx.amount)), state);
      list.append(link);
    });
  }

  async function load() {
    try {
      items = await F.transactions();
      const summary = F.summary(items);
      F.text("#todayAmount", F.money(summary.amount));
      F.text("#todayCount", summary.count + "건");
      F.text("#detectedCount", summary.detectedMonthly + "건");
      render();
      buttons.forEach((button) => { button.disabled = false; });
    } catch (error) {
      ["#todayAmount", "#todayCount", "#detectedCount"].forEach((s) => F.text(s, "-"));
      F.showError(".full-transaction-list", error);
    }
  }
  load();
})();

