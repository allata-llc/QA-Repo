const { randomUUID } = require('node:crypto');

function createUniqueCorrelationId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function createCopePipelineMessage(body, correlationId) {
  return {
    body,
    contentType: 'application/json',
    messageId: correlationId,
    correlationId
  };
}

module.exports = { createCopePipelineMessage, createUniqueCorrelationId };
