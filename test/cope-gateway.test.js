const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { getAccessToken } = require('../specs/support/cope-gateway-auth');

test('gateway integration command selects only the gateway scenario', () => {
  const output = execFileSync('npm', ['run', '--silent', 'test:integration:cope-e2e', '--', '--dry-run', '--format', 'json'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, CUCUMBER_PUBLISH_QUIET: 'true' }
  });
  const features = JSON.parse(output);
  assert.deepEqual(features.map(feature => feature.uri), ['specs/cope-gateway-e2e.feature']);
  assert.equal(features[0].elements.length, 1);
});

test('gateway token request uses client credentials and API scope', async () => {
  const config = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret', apiId: 'api' };
  const token = await getAccessToken(config, async (url, options) => {
    assert.equal(url, 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('client_id'), config.clientId);
    assert.equal(options.body.get('client_secret'), config.clientSecret);
    assert.equal(options.body.get('grant_type'), 'client_credentials');
    assert.equal(options.body.get('scope'), 'api://api/.default');
    return { ok: true, status: 200, json: async () => ({ access_token: 'token' }) };
  });
  assert.equal(token, 'token');
});

test('gateway authentication failures give guidance without exposing response bodies', async () => {
  const response = { ok: false, status: 401, json: async () => { throw new Error('must not read response'); } };
  await assert.rejects(getAccessToken({ tenantId: 'tenant' }, async () => response), {
    message: /Token request failed: HTTP 401.*COPE_CLIENT_SECRET.*COPE_CLIENT_ID\/COPE_TENANT_ID/
  });
});
