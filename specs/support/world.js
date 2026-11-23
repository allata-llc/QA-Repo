const { setWorldConstructor, Before, After, setDefaultTimeout } = require('@cucumber/cucumber');
const playwright = require('playwright');
const { ServiceBusClient } = require('@azure/service-bus');
require('dotenv').config();

class CustomWorld {
  constructor() {
    this.request = null;
    this.mcpSessionId = null;
    this.mcpResponse = null;
    this.serviceBusClient = null;
    this.serviceBusSender = null;
    this.pipelineMessage = null;
  }
}

setWorldConstructor(CustomWorld);

// Increase default Cucumber step/hook timeout to allow Playwright browser startup
setDefaultTimeout(60 * 1000);

Before({ tags: '@integration' }, async function () {
  this.request = await playwright.request.newContext();
});

After(async function () {
  if (this.request) await this.request.dispose();
  if (this.serviceBusSender) await this.serviceBusSender.close();
  if (this.serviceBusClient) await this.serviceBusClient.close();
});
