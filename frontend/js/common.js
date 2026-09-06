(() => {
  "use strict";

  const API_BASE_URL = "https://financeai-production-987f.up.railway.app";
  const DEMO_USER_ID = "U002";
  const USER_KEYS = ["isLoggedIn", "userId", "userName", "birthDate", "phone"];
  const categories = {
    FOOD: "식비", CAFE: "카페", CONVENIENCE: "편의점", SHOPPING: "쇼핑",
    TRANSPORT: "교통", GAME_DIGITAL: "게임", EDUCATION: "교육",
    BOOK_STATIONERY: "도서", GIFT_CARD: "상품권", ETC: "기타"
  };
  const ruleNames = {
    RAPID_PAYMENT: "단시간 반복 결제",
    DAILY_SPEND_SPIKE: "하루 소비 급증",
    HIGH_AMOUNT: "평소보다 높은 결제 금액",
    AMOUNT_SPIKE: "평소보다 높은 결제 금액",
    LATE_NIGHT: "심야 결제",
    NIGHT_PAYMENT: "심야 결제",
    NEW_CATEGORY: "새로운 업종 결제"
  };

  function clean(value) {
    const text = value == null ? "" : String(value).trim();
    return ["undefined", "null"].includes(text) ? "" : text;
  }

  function getUser() {
    const userId = clean(localStorage.getItem("userId"));
    if (localStorage.getItem("isLoggedIn") !== "true" || !userId) return null;
    return {
      userId,
      name: clean(localStorage.getItem("userName")) || userId,
      birthDate: clean(localStorage.getItem("birthDate")),
      phone: clean(localStorage.getItem("phone"))
    };
  }

  function logout() {
    USER_KEYS.forEach((key) => localStorage.removeItem(key));
  }

  function saveUser(user) {
    if (!user || !clean(user.userId) || !clean(user.name)) {
      throw new Error("로그인 응답에 사용자 정보가 없습니다. 다시 로그인해주세요.");
    }
    logout();
    const values = {
      userId: clean(user.userId), userName: clean(user.name),
      birthDate: clean(user.birthDate), phone: clean(user.phone)
    };
    try {
      Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
      localStorage.setItem("isLoggedIn", "true");
    } catch (error) {
      logout();
      throw error;
    }
  }

  function requireUser() {
    const user = getUser();
    if (!user) {
      logout();
      window.location.replace("./login.html");
    }
    return user;
  }

  function asDate(value) {
    if (value == null || value === "") return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateKey(value) {
    const date = asDate(value);
    return date ? new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date) : "";
  }

  function formatDate(value) {
    const date = asDate(value);
    return date ? new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date) : "정보 없음";
  }

  function formatTime(value) {
    const date = asDate(value);
    return date ? new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).format(date) : "정보 없음";
  }

  function number(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function money(value) {
    const amount = number(value);
    return amount == null ? "정보 없음" : amount.toLocaleString("ko-KR") + "원";
  }

  function birthKey(value) {
    const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(clean(value));
    if (!match) return "";
    const date = asDate(match[1] + "T00:00:00Z");
    return date && date.toISOString().slice(0, 10) === match[1] ? match[1] : "";
  }

  function age(value) {
    const birth = birthKey(value);
    const today = dateKey(new Date());
    if (!birth || birth > today) return null;
    return Number(today.slice(0, 4)) - Number(birth.slice(0, 4))
      - (today.slice(5) < birth.slice(5) ? 1 : 0);
  }

  function risk(analysis) {
    const level = clean(analysis?.risk?.level).toUpperCase();
    const states = {
  LOW: ["normal", "정상"],
  NORMAL: ["normal", "정상"],

  MONITOR: ["monitor", "관찰"],
  WATCH: ["monitor", "관찰"],
  OBSERVE: ["monitor", "관찰"],
  OBSERVATION: ["monitor", "관찰"],

  CAUTION: ["warning", "주의"],
  WARNING: ["warning", "주의"],

  HIGH: ["danger", "위험"],
  DANGER: ["danger", "위험"]
};
    const state = analysis?.available !== false && states[level];
    if (!state) return { type: "unavailable", text: "분석 불가", score: null, detected: false };
    const rawScore = number(analysis.risk.combinedScore) ?? number(analysis.risk.weightedScore);
    return {
      type: state[0], text: state[1],
      score: rawScore != null && rawScore >= 0 && rawScore <= 100 ? rawScore : null,
      detected: ["warning", "danger"].includes(state[0])
    };
  }

  function reasons(analysis) {
    if (risk(analysis).type === "unavailable") return ["분석 데이터가 없거나 부족합니다."];
    const rules = Array.isArray(analysis?.rule?.detectedRules) ? analysis.rule.detectedRules : [];
    const labels = rules.map((rule) => {
      if (typeof rule === "string") return ruleNames[rule] || rule;
      if (!rule || typeof rule !== "object") return "";
      const code = clean(rule.code);
      return clean(rule.description) || ruleNames[code] || clean(rule.name) || code;
    }).filter(Boolean);
    if (labels.length) return [...new Set(labels)];
    const status = risk(analysis);
    if (status.detected) return ["FDS 분석에서 이상 패턴이 탐지되었습니다. 개별 탐지 사유는 제공되지 않았습니다."];
    if (status.type === "monitor") return ["소비 패턴의 추가 관찰이 필요한 거래입니다."];
    return ["이상행동 탐지 없음"];
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(API_BASE_URL + path, {
        ...options, signal: controller.signal, cache: "no-store"
      });
      let data;
      try { data = await response.json(); }
      catch { throw new Error("서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도해주세요."); }
      if (!response.ok || !data?.success) {
        throw new Error(clean(data?.message || data?.error) || "요청을 처리하지 못했습니다.");
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("서버 응답이 지연되고 있습니다. 다시 시도해주세요.");
      if (error instanceof TypeError) throw new Error("서버에 연결하지 못했습니다. 연결 상태를 확인해주세요.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function transactions() {
    const data = await request("/api/transactions");
    if (!Array.isArray(data.transactions)) throw new Error("거래내역 응답 형식이 올바르지 않습니다.");
    return data.transactions.filter((tx) =>
      tx && String(tx.user_id ?? tx.userId) === DEMO_USER_ID
    ).sort((a, b) =>
      (asDate(b.transaction_datetime)?.getTime() ?? 0)
      - (asDate(a.transaction_datetime)?.getTime() ?? 0)
    );
  }

  function averageRisk(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      score: null,
      count: 0,
      excluded: 0,
      year: null,
      month: null
    };
  }

  // U002 거래 중 가장 최근 거래가 존재하는 월 찾기
  const monthKeys = items
    .map((tx) => dateKey(tx.transaction_datetime).slice(0, 7))
    .filter(Boolean)
    .sort()
    .reverse();

  const latestMonthKey = monthKeys[0];

  if (!latestMonthKey) {
    return {
      score: null,
      count: 0,
      excluded: items.length,
      year: null,
      month: null
    };
  }

  // 가장 최근 월의 거래만 사용
  const monthlyItems = items.filter((tx) => {
    return (
      dateKey(tx.transaction_datetime).slice(0, 7) ===
      latestMonthKey
    );
  });

  let totalScore = 0;
  let analyzedCount = 0;
  let excludedCount = 0;

  monthlyItems.forEach((tx) => {
    const status = risk(tx.analysis);

    // 분석 불가는 계산에서 제외
    // 단, 0점은 정상적인 점수이므로 포함
    if (
      status.type === "unavailable" ||
      status.score == null
    ) {
      excludedCount++;
      return;
    }

    let weight = 1.0;

    // 정상
    if (status.type === "normal") {
      weight = 1.0;
    }

    // 관찰
    else if (status.type === "monitor") {
      weight = 1.2;
    }

    // 주의
    else if (status.type === "warning") {
      weight = 1.5;
    }

    // 위험
    else if (status.type === "danger") {
      weight = 2.0;
    }

    // 가중치 적용 후 최대 100점
    const adjustedScore = Math.min(
      100,
      status.score * weight
    );

    totalScore += adjustedScore;
    analyzedCount++;
  });

  const [year, month] = latestMonthKey.split("-");

  return {
    score:
      analyzedCount > 0
        ? Math.round(totalScore / analyzedCount)
        : null,

    count: analyzedCount,
    excluded: excludedCount,
    year: Number(year),
    month: Number(month)
  };
}

  function summary(items) {
  const today = dateKey(new Date());

  // 오늘 거래
  const todayItems = items.filter((tx) =>
    dateKey(tx.transaction_datetime) === today
  );

  const amounts = todayItems.map((tx) => number(tx.amount));

  // 이번 달 YYYY-MM
  const currentMonth = today.slice(0, 7);

  // 이번 달 거래
  const monthlyItems = items.filter((tx) =>
    dateKey(tx.transaction_datetime).slice(0, 7) === currentMonth
  );

  return {
    // 오늘 결제 금액
    amount: amounts.some((value) => value == null)
      ? null
      : amounts.reduce((sum, value) => sum + value, 0),

    // 오늘 결제 횟수
    count: todayItems.length,

    // 전체 기간 이상행동 탐지
    detectedTotal: items.filter((tx) =>
      risk(tx.analysis).detected
    ).length,

    // 이번 달 이상행동 탐지
    detectedMonthly: monthlyItems.filter((tx) =>
      risk(tx.analysis).detected
    ).length
  };
}

  function historyFor(transaction, items) {
    const current = asDate(transaction.transaction_datetime);
    if (!current) return [];
    return items.filter((tx) =>
      String(tx.user_id ?? tx.userId) === String(transaction.user_id ?? transaction.userId)
      && String(tx.transaction_id) !== String(transaction.transaction_id)
      && asDate(tx.transaction_datetime)
      && asDate(tx.transaction_datetime) < current
    );
  }

  function pattern(items) {
    const amounts = items.map((tx) => number(tx.amount)).filter((value) => value != null);
    const ranges = ["00:00 ~ 06:00", "06:00 ~ 12:00", "12:00 ~ 18:00", "18:00 ~ 24:00"];
    const times = new Map(), counts = new Map();
    items.forEach((tx) => {
      const time = formatTime(tx.transaction_datetime);
      if (time !== "정보 없음") {
        const range = ranges[Math.floor(Number(time.slice(0, 2)) / 6)];
        times.set(range, (times.get(range) || 0) + 1);
      }
      const value = category(tx.merchant_category);
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    const most = (map) => [...map].sort((a, b) => b[1] - a[1])[0]?.[0] || "데이터 부족";
    return {
      average: amounts.length ? amounts.reduce((sum, value) => sum + value, 0) / amounts.length : null,
      time: most(times), category: most(counts)
    };
  }

  function category(value) { return categories[value] || clean(value) || "정보 없음"; }
  function text(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  }
  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = value;
    return node;
  }
  function badge(selector, status) {
    const node = document.querySelector(selector);
    if (node) {
      node.textContent = status.text;
      node.className = "transaction-status " + status.type;
    }
  }
  function transactionUrl(page, id) {
    return "./" + page + ".html?id=" + encodeURIComponent(id);
  }
  function showError(selector, error) {
    const node = document.querySelector(selector);
    if (node) {
      node.textContent = error.message || "정보를 불러오지 못했습니다.";
      node.setAttribute("role", "alert");
    }
  }

  document.querySelectorAll("[data-back-fallback]").forEach((button) => {
    button.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = button.dataset.backFallback;
      }
    });
  });

  window.FinanceAI = {
    DEMO_USER_ID, clean, getUser, requireUser, logout, saveUser, request, transactions,
    risk, reasons, averageRisk, summary, historyFor, pattern, birthKey, age, dateKey,
    formatDate, formatTime, money, number, category, text, element, badge, transactionUrl, showError
  };
})();
