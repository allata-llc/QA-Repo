const { randomUUID } = require('node:crypto');

function createUniqueCorrelationId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

module.exports = { createUniqueCorrelationId };
