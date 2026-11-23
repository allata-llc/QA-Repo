/** Page object encapsulating Azure Portal navigation used by the azure-portal-navigation steps. */
class AzurePortalPage {
  constructor(page) {
    this.page = page;
    this.subscriptionId = null;
    this.resourceGroupName = null;
  }

  async gotoPortal() {
    await this.page.goto('https://portal.azure.com/#home');
  }

  // Blade grid content renders inside an iframe; Azure Portal prewarms extra hidden iframes
  // for the next blade, so only the one with this class is the currently active blade.
  blade() {
    return this.page.frameLocator('iframe.fxs-reactview-frame-active');
  }

  async selectSubscription(subscriptionId) {
    this.subscriptionId = subscriptionId;
    await this.page.getByRole('link', { name: 'Subscriptions', exact: true }).first().click();
    const row = this.page.getByRole('row', { name: new RegExp(subscriptionId) });
    await row.getByRole('link').click();
  }

  async openResourceGroup(resourceGroupName) {
    this.resourceGroupName = resourceGroupName;
    await this.page.getByRole('link', { name: 'Resource groups', exact: true }).click();
    const blade = this.blade();
    await blade.getByPlaceholder('Filter for any field...').fill(resourceGroupName);
    await blade.getByRole('link', { name: resourceGroupName, exact: true }).click();
  }

  async openResource(resourceName) {
    const blade = this.blade();
    await blade.getByPlaceholder('Filter for any field...').fill(resourceName);
    await blade.getByRole('link', { name: resourceName, exact: true }).click();
  }

  async openEntitiesSection(entityLabel, sectionLabel) {
    await this.page.getByRole('button', { name: sectionLabel }).click();
    await this.page.getByText(entityLabel, { exact: true }).click();
  }

  async selectQueue(queueName) {
    await this.blade().getByRole('link', { name: queueName, exact: true }).click();
  }

  async assertOnQueueOverview(queueName) {
    await this.page.waitForURL(new RegExp(`queues/${queueName}/overview`, 'i'));
  }

  // Queue overview's Message Counts don't auto-update, so refresh and pause briefly
  // to give the run a visible moment showing the just-published message on the queue.
  async refreshQueueOverview() {
    await this.waitForOverviewToolbar();
    await this.page.getByRole('toolbar').getByRole('button', { name: 'Refresh', exact: true }).click();
    await this.page.waitForTimeout(3000);
  }

  // Navigating back to a blade instance the browser already visited can transiently
  // render "Content closed" before the toolbar mounts, so retry once. Now that the
  // HTTP/2 root cause of the old hangs is fixed, one retry is enough - avoid extra
  // reload cycles when the toolbar just needs a bit more time to mount.
  async waitForOverviewToolbar() {
    const refreshButton = this.page.getByRole('toolbar').getByRole('button', { name: 'Refresh', exact: true });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await refreshButton.waitFor({ state: 'visible', timeout: 30 * 1000 });
        return;
      } catch (err) {
        if (attempt === 2) throw err;
        await this.page.reload();
      }
    }
  }

  // Publishing via the Explorer's "Send messages" dialog doesn't reach Azure Foundry the
  // same way the SDK publish does, so we still publish via the SDK and only use Peek here
  // (read-only, doesn't affect delivery) to make the message visible in the portal.
  // Opened *before* publishing so the peek click right after has no navigation delay -
  // Foundry can pick the message off the queue within a second or two of it landing.
  async openServiceBusExplorer() {
    const overviewUrl = this.page.url();
    this.queueOverviewUrl = overviewUrl;
    await this.page.goto(overviewUrl.replace(/\/overview(?:[?#].*)?$/i, '/explorer'));
  }

  async peekPublishedMessage() {
    const blade = this.blade();
    await blade.getByRole('menuitem', { name: 'Peek from start' }).click();
    // Give the run a visible moment showing the peeked message before moving on.
    await this.page.waitForTimeout(3000);

    await this.page.goto(this.queueOverviewUrl);
    await this.waitForOverviewToolbar();
  }

  // Displays the exact payload about to be published (via the SDK, since sending through
  // this dialog doesn't reach Azure Foundry) in the Explorer's "Send messages" form, so the
  // publish itself - not just its aftermath - is visible. Closed without clicking Send.
  async showPropertyRequestPayload({ correlationId, sourceSystem, line1, city, state, zipCode }) {
    const blade = this.blade();
    await blade.getByRole('menubar').first().getByRole('menuitem').first().click();
    await blade.getByRole('menuitem', { name: 'Send messages' }).click();

    await blade.getByRole('combobox', { name: /Content type/i }).click();
    await blade.getByRole('option', { name: 'application/json', exact: true }).click();

    const body = JSON.stringify({
      requestMetadata: { correlationId, sourceSystem, requestTimestamp: new Date().toISOString() },
      propertyAddress: { line1, line2: '', city, state, zipCode }
    }, null, 2);
    const bodyBox = blade.getByRole('textbox', { name: 'Message Body' });
    // force: the Monaco editor's render layer intercepts pointer events on plain clicks.
    await bodyBox.click({ force: true });
    await bodyBox.fill(body);

    // Pause so the payload is visible before the real SDK publish happens.
    await this.page.waitForTimeout(4000);
    await blade.getByRole('dialog', { name: 'Send messages' }).getByRole('button', { name: 'Close', exact: true }).click();
  }
}

module.exports = { AzurePortalPage };
