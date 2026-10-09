const assert = require('node:assert/strict');
const { ServiceBusClient } = require('@azure/service-bus');
const { BlobServiceClient } = require('@azure/storage-blob');
const { Given, When, Then } = require('@cucumber/cucumber');
const { createAzureCredential } = require('../support/azure-credential');
const { createUniqueCorrelationId } = require('../support/cope-pipeline');

const serviceBusNamespace = () => {
  const fqdn = process.env.SERVICE_BUS_NAMESPACE_FQDN;
  assert.ok(fqdn, 'Set SERVICE_BUS_NAMESPACE_FQDN (e.g. pocsb.servicebus.windows.net) to run cope pipeline scenarios');
  return fqdn;
};

const storageAccountUrl = () => {
  const url = process.env.STORAGE_ACCOUNT_URL;
  assert.ok(url, 'Set STORAGE_ACCOUNT_URL (e.g. https://pocsa.blob.core.windows.net) to run cope pipeline scenarios');
  return url;
};

const queueName = () => process.env.COPE_QUEUE_NAME || 'cope_request';
const outputContainerName = () => process.env.COPE_OUTPUT_CONTAINER || 'cope-agent-responses';
const pollIntervalMs = () => Number(process.env.OUTPUT_POLL_INTERVAL_MS || 5000);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(message) {
  // Plain console.log so progress is visible in the terminal in real time, since these
  // steps call the Azure SDK directly and produce no browser activity to watch.
  console.log(`[cope-pipeline] ${message}`);
}

// Auth order is deliberate: federated identity first (nothing stored, nothing expires),
// then shared-secret fallbacks for environments where creating an app registration or
// assigning RBAC needs an administrator.
function buildServiceBusClient() {
  const connection = process.env.SERVICE_BUS_CONNECTION?.trim();
  if (connection) {
    log('Service Bus: using SERVICE_BUS_CONNECTION.');
    return new ServiceBusClient(connection);
  }
  log('Service Bus: using Azure identity (OIDC / az login).');
  return new ServiceBusClient(serviceBusNamespace(), createAzureCredential());
}

function buildBlobServiceClient() {
  const sasUrl = process.env.STORAGE_SAS_URL?.trim();
  if (sasUrl) {
    const url = new URL(sasUrl);
    // The portal hands out a container SAS URL that includes the container path, but
    // BlobServiceClient expects the account endpoint alone - otherwise the container name
    // gets appended twice and every request 404s.
    if (url.pathname && url.pathname !== '/') {
      log(`Blob Storage: ignoring container path "${url.pathname}" in STORAGE_SAS_URL.`);
      url.pathname = '';
    }
    log('Blob Storage: using STORAGE_SAS_URL.');
    return new BlobServiceClient(url.toString());
  }
  const connection = process.env.STORAGE_CONNECTION_STRING?.trim();
  if (connection) {
    log('Blob Storage: using STORAGE_CONNECTION_STRING.');
    return BlobServiceClient.fromConnectionString(connection);
  }
  log('Blob Storage: using Azure identity (OIDC / az login).');
  return new BlobServiceClient(storageAccountUrl(), createAzureCredential());
}

Given('the Cope Azure pipeline integration is configured', function () {
  log(`Configuring Service Bus (queue "${queueName()}") and Blob Storage (container "${outputContainerName()}") clients...`);
  this.serviceBusClient = buildServiceBusClient();
  this.serviceBusSender = this.serviceBusClient.createSender(queueName());
  this.blobServiceClient = buildBlobServiceClient();
  log('Cope pipeline integration configured.');
});

When('I publish a property request to the cope pipeline queue with correlation id {string}, source system {string}, address line1 {string}, city {string}, state {string} and zip code {string}',
  async function (correlationId, sourceSystem, line1, city, state, zipCode) {
    this.copeCorrelationId = createUniqueCorrelationId(correlationId);
    this.copePublishedAt = new Date();

    this.copeMessage = {
      requestMetadata: {
        correlationId: this.copeCorrelationId,
        sourceSystem,
        requestTimestamp: new Date().toISOString()
      },
      propertyAddress: {
        line1,
        line2: '',
        city,
        state,
        zipCode
      }
    };

    log(`Publishing property request for correlation id "${this.copeCorrelationId}" to queue "${queueName()}"...`);
    await this.serviceBusSender.sendMessages({
      body: this.copeMessage,
      contentType: 'application/json',
      messageId: this.copeCorrelationId
    });
    log(`Published message for correlation id "${this.copeCorrelationId}" at ${this.copePublishedAt.toISOString()}.`);
  });

Then('an output blob for the request is written to storage account {string} within {int} seconds', { timeout: 300 * 1000 }, async function (_storageAccountName, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  this.copeOutputContainerName = outputContainerName();
  const containerClient = this.blobServiceClient.getContainerClient(this.copeOutputContainerName);
  const prefix = `${this.copeCorrelationId}_`;
  const earliestExpectedBlobTime = this.copePublishedAt.getTime() - 60 * 1000;

  log(`Polling container "${this.copeOutputContainerName}" for a blob prefixed "${prefix}" (timeout ${timeoutSeconds}s)...`);
  let outputBlobName = null;
  let attempt = 0;
  while (Date.now() < deadline && !outputBlobName) {
    attempt += 1;
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      if (new Date(blob.properties.lastModified).getTime() >= earliestExpectedBlobTime) {
        outputBlobName = blob.name;
        break;
      }
    }
    const elapsedSeconds = Math.round((timeoutSeconds * 1000 - (deadline - Date.now())) / 1000);
    log(`Poll attempt ${attempt}: ${outputBlobName ? `found blob "${outputBlobName}"` : 'no matching blob yet'} (elapsed ${elapsedSeconds}s).`);
    if (!outputBlobName) await sleep(pollIntervalMs());
  }

  assert.ok(outputBlobName, `No output blob for correlation id "${this.copeCorrelationId}" appeared within ${timeoutSeconds}s`);
  this.copeOutputBlobName = outputBlobName;
});

Then('the output blob content is valid JSON', async function () {
  log(`Downloading blob "${this.copeOutputBlobName}" for validation...`);
  const containerClient = this.blobServiceClient.getContainerClient(this.copeOutputContainerName);
  const blobClient = containerClient.getBlobClient(this.copeOutputBlobName);
  const downloaded = await blobClient.downloadToBuffer();
  const text = downloaded.toString('utf8');

  // The agent sometimes prepends prose before a fenced ```json block, so extract
  // the fenced block if present, otherwise fall back to the outermost {...}.
  const fencedMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  const raw = fencedMatch ? fencedMatch[1] : text.slice(jsonStart, jsonEnd + 1);

  this.copeOutputContent = JSON.parse(raw.trim());
  log(`Output blob content validated for correlation id "${this.copeCorrelationId}".`);
});

module.exports = {};
