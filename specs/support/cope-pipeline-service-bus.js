const assert = require('node:assert/strict');
const { ServiceBusClient } = require('@azure/service-bus');
const { createAzureCredential } = require('./azure-credential');
const { buildQueueSasConnectionString } = require('./service-bus-sas');

function connectCopePipelineServiceBus(
  env = process.env,
  {
    ServiceBusClientImpl = ServiceBusClient,
    createCredential = createAzureCredential
  } = {}
) {
  const queueName = env.COPE_QUEUE_NAME?.trim() || 'cope_request';
  const connection = env.SERVICE_BUS_CONNECTION?.trim();
  const entityPath = connection?.match(/(?:^|;)\s*EntityPath\s*=\s*([^;]+)/i)?.[1]?.trim();
  let client;
  let authMode;

  if (connection && (!entityPath || entityPath.toLowerCase() === queueName.toLowerCase())) {
    client = new ServiceBusClientImpl(connection);
    authMode = 'SERVICE_BUS_CONNECTION';
  } else if (connection) {
    const keySuffix = queueName.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
    const hasQueueKey = Boolean(
      env[`SERVICE_BUS_SAS_KEY_${keySuffix}`]?.trim() || env.SERVICE_BUS_SAS_KEY?.trim()
    );
    if (!hasQueueKey) {
      throw new Error(
        `SERVICE_BUS_CONNECTION targets "${entityPath}", not "${queueName}". Configure a queue-specific SAS key or a matching connection string.`
      );
    }

    client = new ServiceBusClientImpl(
      buildQueueSasConnectionString({ env, queueName })
    );
    authMode = 'queue-specific SAS key';
  } else {
    const fullyQualifiedNamespace = env.SERVICE_BUS_NAMESPACE_FQDN?.trim();
    assert.ok(
      fullyQualifiedNamespace,
      'Set SERVICE_BUS_CONNECTION, or set SERVICE_BUS_NAMESPACE_FQDN with Azure SDK credentials, to run Cope pipeline scenarios'
    );
    client = new ServiceBusClientImpl(
      fullyQualifiedNamespace,
      createCredential(env)
    );
    authMode = 'Azure identity (OIDC / az login)';
  }

  return {
    client,
    sender: client.createSender(queueName),
    queueName,
    authMode
  };
}

module.exports = { connectCopePipelineServiceBus };
