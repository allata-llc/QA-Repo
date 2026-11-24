const test = require('node:test');
const assert = require('node:assert/strict');
const { publishPropertyRequest } = require('../specs/support/service-bus-sas');

test('SAS REST sends use fresh matching message and correlation IDs', async () => {
  const calls = [];
  const response = { status: () => 201 };
  const request = {
    post: async (url, options) => {
      calls.push({ url, options });
      return response;
    }
  };
  const input = {
    request,
    resourceUri: 'https://example.servicebus.windows.net/cope-requests',
    token: 'test-token',
    correlationId: 'caf-prospect-sas-rest',
    sourceSystem: 'CaffeineCRM',
    line1: '123 Example St',
    city: 'Denver',
    state: 'CO',
    zipCode: '80222'
  };

  const first = await publishPropertyRequest(input);
  const second = await publishPropertyRequest(input);
  assert.notEqual(first.correlationId, second.correlationId);
  assert.equal(first.response, response);

  for (const [index, result] of [first, second].entries()) {
    const { url, options } = calls[index];
    const body = JSON.parse(options.data);
    assert.equal(url, `${input.resourceUri}/messages?timeout=60&api-version=2021-05`);
    assert.equal(options.headers.Authorization, input.token);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.headers.BrokerProperties), {
      MessageId: result.correlationId,
      CorrelationId: result.correlationId
    });
    assert.match(result.correlationId, /^caf-prospect-sas-rest-[0-9a-f-]{36}$/);
    assert.equal(body.requestMetadata.correlationId, result.correlationId);
    assert.equal(body.requestMetadata.sourceSystem, input.sourceSystem);
    assert.ok(!Number.isNaN(Date.parse(body.requestMetadata.requestTimestamp)));
    assert.deepEqual(body.propertyAddress, {
      line1: input.line1,
      line2: '',
      city: input.city,
      state: input.state,
      zipCode: input.zipCode
    });
  }
});
