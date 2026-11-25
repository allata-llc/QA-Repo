const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { createUniqueCorrelationId } = require('../support/cope-pipeline');

const POLL_INTERVAL_MS = 15 * 1000;
const MAX_NOT_FOUND_POLLS = 8;
const TERMINAL_FAILURE_STATES = ['Failed', 'Terminated', 'Canceled'];

function log(message) {
  console.log(`[cope-gateway] ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function gatewayConfig() {
  const clientSecret = process.env.COPE_CLIENT_SECRET?.trim();
  assert.ok(clientSecret, 'Set COPE_CLIENT_SECRET to run cope gateway scenarios');
  return {
    tenantId: process.env.COPE_TENANT_ID || '03e832ce-094d-4423-b864-c11e2a626509',
    clientId: process.env.COPE_CLIENT_ID || '7001531c-5800-47e6-bf98-5edb7a883817',
    apiId: process.env.COPE_API_ID || '6eb59948-6e24-4124-8383-3acbafcd0160',
    submitUrl: process.env.COPE_SUBMIT_URL || 'https://func-sn-data-dev-gateway.azurewebsites.net/api/submit',
    callbackUrl: process.env.COPE_CALLBACK_URL || 'http://localhost:5173/',
    clientSecret
  };
}

// Client-credentials token for the gateway API. Requested fresh for each call so a long
// poll never outlives its token.
async function getAccessToken(config) {
  const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: `api://${config.apiId}/.default`
    })
  });
  assert.ok(response.ok, `Token request failed: HTTP ${response.status}`);
  const body = await response.json();
  return body.access_token;
}

Given('the Cope gateway integration is configured', function () {
  this.copeConfig = gatewayConfig();
  log(`Gateway configured: ${this.copeConfig.submitUrl}`);
});

When('I submit a property request through the cope gateway with client reference {string}, address line1 {string}, city {string}, state {string}, zip code {string} and county {string}',
  async function (clientRef, line1, city, state, zipCode, county) {
    const token = await getAccessToken(this.copeConfig);
    const body = {
      callbackUrl: this.copeConfig.callbackUrl,
      requests: [
        {
          clientRef: createUniqueCorrelationId(clientRef),
          locationNo: 1,
          buildingNo: 1,
          maxAgeDays: 365,
          address: { line1, city, state, postalCode: zipCode, county }
        }
      ]
    };

    log(`Submitting property request "${body.requests[0].clientRef}"...`);
    const response = await fetch(this.copeConfig.submitUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    assert.ok(response.ok, `Submit failed: HTTP ${response.status} ${text}`);

    const submit = JSON.parse(text);
    assert.ok(submit.status_url, `Submit response has no status_url: ${text}`);
    this.copeStatusUrl = submit.status_url;
    log(`Accepted with lookup id ${submit.lookup_id}.`);
  });

Then('the cope orchestration completes within {int} seconds', { timeout: 20 * 60 * 1000 }, async function (timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let status = null;
  let notFoundCount = 0;

  while (Date.now() < deadline) {
    const token = await getAccessToken(this.copeConfig);
    const response = await fetch(this.copeStatusUrl, { headers: { Authorization: `Bearer ${token}` } });
    // A 404 right after submit can mean the orchestration is not registered yet; allow a short window.
    if (response.status === 404 && notFoundCount < MAX_NOT_FOUND_POLLS) {
      notFoundCount++;
      log(`Status not found yet (attempt ${notFoundCount}/${MAX_NOT_FOUND_POLLS}); retrying.`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    assert.ok(response.ok, `Status poll failed: HTTP ${response.status} at ${this.copeStatusUrl}`);
    status = await response.json();
    log(`runtimeStatus=${status.runtimeStatus} phase=${status.customStatus?.phase ?? 'n/a'}`);

    if (status.runtimeStatus === 'Completed') break;
    assert.ok(!TERMINAL_FAILURE_STATES.includes(status.runtimeStatus), `Orchestration ended as ${status.runtimeStatus}`);
    await sleep(POLL_INTERVAL_MS);
  }

  assert.equal(status?.runtimeStatus, 'Completed', `Orchestration did not complete within ${timeoutSeconds}s`);
  this.copeResult = status.customStatus;
});

Then('the cope orchestration reports {int} succeeded and {int} failed', function (succeeded, failed) {
  assert.ok(this.copeResult, 'No orchestration result - the completion step has not run');
  assert.equal(this.copeResult.succeeded, succeeded);
  assert.equal(this.copeResult.failed, failed);
});

module.exports = {};
