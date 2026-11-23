const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { AzurePortalPage } = require('../pages/azure-portal.page');
const { signInWithTotp } = require('../support/microsoft-login');

const defaultStorageStatePath = path.join(__dirname, '..', '..', '.auth', 'azure-portal-state.json');

// Two sign-in paths:
// 1. TOTP (the only path used in CI) - set AZURE_PORTAL_USERNAME/AZURE_PORTAL_PASSWORD/
//    TOTP_SECRET for a dedicated automation account enrolled with an authenticator app; a real
//    MFA code is generated and submitted fresh every run, so there is nothing to expire.
// 2. Storage state (local development only) - reuses a session captured via
//    `npm run auth:azure-portal` so you don't re-authenticate on every local run. It expires
//    within hours, which is why CI refuses to use it.
Given('I am signed in to the Azure Portal', { timeout: 180 * 1000 }, async function () {
  // Headed by default so the navigation is visible; set AZURE_PORTAL_HEADLESS=true to run headless.
  // --disable-http2: ARM's batch endpoint (used by the Storage Browser blade) intermittently
  // fails with net::ERR_HTTP2_PROTOCOL_ERROR on this network, which silently hangs the blade's
  // "Loading..." state forever; forcing HTTP/1.1 avoids that failure mode.
  const launchArgs = ['--disable-http2'];

  // Set AZURE_PORTAL_FORCE_LOGIN=true to disable Kerberos/NTLM integrated auth. Note this
  // does not defeat device-certificate SSO on an Entra-joined machine, where sign-in
  // completes without credentials regardless - the password/TOTP path only really runs on a
  // non-joined host such as a CI runner.
  if (process.env.AZURE_PORTAL_FORCE_LOGIN === 'true') {
    launchArgs.push('--auth-server-allowlist=.invalid', '--auth-negotiate-delegate-allowlist=.invalid');
  }

  this.azureBrowser = await chromium.launch({
    headless: process.env.AZURE_PORTAL_HEADLESS === 'true',
    slowMo: 250,
    args: launchArgs
  });

  const { AZURE_PORTAL_USERNAME, AZURE_PORTAL_PASSWORD, TOTP_SECRET } = process.env;
  const useTotpLogin = Boolean(AZURE_PORTAL_USERNAME && AZURE_PORTAL_PASSWORD && TOTP_SECRET);

  if (useTotpLogin) {
    this.azureContext = await this.azureBrowser.newContext();
    this.azurePage = await this.azureContext.newPage();
    this.azurePage.setDefaultTimeout(100 * 1000);
    this.azurePortal = new AzurePortalPage(this.azurePage);
    await signInWithTotp(this.azurePage, {
      username: AZURE_PORTAL_USERNAME,
      password: AZURE_PORTAL_PASSWORD,
      totpSecret: TOTP_SECRET
    });
    return;
  }

  // A captured session expires within hours, so in CI it is guaranteed to fail sooner or
  // later. Refusing it here makes that a configuration error instead of a random red build.
  assert.ok(
    !process.env.CI,
    'Azure Portal sign-in in CI requires AZURE_PORTAL_USERNAME, AZURE_PORTAL_PASSWORD and TOTP_SECRET. ' +
      'The captured storage state is for local development only - it expires within hours.'
  );

  const storageStatePath = process.env.AZURE_PORTAL_STORAGE_STATE || defaultStorageStatePath;
  assert.ok(
    fs.existsSync(storageStatePath),
    `No storage state found at ${storageStatePath}. Run "npm run auth:azure-portal" to sign in once and capture it, ` +
      'or set AZURE_PORTAL_USERNAME/AZURE_PORTAL_PASSWORD/TOTP_SECRET to sign in automatically.'
  );
  this.azureContext = await this.azureBrowser.newContext({ storageState: storageStatePath });
  this.azurePage = await this.azureContext.newPage();
  // Azure Portal's React blades can take a while to load, so allow more than the 30s default
  // (kept below the 180s per-step Cucumber timeout so a real failure surfaces Playwright's own error).
  this.azurePage.setDefaultTimeout(100 * 1000);
  this.azurePortal = new AzurePortalPage(this.azurePage);
  await this.azurePortal.gotoPortal();

  // Fail fast (seconds, not the ~3-5 minutes a full run takes) if the captured session expired -
  // an expired/stale storage state redirects to the Azure AD login page instead of the portal.
  const landedUrl = this.azurePage.url();
  assert.ok(
    !landedUrl.includes('login.microsoftonline.com'),
    `Azure Portal storage state at "${storageStatePath}" has expired (redirected to Azure AD login). ` +
      'Re-capture it with "npm run auth:azure-portal", or set ' +
      'AZURE_PORTAL_USERNAME/AZURE_PORTAL_PASSWORD/TOTP_SECRET for a permanent fix.'
  );
});

When('I select the subscription {string}', { timeout: 120 * 1000 }, async function (subscriptionId) {
  await this.azurePortal.selectSubscription(subscriptionId);
});

When('I navigate to the resource group {string}', { timeout: 120 * 1000 }, async function (resourceGroupName) {
  await this.azurePortal.openResourceGroup(resourceGroupName);
});

When('I open the Service Bus namespace {string}', { timeout: 120 * 1000 }, async function (namespaceName) {
  await this.azurePortal.openResource(namespaceName);
});

When('I open {string} under the {string} section', { timeout: 120 * 1000 }, async function (entityLabel, sectionLabel) {
  await this.azurePortal.openEntitiesSection(entityLabel, sectionLabel);
});

When('I select the queue {string}', { timeout: 120 * 1000 }, async function (queueName) {
  await this.azurePortal.selectQueue(queueName);
});

Then('I should land on the {string} queue Overview page', { timeout: 120 * 1000 }, async function (queueName) {
  await this.azurePortal.assertOnQueueOverview(queueName);
});

When('I open the Service Bus Explorer for the queue', { timeout: 120 * 1000 }, async function () {
  await this.azurePortal.openServiceBusExplorer();
});

When('I show the property request payload in the Service Bus Explorer for correlation id {string}, source system {string}, address line1 {string}, city {string}, state {string} and zip code {string}',
  { timeout: 60 * 1000 }, async function (correlationId, sourceSystem, line1, city, state, zipCode) {
    await this.azurePortal.showPropertyRequestPayload({ correlationId, sourceSystem, line1, city, state, zipCode });
  });

When('I peek the published message in the Service Bus Explorer', { timeout: 60 * 1000 }, async function () {
  await this.azurePortal.peekPublishedMessage();
});

When('I refresh the queue Overview page to see the published message', { timeout: 120 * 1000 }, async function () {
  await this.azurePortal.refreshQueueOverview();
});

After({ tags: '@azure-portal' }, async function () {
  // Keep the final blob content visible for a while instead of closing immediately.
  if (this.azurePage) await this.azurePage.waitForTimeout(45 * 1000);
  if (this.azureContext) await this.azureContext.close();
  if (this.azureBrowser) await this.azureBrowser.close();
});
