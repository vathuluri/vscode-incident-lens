const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Exercise the real compiled extension handlers with a fake VS Code host and
// deferred model responses. No editor instance or external API is required.
function setup() {
  const commands = new Map(), requests = [], applied = [], statuses = [], errors = [];
  const config = { enabled: true };
  const document = { version: 1, isClosed: false, lineCount: 2, languageId: 'typescript',
    uri: 'file:///example.ts', getText: () => 'const one = 1;\nconst two = 2;' };
  const vscode = {
    workspace: {
      getConfiguration: () => ({ get: (key, fallback) => config[key] ?? fallback }),
      onDidSaveTextDocument: () => ({ dispose() {} }),
    },
    commands: { registerCommand: (name, handler) => { commands.set(name, handler); return { dispose() {} }; } },
    window: {
      activeTextEditor: { document }, onDidChangeActiveTextEditor: () => ({ dispose() {} }),
      showErrorMessage: message => errors.push(message),
    },
  };
  const reviewer = { reviewCode: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) };
  const diagnostics = { applyDiagnostics: (doc, issues) => applied.push({ doc, issues }),
    clearDiagnostics: () => applied.splice(0), dispose() {} };
  const statusbar = Object.fromEntries(['setIdle', 'setReviewing', 'setIssuesFound', 'setClean',
    'setError', 'setDisabled', 'dispose'].map(name => [name, (...args) => statuses.push({ name, args })]));
  const path = require.resolve('../out/extension');
  delete require.cache[path];
  const load = Module._load;
  Module._load = function(id, parent, ...args) {
    if (parent?.filename === path) {
      const mock = { vscode, './reviewer': reviewer, './diagnostics': diagnostics, './statusbar': statusbar }[id];
      if (mock) return mock;
    }
    return load.call(this, id, parent, ...args);
  };
  let extension;
  try { extension = require(path); } finally { Module._load = load; }
  extension.activate({ subscriptions: [] });
  return { document, vscode, config, requests, applied, statuses, errors, extension,
    review: () => commands.get('incidentLens.reviewFile')(),
    clear: () => commands.get('incidentLens.clearDiagnostics')() };
}
const finding = label => ({ line: 1, rule: 'UNBOUNDED_RETRY', severity: 'warning', message: label, suggestion: 'Bound attempts.' });

test('an unchanged current document receives its findings', async () => {
  const s = setup(); s.review(); const issue = finding('current');
  s.requests[0].resolve({ issues: [issue] }); await tick();
  assert.deepEqual(s.applied, [{ doc: s.document, issues: [issue] }]);
  assert.equal(s.statuses.at(-1).name, 'setIssuesFound');
});
test('editing or closing the document discards the response', async () => {
  for (const change of [doc => doc.version++, doc => { doc.isClosed = true; }]) {
    const s = setup(); s.review(); change(s.document);
    s.requests[0].resolve({ issues: [finding('old')] }); await tick();
    assert.equal(s.applied.length, 0);
    assert.equal(s.statuses.at(-1).name, 'setIdle');
  }
});
test('a slower earlier review cannot overwrite a newer review of the same version', async () => {
  const s = setup(); s.review(); s.review();
  s.requests[1].resolve({ issues: [finding('new')] }); await tick();
  s.requests[0].resolve({ issues: [] }); await tick();
  assert.equal(s.applied.length, 1);
  assert.equal(s.applied[0].issues[0].message, 'new');
  assert.equal(s.statuses.at(-1).name, 'setIssuesFound');
});
test('stale request errors do not surface misleading authentication failures', async () => {
  const s = setup(); s.review(); s.document.version++;
  s.requests[0].reject(new Error('401 authentication')); await tick();
  assert.equal(s.errors.length, 0);
  assert.equal(s.statuses.some(status => status.name === 'setError'), false);
});
test('disabling the extension while a review runs prevents findings from appearing', async () => {
  const s = setup(); s.review(); s.config.enabled = false;
  s.requests[0].resolve({ issues: [finding('disabled')] }); await tick();
  assert.equal(s.applied.length, 0);
  assert.equal(s.statuses.at(-1).name, 'setDisabled');
});
test('Clear Diagnostics invalidates pending results even when code has not changed', async () => {
  const s = setup(); s.review(); s.clear();
  s.requests[0].resolve({ issues: [finding('cleared')] }); await tick();
  assert.equal(s.applied.length, 0);
  assert.equal(s.statuses.at(-1).name, 'setIdle');
});
test('independent documents can both complete, while deactivation invalidates results', async () => {
  const s = setup(); s.review();
  const second = { ...s.document, uri: 'file:///second.ts' };
  s.vscode.window.activeTextEditor = { document: second }; s.review();
  s.requests[0].resolve({ issues: [] }); s.requests[1].resolve({ issues: [] }); await tick();
  assert.deepEqual(s.applied.map(entry => entry.doc), [s.document, second]);
  s.review(); s.extension.deactivate();
  s.requests[2].resolve({ issues: [finding('deactivated')] }); await tick();
  assert.equal(s.applied.length, 2);
});
test('current request errors still surface normally', async () => {
  const s = setup(); s.review(); s.requests[0].reject(new Error('401 authentication')); await tick();
  assert.equal(s.errors.length, 1);
  assert.equal(s.statuses.at(-1).name, 'setError');
});
