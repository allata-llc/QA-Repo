const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { recordsForMessage } = require('../support/notification-log');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Matches the recordKey the pipeline writes for each address.
function recordKeyFor(request) {
  return `${request.clientRef}-${request.locationNo}-${request.buildingNo}`;
}

// Callback retries write one row per attempt; keep the delivered attempt, else the newest.
function latestPerAddress(entities) {
  const byKey = new Map();
  for (const entity of entities) {
    const current = byKey.get(entity.recordKey);
    if (!current || (current.succeeded !== true && entity.succeeded === true)) {
      byKey.set(entity.recordKey, entity);
    }
  }
  return byKey;
}

function addressResult(messageId, entity) {
  let payload = {};
  try {
    payload = JSON.parse(entity.deliveredPayload ?? '{}');
  } catch {
    payload = {};
  }
  return {
    key: `${messageId}/${entity.recordKey}`,
    recordKey: entity.recordKey,
    status: payload.status ?? null,
    error: entity.resultError ?? payload.error ?? null,
    callbackHttpStatus: entity.httpStatus ?? null,
    callbackSucceeded: entity.succeeded === true
  };
}

When('I publish {int} copies of the following request to the {string} queue at the same time:',
  async function (copies, queueName, messageText) {
    const clients = this.notificationLogClients;
    assert.ok(clients, 'Configure the NotificationLog integration before publishing');
    assert.equal(queueName, clients.queueName, 'The requested queue does not match the configured queue');
    assert.ok(copies >= 1, 'Publish at least one copy');

    this.notificationLogMessage = JSON.parse(messageText);
    const runId = Date.now();
    this.notificationLogMessageIds = Array.from({ length: copies }, (_, i) => `ratelimit-${runId}-${i + 1}`);
    // One send call enqueues every copy together, so the pipeline sees them concurrently.
    await clients.serviceBusSender.sendMessages(this.notificationLogMessageIds.map(messageId => ({
      body: this.notificationLogMessage,
      contentType: 'application/json',
      messageId,
      correlationId: this.notificationLogMessage.requests[0].clientRef
    })));
    const addresses = copies * this.notificationLogMessage.requests.length;
    console.log(`[rate-limit] Published ${copies} batch(es) (${addresses} address lookups) to ${queueName}: ${this.notificationLogMessageIds.join(', ')}.`);
  });

Then('a NotificationLog record is written for every requested address within {int} seconds',
  { timeout: 20 * 60 * 1000 }, async function (timeoutSeconds) {
    const clients = this.notificationLogClients;
    const messageIds = this.notificationLogMessageIds;
    assert.ok(clients && messageIds?.length, 'Publish the batches before checking the NotificationLog table');

    const recordKeys = this.notificationLogMessage.requests.map(recordKeyFor);
    const total = messageIds.length * recordKeys.length;
    const startedAt = Date.now();
    const deadline = startedAt + timeoutSeconds * 1000;
    let lastLoggedAt = startedAt;
    let byMessage = new Map();
    const found = () => messageIds.reduce((n, id) => n + recordKeys.filter(key => byMessage.get(id)?.has(key)).length, 0);

    while (Date.now() < deadline) {
      byMessage = new Map(await Promise.all(messageIds.map(async id =>
        [id, latestPerAddress(await recordsForMessage(clients.tableClient, id))])));
      if (found() === total) break;
      if (Date.now() - lastLoggedAt >= 60 * 1000) {
        lastLoggedAt = Date.now();
        console.log(`[rate-limit] Waiting: ${found()}/${total} address record(s), ${Math.round((Date.now() - startedAt) / 1000)}s elapsed.`);
      }
      await sleep(Math.min(10 * 1000, Math.max(0, deadline - Date.now())));
    }

    const missing = messageIds.flatMap(id => recordKeys.filter(key => !byMessage.get(id)?.has(key)).map(key => `${id}/${key}`));
    assert.deepEqual(missing, [], `No NotificationLog record for ${missing.join(', ')} within ${timeoutSeconds} seconds`);

    this.addressResults = messageIds.flatMap(id => recordKeys.map(key => addressResult(id, byMessage.get(id).get(key))));
    console.log('[rate-limit] Per-address results:');
    console.table(this.addressResults.map(({ key, callbackSucceeded, ...rest }) => ({ key, ...rest })));
  });

Then('at least one address is rejected with error {string}', function (expectedError) {
  const rejected = this.addressResults.filter(result => String(result.error ?? '').includes(expectedError));
  const errorsSeen = [...new Set(this.addressResults.map(result => result.error).filter(Boolean))];
  assert.ok(
    rejected.length,
    `No address was rejected with "${expectedError}"; rate limiting depends on upstream load. Errors seen: ${errorsSeen.join(', ') || 'none'}`
  );

  for (const result of rejected) {
    assert.equal(result.status, 'failed', `${result.key} reported "${expectedError}" but has status "${result.status}"`);
  }
  this.rateLimitedKeys = new Set(rejected.map(result => result.key));
  console.log(`[rate-limit] Rate limited ${rejected.length}/${this.addressResults.length}: ${[...this.rateLimitedKeys].join(', ')}.`);
});

Then('every address that was not rate limited succeeded', function () {
  const notSucceeded = this.addressResults
    .filter(result => !this.rateLimitedKeys.has(result.key) && result.status !== 'succeeded')
    .map(result => `${result.key} (${result.status}${result.error ? `: ${result.error}` : ''})`);
  assert.deepEqual(notSucceeded, [], `Addresses that were not rate limited also failed: ${notSucceeded.join(', ')}`);
});

Then('every batch result callback is delivered with a successful HTTP status', function () {
  for (const result of this.addressResults) {
    const code = Number(String(result.callbackHttpStatus ?? '').match(/\b\d{3}\b/)?.[0]);
    assert.ok(
      result.callbackSucceeded && code >= 200 && code < 300,
      `Callback for ${result.key} was not delivered: HTTP ${result.callbackHttpStatus ?? 'not recorded'}, Succeeded ${result.callbackSucceeded}`
    );
  }
});
