(() => {
  "use strict";
  const F = window.FinanceAI;
  const form = document.querySelector("#loginForm, #signupForm");
  if (!form) return;
  const signup = form.id === "signupForm";
  const status = document.getElementById("authStatus");
  let submitting = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || !form.reportValidity()) return;
    status.textContent = "";
    const value = (id) => document.getElementById(id).value;
    const userId = value(signup ? "signupId" : "userId").trim();
    const password = value(signup ? "signupPassword" : "password");
    const body = { userId, password };
    if (!userId || !password) {
      status.textContent = "아이디와 비밀번호를 입력해주세요.";
      return;
    }
    if (signup) {
      body.name = value("name").trim();
      body.birthDate = value("birthDate");
      body.phone = value("phone").trim();
      if (!body.name || !body.phone) {
        status.textContent = "이름과 휴대폰 번호를 입력해주세요.";
        return;
      }
      if (password !== value("passwordConfirm")) {
        status.textContent = "비밀번호가 일치하지 않습니다.";
        return;
      }
      if (!F.birthKey(body.birthDate) || F.age(body.birthDate) == null) {
        status.textContent = "올바른 생년월일을 입력해주세요.";
        return;
      }
    }
    const button = form.querySelector('button[type="submit"]');
    submitting = true;
    button.disabled = true;
    status.textContent = signup ? "회원가입 중입니다." : "로그인 중입니다.";
    try {
      const data = await F.request(signup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!signup) F.saveUser(data.user);
      location.href = signup ? "./login.html?signup=success" : "./index.html";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submitting = false;
      button.disabled = false;
    }
  });
  if (signup) {
    document.getElementById("birthDate").max = F.dateKey(new Date());
  } else if (new URLSearchParams(location.search).get("signup") === "success") {
    status.textContent = "회원가입이 완료되었습니다. 로그인해주세요.";
  }
})();
