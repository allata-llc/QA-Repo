const test = require('node:test');
const assert = require('node:assert/strict');

const { createUniqueCorrelationId } = require('../specs/support/cope-pipeline');

test('createUniqueCorrelationId preserves its prefix and returns a unique ID', () => {
  const first = createUniqueCorrelationId('caf-prospect-ci-headless');
  const second = createUniqueCorrelationId('caf-prospect-ci-headless');

  assert.match(first, /^caf-prospect-ci-headless-/);
  assert.match(second, /^caf-prospect-ci-headless-/);
  assert.notEqual(first, second);
});
