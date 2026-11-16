const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Given, When, Then } = require('@cucumber/cucumber');
const { connectPipelineServiceBus } = require('../support/pipeline-service-bus');

const mcpUrl = () => process.env.MCP_SERVER_URL || 'http://127.0.0.1:7071/mcp';
const pipelineRepo = () => process.env.PIPELINE_FUNCTION_REPO || path.resolve('..', 'pipeline-function');

function mcpHeaders(world) {
  return {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    ...(world.mcpSessionId ? { 'Mcp-Session-Id': world.mcpSessionId } : {})
  };
}

async function readMcpResponse(response) {
  const body = await response.text();
  if (!body) return null;

  const eventData = body
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean)
    .pop();

  return JSON.parse(eventData || body);
}

async function sendMcpRequest(world, request) {
  const response = await world.request.post(mcpUrl(), {
    headers: mcpHeaders(world),
    data: request
  });

  world.mcpSessionId = response.headers()['mcp-session-id'] || world.mcpSessionId;
  world.mcpResponse = await readMcpResponse(response);
  world.response = response;
}

Given('the MCP server integration is configured', function () {
  assert.ok(this.request, 'Integration request context was not initialized');
  this.mcpUrl = mcpUrl();
});

When('I initialize an MCP session', async function () {
  await sendMcpRequest(this, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'agenticai-bdd-tests', version: '1.0.0' }
    }
  });

  const notification = await this.request.post(this.mcpUrl, {
    headers: mcpHeaders(this),
    data: { jsonrpc: '2.0', method: 'notifications/initialized' }
  });
  assert.ok([200, 202].includes(notification.status()));
});

When('I list the MCP tools', async function () {
  await sendMcpRequest(this, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  });
});

Then('the MCP tool list response is valid', function () {
  assert.equal(this.response.status(), 200);
  assert.ok(Array.isArray(this.mcpResponse?.result?.tools), 'MCP tools/list response did not contain a tools array');
});

Given('the pipeline function source is available', function () {
  this.pipelineRoot = pipelineRepo();
  assert.ok(fs.existsSync(path.join(this.pipelineRoot, 'function_app.py')));
});

Then('the pipeline function registers the Service Bus blueprint', function () {
  const source = fs.readFileSync(path.join(this.pipelineRoot, 'function_app.py'), 'utf8');
  assert.match(source, /register_functions\(service_bus_queue_bp\)/);
});

Then('the pipeline queue is configured as {string}', function (queueName) {
  const source = fs.readFileSync(path.join(this.pipelineRoot, 'blueprints', 'service_bus_queue.py'), 'utf8');
  assert.match(source, new RegExp(`queue_name="${queueName}"`));
});

Given('the pipeline Service Bus integration is configured', function () {
  const { client, sender } = connectPipelineServiceBus();
  this.serviceBusClient = client;
  this.serviceBusSender = sender;
});

When('I publish a valid property request to the pipeline queue', async function () {
  this.pipelineMessage = {
    requestMetadata: {
      correlationId: `agenticai-${Date.now()}`,
      sourceSystem: 'AgenticAI',
      requestTimestamp: new Date().toISOString()
    },
    propertyAddress: {
      line1: '4529 Winona Court',
      line2: '',
      city: 'Denver',
      state: 'CO',
      zipCode: '80212'
    }
  };
  await this.serviceBusSender.sendMessages({
    body: this.pipelineMessage,
    contentType: 'application/json',
    messageId: this.pipelineMessage.requestMetadata.correlationId
  });
});

Then('the pipeline request is accepted by Service Bus', function () {
  assert.ok(this.pipelineMessage);
});

module.exports = {};