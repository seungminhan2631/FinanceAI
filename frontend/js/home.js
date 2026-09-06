(() => {
  "use strict";
  const F = window.FinanceAI;
  const user = F.getUser();
  const loginButton = document.getElementById("loginButton");
  const logoutButton = document.getElementById("logoutButton");
  const profileArea = document.getElementById("profileArea");
  const profileButton = document.getElementById("profileButton");
  const profileMenu = document.getElementById("profileMenu");

  if (user) {
    loginButton.hidden = true;
    profileArea.style.display = "block";
    logoutButton.style.display = "inline-block";
    document.getElementById("startButton").hidden = true;
    document.getElementById("paymentButton").style.display = "inline-flex";
    document.getElementById("guestRiskContent").hidden = true;
    document.getElementById("userRiskContent").style.display = "block";
    F.text("#profileMenuName", user.name);
    F.text("#profileMenuId", user.userId);
    F.text("#profileButton", user.name.slice(0, 1));
    F.text(".profile-menu-avatar", user.name.slice(0, 1));
    const cta = document.querySelector(".landing-cta a");
    cta.href = "./dashboard.html";
    cta.textContent = "결제내역 확인하기";
    loadHomeRisk();
  }

  async function loadHomeRisk() {
    F.text("#homeRiskScore", "-");
    F.text("#homeRiskLevel", "불러오는 중");
    F.text("#homeRisk1", "분석 정보를 불러오는 중입니다.");
    document.getElementById("homeRisk2").hidden = true;
    try {
      const items = await F.transactions();
      const latest = items[0];
      const average = F.averageRisk(items);
      F.text("#homeRiskScore", average.score ?? "-");
      F.badge("#homeRiskLevel", { type: "unavailable", text: average.count ? "이번달 평균" : "평균 산출 불가" });
      F.text("#homeAverageDescription", "분석 가능 " + average.count + "건 평균 · 0점 포함 · " + average.excluded + "건 제외");
      const detected = items.filter((tx) => F.risk(tx.analysis).detected).slice(0, 2);
      F.text("#homeRecentTitle", "최근 주의·위험 거래");
      F.text("#homeRisk1", detected.length
        ? describe(detected[0])
        : latest ? "주의·위험으로 탐지된 거래가 없습니다." : "아직 결제내역이 없습니다.");
      if (detected[1]) {
        F.text("#homeRisk2", describe(detected[1]));
        document.getElementById("homeRisk2").hidden = false;
      }
    } catch (error) {
      F.text("#homeAverageDescription", "평균 점수를 불러오지 못했습니다.");
      F.text("#homeRiskScore", "-");
      F.badge("#homeRiskLevel", { type: "unavailable", text: "조회 실패" });
      F.text("#homeRecentTitle", "분석 정보 조회 실패");
      F.showError("#homeRisk1", error);
      document.getElementById("homeRisk2").hidden = true;
    }
  }

  function describe(tx) {
    const status = F.risk(tx.analysis);
    return (tx.merchant_name || "가맹점") + " · " + status.text + " "
      + (status.score ?? "-") + "점 · " + F.reasons(tx.analysis).join(" · ");
  }

  logoutButton.addEventListener("click", () => {
    F.logout();
    location.href = "./index.html";
  });
  profileButton.setAttribute("aria-expanded", "false");
  profileButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = profileMenu.classList.toggle("show");
    profileButton.setAttribute("aria-expanded", String(open));
  });
  function closeMenu() {
    profileMenu.classList.remove("show");
    profileButton.setAttribute("aria-expanded", "false");
  }
  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
})();
