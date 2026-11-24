const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createUniqueCorrelationId } = require('./cope-pipeline');

const DEFAULT_SAS_TTL_SECONDS = 3600;
const SERVICE_BUS_API_VERSION = '2021-05';

function namespaceHost(env = process.env, namespaceName) {
  const fqdn = env.SERVICE_BUS_NAMESPACE_FQDN?.trim();
  if (fqdn) return fqdn;

  assert.ok(
    namespaceName,
    'Set SERVICE_BUS_NAMESPACE_FQDN (e.g. cope-pocsb.servicebus.windows.net) to run SAS scenarios'
  );
  return `${namespaceName}.servicebus.windows.net`;
}

// Each queue carries its own "bulk-send-key" policy with a different key, so keys are looked up
// per queue first: SERVICE_BUS_SAS_KEY_COPE_REQUESTS_DEV for "cope-requests-dev", and so on.
function envSuffix(queueName) {
  return queueName.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

function resolveSasPolicy(env = process.env, policyName, queueName) {
  const suffix = queueName ? envSuffix(queueName) : null;
  const keyName =
    policyName ||
    (suffix && env[`SERVICE_BUS_SAS_KEY_NAME_${suffix}`]?.trim()) ||
    env.SERVICE_BUS_SAS_KEY_NAME?.trim();
  const key =
    (suffix && env[`SERVICE_BUS_SAS_KEY_${suffix}`]?.trim()) || env.SERVICE_BUS_SAS_KEY?.trim();

  assert.ok(keyName, 'Set SERVICE_BUS_SAS_KEY_NAME (e.g. bulk-send-key) to run SAS scenarios');
  assert.ok(
    key,
    `Set SERVICE_BUS_SAS_KEY_${suffix || '<QUEUE>'} to the primary key of the "${keyName}" policy on queue "${queueName}" to run SAS scenarios`
  );

  return { keyName, key };
}

// Mirrors the Service Bus SAS contract: HMAC-SHA256 over "<url-encoded-uri>\n<expiry>".
function generateSasToken(resourceUri, keyName, key, expirySeconds = DEFAULT_SAS_TTL_SECONDS) {
  const expiry = Math.floor(Date.now() / 1000) + expirySeconds;
  const encodedUri = encodeURIComponent(resourceUri);
  const signature = crypto
    .createHmac('sha256', key)
    .update(`${encodedUri}\n${expiry}`)
    .digest('base64');

  return {
    token: `SharedAccessSignature sr=${encodedUri}&sig=${encodeURIComponent(signature)}&se=${expiry}&skn=${encodeURIComponent(keyName)}`,
    expiry
  };
}

function buildQueueSasToken({ env = process.env, namespaceName, queueName, policyName, ttlSeconds } = {}) {
  const resourceUri = `https://${namespaceHost(env, namespaceName)}/${queueName}`;
  const { keyName, key } = resolveSasPolicy(env, policyName, queueName);
  const ttl = Number(ttlSeconds || env.SERVICE_BUS_SAS_TTL_SECONDS || DEFAULT_SAS_TTL_SECONDS);
  const { token, expiry } = generateSasToken(resourceUri, keyName, key, ttl);

  return { resourceUri, keyName, token, expiry };
}

function messagesUrl(resourceUri) {
  return `${resourceUri}/messages?timeout=60&api-version=${SERVICE_BUS_API_VERSION}`;
}

// The REST send API carries messageId/correlationId in the BrokerProperties header, not the body.
function brokerProperties({ messageId, correlationId, label }) {
  return JSON.stringify({
    ...(messageId ? { MessageId: messageId } : {}),
    ...(correlationId ? { CorrelationId: correlationId } : {}),
    ...(label ? { Label: label } : {})
  });
}

async function publishPropertyRequest({ request, resourceUri, token, correlationId, sourceSystem, line1, city, state, zipCode }) {
  const uniqueCorrelationId = createUniqueCorrelationId(correlationId);
  const message = {
    requestMetadata: {
      correlationId: uniqueCorrelationId,
      sourceSystem,
      requestTimestamp: new Date().toISOString()
    },
    propertyAddress: { line1, line2: '', city, state, zipCode }
  };
  const response = await request.post(messagesUrl(resourceUri), {
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      BrokerProperties: brokerProperties({ messageId: uniqueCorrelationId, correlationId: uniqueCorrelationId })
    },
    data: JSON.stringify(message)
  });
  return { correlationId: uniqueCorrelationId, response };
}

module.exports = {
  SERVICE_BUS_API_VERSION,
  brokerProperties,
  buildQueueSasToken,
  generateSasToken,
  messagesUrl,
  namespaceHost,
  publishPropertyRequest
};
