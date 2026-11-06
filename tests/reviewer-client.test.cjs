const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// These are deliberately fake keys; all SDK requests are intercepted locally.
function setup(t) {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  t.after(() => {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  });
  delete process.env.ANTHROPIC_API_KEY;
  const clients = [], requests = [];
  class FakeAnthropic {
    constructor({ apiKey }) {
      if (!apiKey) throw new Error('Missing test API key');
      clients.push(this);
      this.messages = { create: async () => {
        requests.push(apiKey);
        return { content: [{ type: 'text', text: '{"issues":[]}' }] };
      } };
    }
  }
  const file = require.resolve('../out/reviewer');
  delete require.cache[file];
  const load = Module._load;
  Module._load = function(id, parent, ...args) {
    if (id === '@anthropic-ai/sdk' && parent?.filename === file) return FakeAnthropic;
    return load.call(this, id, parent, ...args);
  };
  let reviewer;
  try { reviewer = require(file); } finally { Module._load = load; }
  return { clients, requests, review: key => reviewer.reviewCode('const value = 1;', 'typescript', key) };
}

test('reuses the client when the configured key stays the same', async t => {
  const s = setup(t);
  await s.review('test-setting-one'); await s.review('test-setting-one');
  assert.equal(s.clients.length, 1);
  assert.deepEqual(s.requests, ['test-setting-one', 'test-setting-one']);
});
test('replacing the configured key switches the request credential', async t => {
  const s = setup(t);
  await s.review('test-setting-one'); await s.review('test-setting-two');
  assert.equal(s.clients.length, 2);
  assert.deepEqual(s.requests, ['test-setting-one', 'test-setting-two']);
});
test('clearing the configured key switches to the environment instead of the cached key', async t => {
  const s = setup(t); process.env.ANTHROPIC_API_KEY = 'test-environment';
  await s.review('test-setting-one'); await s.review();
  assert.deepEqual(s.requests, ['test-setting-one', 'test-environment']);
});
test('environment key rotation takes effect on the next review', async t => {
  const s = setup(t); process.env.ANTHROPIC_API_KEY = 'test-environment-one';
  await s.review(); process.env.ANTHROPIC_API_KEY = 'test-environment-two'; await s.review();
  assert.equal(s.clients.length, 2);
  assert.deepEqual(s.requests, ['test-environment-one', 'test-environment-two']);
});
test('removing all keys fails without sending another request with the old credential', async t => {
  const s = setup(t); await s.review('test-setting-one');
  await assert.rejects(s.review(), /Missing test API key/);
  assert.deepEqual(s.requests, ['test-setting-one']);
});
test('an explicit setting still takes precedence over changes to the environment', async t => {
  const s = setup(t); process.env.ANTHROPIC_API_KEY = 'test-environment-one';
  await s.review('test-setting-one');
  process.env.ANTHROPIC_API_KEY = 'test-environment-two'; await s.review('test-setting-one');
  assert.equal(s.clients.length, 1);
  assert.deepEqual(s.requests, ['test-setting-one', 'test-setting-one']);
});
