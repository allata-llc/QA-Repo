const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const {
  buildQueueSasToken,
  namespaceHost,
  publishPropertyRequest
} = require('../support/service-bus-sas');

function log(message) {
  console.log(`[service-bus-sas] ${message}`);
}

Given('the Service Bus SAS integration is configured for namespace {string}', function (namespaceName) {
  assert.ok(this.request, 'Integration request context was not initialized');
  this.sasNamespaceName = namespaceName;
  this.sasNamespaceHost = namespaceHost(process.env, namespaceName);
  log(`Namespace resolved to "${this.sasNamespaceHost}".`);
});

Given('a SAS token is generated for the {string} queue using the {string} shared access policy',
  function (queueName, policyName) {
    const { resourceUri, keyName, token, expiry } = buildQueueSasToken({
      namespaceName: this.sasNamespaceName,
      queueName,
      policyName
    });

    this.sasQueueName = queueName;
    this.sasResourceUri = resourceUri;
    this.sasToken = token;

    log(`Generated SAS token for "${resourceUri}" with policy "${keyName}", expires ${new Date(expiry * 1000).toISOString()}.`);
  });

When('I publish the property request over HTTP to the {string} queue with correlation id {string}, source system {string}, address line1 {string}, city {string}, state {string} and zip code {string}',
  async function (queueName, correlationId, sourceSystem, line1, city, state, zipCode) {
    assert.ok(this.sasToken, 'Generate a SAS token before publishing over HTTP');
    assert.equal(queueName, this.sasQueueName, 'The SAS token was generated for a different queue');

    log(`POSTing property request "${correlationId}" to queue "${queueName}"...`);
    const result = await publishPropertyRequest({
      request: this.request,
      resourceUri: this.sasResourceUri,
      token: this.sasToken,
      correlationId,
      sourceSystem,
      line1,
      city,
      state,
      zipCode
    });
    this.sasCorrelationId = result.correlationId;
    this.sasResponse = result.response;
    log(`Service Bus REST responded with status ${this.sasResponse.status()} for correlation id "${this.sasCorrelationId}".`);
  });

Then('the Service Bus REST response status is {int}', async function (expectedStatus) {
  const status = this.sasResponse.status();
  if (status !== expectedStatus) {
    const body = await this.sasResponse.text();
    assert.fail(`Expected status ${expectedStatus} but got ${status}: ${body}`);
  }
});
