const { ServiceBusClient } = require('@azure/service-bus');
const { TableClient, odata } = require('@azure/data-tables');
const { createAzureCredential } = require('./azure-credential');

const defaultNamespace = 'sb-sn-data-dev.servicebus.windows.net';
const defaultTableAccountUrl = 'https://stsndatadevvaike.table.core.windows.net';

function createNotificationLogClients(env = process.env) {
  const serviceBusConnection = env.NOTIFICATION_SERVICE_BUS_CONNECTION?.trim() || env.SERVICE_BUS_CONNECTION?.trim();
  const namespace = env.NOTIFICATION_SERVICE_BUS_NAMESPACE_FQDN?.trim() || defaultNamespace;
  const queueName = env.NOTIFICATION_QUEUE_NAME?.trim() || 'cope-requests';
  const serviceBusClient = serviceBusConnection
    ? new ServiceBusClient(serviceBusConnection)
    : new ServiceBusClient(namespace, createAzureCredential(env));

  const tableName = env.NOTIFICATION_TABLE_NAME?.trim() || 'NotificationLog';
  const tableConnection = env.NOTIFICATION_TABLE_CONNECTION_STRING?.trim();
  const tableAccountUrl = env.NOTIFICATION_TABLE_ACCOUNT_URL?.trim() || defaultTableAccountUrl;
  const tableClient = tableConnection
    ? TableClient.fromConnectionString(tableConnection, tableName)
    : new TableClient(tableAccountUrl, tableName, createAzureCredential(env));

  return {
    serviceBusClient,
    serviceBusSender: serviceBusClient.createSender(queueName),
    queueName,
    tableClient
  };
}

// The pipeline writes one record per callback attempt, partitioned by the Service Bus message id.
async function recordsForMessage(tableClient, messageId) {
  const records = [];
  const queryOptions = { filter: odata`PartitionKey eq ${messageId}` };
  for await (const entity of tableClient.listEntities({ queryOptions })) records.push(entity);
  return records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

module.exports = { createNotificationLogClients, recordsForMessage };