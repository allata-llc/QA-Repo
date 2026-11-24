const assert = require('node:assert/strict');

async function getAccessToken(config, fetchToken = fetch) {
  const response = await fetchToken(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: `api://${config.apiId}/.default`
    })
  });
  const guidance = response.status === 401
    ? ' Check COPE_CLIENT_SECRET and COPE_CLIENT_ID/COPE_TENANT_ID for the selected environment.'
    : '';
  assert.ok(response.ok, `Token request failed: HTTP ${response.status}.${guidance}`);
  const body = await response.json();
  return body.access_token;
}

module.exports = { getAccessToken };
