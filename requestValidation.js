const CATEGORY_MAP = {
  식비: "FOOD",
  음식점: "FOOD",
  식당: "FOOD",
  카페: "CAFE",
  편의점: "CONVENIENCE",
  쇼핑: "SHOPPING",
  교통: "TRANSPORT",
  게임: "GAME_DIGITAL",
  교육: "EDUCATION",
  도서문구: "BOOK_STATIONERY",
  상품권: "GIFT_CARD",
  기타: "ETC",
};

const ALLOWED_CATEGORIES = new Set([
  "FOOD",
  "CAFE",
  "CONVENIENCE",
  "SHOPPING",
  "TRANSPORT",
  "GAME_DIGITAL",
  "EDUCATION",
  "BOOK_STATIONERY",
  "GIFT_CARD",
  "ETC",
]);

const MAX_POSTGRES_INTEGER = 2147483647;
const MAX_TRANSACTION_ID_LENGTH = 20;

function normalizeTransactionId(transactionId) {
  if (typeof transactionId !== "string") {
    return null;
  }

  const trimmedTransactionId = transactionId.trim();

  if (
    !trimmedTransactionId ||
    trimmedTransactionId.length > MAX_TRANSACTION_ID_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(trimmedTransactionId)
  ) {
    return null;
  }

  return trimmedTransactionId;
}

function normalizeUserId(userId) {
  if (typeof userId === "number") {
    if (!Number.isInteger(userId) || userId < 1 || userId > 999) {
      return null;
    }

    return `U${String(userId).padStart(3, "0")}`;
  }

  if (typeof userId !== "string") {
    return null;
  }

  const trimmedUserId = userId.trim();

  if (/^\d{1,3}$/.test(trimmedUserId)) {
    const numericUserId = Number(trimmedUserId);

    if (numericUserId < 1) {
      return null;
    }

    return `U${String(numericUserId).padStart(3, "0")}`;
  }

  if (/^U\d{3}$/i.test(trimmedUserId) && trimmedUserId.slice(1) !== "000") {
    return trimmedUserId.toUpperCase();
  }

  return null;
}

function normalizeMerchantCategory(merchantCategory) {
  if (typeof merchantCategory !== "string") {
    return null;
  }

  const trimmedCategory = merchantCategory.trim();

  if (!trimmedCategory) {
    return null;
  }

  const normalizedCategory =
    CATEGORY_MAP[trimmedCategory] || trimmedCategory.toUpperCase();

  return ALLOWED_CATEGORIES.has(normalizedCategory)
    ? normalizedCategory
    : null;
}

function validateTransactionRequest(body) {
  const requestBody = body && typeof body === "object" ? body : {};
  const normalizedUserId = normalizeUserId(requestBody.userId);

  if (!normalizedUserId) {
    return {
      valid: false,
      error: 'userId는 1~999의 숫자 또는 "U001" 형식이어야 합니다.',
    };
  }

  if (
    typeof requestBody.amount !== "number" ||
    !Number.isFinite(requestBody.amount) ||
    !Number.isInteger(requestBody.amount) ||
    requestBody.amount < 1 ||
    requestBody.amount > MAX_POSTGRES_INTEGER
  ) {
    return {
      valid: false,
      error: `amount는 1 이상 ${MAX_POSTGRES_INTEGER} 이하의 유효한 정수여야 합니다.`,
    };
  }

  if (
    typeof requestBody.merchantName !== "string" ||
    !requestBody.merchantName.trim()
  ) {
    return {
      valid: false,
      error: "merchantName은 비어 있을 수 없습니다.",
    };
  }

  const normalizedMerchantName = requestBody.merchantName.trim();

  if (normalizedMerchantName.length > 100) {
    return {
      valid: false,
      error: "merchantName은 100자를 초과할 수 없습니다.",
    };
  }

  const normalizedCategory = normalizeMerchantCategory(
    requestBody.merchantCategory
  );

  if (!normalizedCategory) {
    return {
      valid: false,
      error: "지원하지 않는 merchantCategory입니다.",
    };
  }

  const hasExternalTransactionId = Object.prototype.hasOwnProperty.call(
    requestBody,
    "transactionId",
  );
  const normalizedTransactionId = hasExternalTransactionId
    ? normalizeTransactionId(requestBody.transactionId)
    : null;

  if (hasExternalTransactionId && !normalizedTransactionId) {
    return {
      valid: false,
      error:
        "transactionId는 1~20자의 영문, 숫자, 밑줄 또는 하이픈이어야 합니다.",
    };
  }

  return {
    valid: true,
    value: {
      userId: normalizedUserId,
      amount: requestBody.amount,
      merchantName: normalizedMerchantName,
      merchantCategory: normalizedCategory,
      transactionId: normalizedTransactionId,
    },
  };
}

module.exports = {
  ALLOWED_CATEGORIES,
  normalizeMerchantCategory,
  normalizeTransactionId,
  normalizeUserId,
  validateTransactionRequest,
};
