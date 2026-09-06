(() => {
  "use strict";
  const F = window.FinanceAI;
  const user = F.getUser();
  F.text("#header-user-name", user?.name || "사용자");
  const age = user ? F.age(user.birthDate) : null;
  F.text("#header-user-age", age == null ? "" : age + "세");
})();
