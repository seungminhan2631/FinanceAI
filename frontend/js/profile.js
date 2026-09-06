(() => {
  "use strict";
  const F = window.FinanceAI;
  const user = F.requireUser();
  if (!user) return;
  F.text("#profileDisplayName", user.name);
  F.text("#profileDisplayId", user.userId);
  F.text(".profile-large-avatar", user.name.slice(0, 1));
  const values = {
    profileName: user.name, profileId: user.userId,
    profileBirth: F.birthKey(user.birthDate), profilePhone: user.phone,
    profileRegion: "", guardianPhone: ""
  };
  Object.entries(values).forEach(([id, value]) => {
    const input = document.getElementById(id);
    input.value = value;
    input.placeholder = "정보 없음";
  });
})();
