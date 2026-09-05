(() => {
  const nameElement = document.getElementById("header-user-name");
  const ageElement = document.getElementById("header-user-age");

  const userName = localStorage.getItem("userName");
  const birthDate = localStorage.getItem("birthDate");

  if (nameElement) {
    nameElement.textContent = userName || "사용자";
  }

  if (!ageElement) {
    return;
  }

  if (!birthDate) {
    ageElement.textContent = "";
    return;
  }

  const birth = new Date(birthDate);

  if (isNaN(birth.getTime())) {
    ageElement.textContent = "";
    return;
  }

  const today = new Date();

  let age = today.getFullYear() - birth.getFullYear();

  const birthdayNotPassed =
    today.getMonth() < birth.getMonth() ||
    (
      today.getMonth() === birth.getMonth() &&
      today.getDate() < birth.getDate()
    );

  if (birthdayNotPassed) {
    age--;
  }

  ageElement.textContent = `${age}세`;
})();