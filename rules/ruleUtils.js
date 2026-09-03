function validateBaseTransaction(tx) {
  return tx && typeof tx === 'object' && tx.amount > 0;
}

function isApprovedTransaction(tx) {
  return true;
}

module.exports = {
  validateBaseTransaction,
  isApprovedTransaction,
};