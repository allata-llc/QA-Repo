const test = require('node:test');
const assert = require('node:assert/strict');

const { connectCopePipelineServiceBus } = require('../specs/support/cope-pipeline-service-bus');

function createClientStub() {
  const calls = [];
  class ServiceBusClientStub {
    constructor(...args) {
      this.args = args;
      this.createSender = queueName => ({ queueName });
      calls.push(this);
    }
  }
  return { ServiceBusClientStub, calls };
}

test('uses the queue connection string when its EntityPath matches the target queue', () => {
  const { ServiceBusClientStub, calls } = createClientStub();
  const result = connectCopePipelineServiceBus({
    COPE_QUEUE_NAME: 'cope-requests-dev',
    SERVICE_BUS_CONNECTION: 'Endpoint=sb://example/;EntityPath=cope-requests-dev'
  }, { ServiceBusClientImpl: ServiceBusClientStub });

  assert.equal(calls[0].args[0], 'Endpoint=sb://example/;EntityPath=cope-requests-dev');
  assert.equal(result.sender.queueName, 'cope-requests-dev');
});

test('uses the target queue SAS key when the connection string pins another EntityPath', () => {
  const { ServiceBusClientStub, calls } = createClientStub();
  const result = connectCopePipelineServiceBus({
    COPE_QUEUE_NAME: 'cope-requests-dev',
    SERVICE_BUS_CONNECTION: 'Endpoint=sb://example/;EntityPath=cope-requests',
    SERVICE_BUS_NAMESPACE_FQDN: 'example.servicebus.windows.net',
    SERVICE_BUS_SAS_KEY_NAME: 'bulk-send-key',
    SERVICE_BUS_SAS_KEY_COPE_REQUESTS_DEV: 'dev-secret'
  }, { ServiceBusClientImpl: ServiceBusClientStub });

  assert.equal(
    calls[0].args[0],
    'Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=bulk-send-key;SharedAccessKey=dev-secret;EntityPath=cope-requests-dev'
  );
  assert.equal(result.sender.queueName, 'cope-requests-dev');
});

test('rejects a mismatched entity-scoped connection without a queue-specific key', () => {
  const { ServiceBusClientStub, calls } = createClientStub();

  assert.throws(
    () => connectCopePipelineServiceBus({
      COPE_QUEUE_NAME: 'cope-requests-dev',
      SERVICE_BUS_CONNECTION: 'Endpoint=sb://example/;EntityPath=cope-requests'
    }, { ServiceBusClientImpl: ServiceBusClientStub }),
    /targets "cope-requests", not "cope-requests-dev"/
  );
  assert.equal(calls.length, 0);
});

test('uses a namespace-level connection string for the configured queue', () => {
  const { ServiceBusClientStub, calls } = createClientStub();
  const result = connectCopePipelineServiceBus({
    COPE_QUEUE_NAME: 'cope-requests-dev',
    SERVICE_BUS_CONNECTION: 'Endpoint=sb://example/'
  }, { ServiceBusClientImpl: ServiceBusClientStub });

  assert.equal(calls[0].args[0], 'Endpoint=sb://example/');
  assert.equal(result.sender.queueName, 'cope-requests-dev');
});
