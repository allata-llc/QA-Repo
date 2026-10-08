const { Given, When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { createNotificationLogClients, recordsForMessage } = require('../support/notification-log');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Given('the NotificationLog integration is configured', function () {
  const clients = createNotificationLogClients();
  this.notificationLogClients = clients;
  this.serviceBusClient = clients.serviceBusClient;
  this.serviceBusSender = clients.serviceBusSender;
});

When('I publish the following request to the {string} queue:', async function (queueName, messageText) {
  const clients = this.notificationLogClients;
  assert.ok(clients, 'Configure the NotificationLog integration before publishing');
  assert.equal(queueName, clients.queueName, 'The requested queue does not match the configured queue');

  this.notificationLogMessage = JSON.parse(messageText);
  const messageId = `notification-${Date.now()}`;
  this.notificationLogMessageId = messageId;
  await clients.serviceBusSender.sendMessages({
    body: this.notificationLogMessage,
    contentType: 'application/json',
    messageId,
    correlationId: this.notificationLogMessage.requests[0].clientRef
  });
  console.log(`[notification-log] Published message ${messageId} to ${queueName}.`);
});

Then('the latest NotificationLog record has a successful HTTP status and Succeeded is true within {int} seconds',
  { timeout: 15 * 60 * 1000 }, async function (timeoutSeconds) {
    const clients = this.notificationLogClients;
    const messageId = this.notificationLogMessageId;
    assert.ok(clients && messageId, 'Publish a request before checking the NotificationLog table');
    const startedAt = Date.now();
    const deadline = startedAt + timeoutSeconds * 1000;
    let records = [];
    let lastLoggedAt = startedAt;

    while (Date.now() < deadline) {
      records = await recordsForMessage(clients.tableClient, messageId);
      if (records.some(entity => entity.succeeded === true)) break;
      if (Date.now() - lastLoggedAt >= 60 * 1000) {
        lastLoggedAt = Date.now();
        console.log(`[notification-log] Waiting for ${messageId}: ${records.length} attempt(s) so far, ${Math.round((Date.now() - startedAt) / 1000)}s elapsed.`);
      }
      await sleep(Math.min(10 * 1000, Math.max(0, deadline - Date.now())));
    }

    assert.ok(records.length, `No NotificationLog record for message ${messageId} appeared within ${timeoutSeconds} seconds`);
    const record = records.find(entity => entity.succeeded === true) ?? records[0];
    const httpStatusValue = findField(record, ['httpstatus', 'httpstatuscode', 'statuscode']);
    const httpStatusMatch = String(httpStatusValue ?? '').match(/\b\d{3}\b/);
    const httpStatus = httpStatusMatch ? Number(httpStatusMatch[0]) : null;
    const succeededValue = findField(record, ['succeeded']);
    const succeeded = succeededValue === true || /^(true|1|yes)$/i.test(String(succeededValue));
    const error = findField(record, ['error']);

    console.log(`[notification-log] Latest record: HTTP status ${httpStatus ?? 'not recorded'}, Succeeded ${String(succeededValue)}${error ? `, error ${error}` : ''}.`);
    if (httpStatus !== null) {
      assert.ok(Number.isInteger(httpStatus) && httpStatus >= 200 && httpStatus < 300,
        `Expected a successful 2xx HTTP status, got ${String(httpStatus)}`);
    }
    assert.equal(succeeded, true, `Expected Succeeded to be true, got ${String(succeededValue)}`);
  });

function findField(entity, candidateNames) {
  const candidates = new Set(candidateNames.map(name => name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const entry = Object.entries(entity).find(([name]) =>
    candidates.has(name.toLowerCase().replace(/[^a-z0-9]/g, ''))
  );
  return entry?.[1];
}