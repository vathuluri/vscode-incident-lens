const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Exercise the real compiled extension handlers with a fake VS Code host and
// deferred model responses. No editor instance or external API is required.
function setup() {
  const commands = new Map(), requests = [], applied = [], statuses = [], errors = [];
  const timers = new Map(), scopedConfigs = new Map(), delays = [];
  let onSave, onClose;
  function withTimers(action) {
    const previousSet = global.setTimeout, previousClear = global.clearTimeout;
    global.setTimeout = (callback, delay) => { const id = {}; timers.set(id, callback); delays.push(delay); return id; };
    global.clearTimeout = id => timers.delete(id);
    try { return action(); } finally { global.setTimeout = previousSet; global.clearTimeout = previousClear; }
  }
  const config = { enabled: true };
  const document = { version: 1, isClosed: false, lineCount: 2, languageId: 'typescript',
    uri: 'file:///example.ts', getText: () => 'const one = 1;\nconst two = 2;' };
  const vscode = {
    workspace: {
      getConfiguration: (_section, resource) => ({ get: (key, fallback) => scopedConfigs.get(resource)?.[key] ?? config[key] ?? fallback }),
      onDidSaveTextDocument: handler => { onSave = handler; return { dispose() {} }; },
      onDidCloseTextDocument: handler => { onClose = handler; return { dispose() {} }; },
    },
    commands: { registerCommand: (name, handler) => { commands.set(name, handler); return { dispose() {} }; } },
    window: {
      activeTextEditor: { document }, onDidChangeActiveTextEditor: () => ({ dispose() {} }),
      showErrorMessage: message => errors.push(message),
    },
  };
  const reviewer = { reviewCode: (code, language, apiKey) => new Promise((resolve, reject) => requests.push({ resolve, reject, code, language, apiKey })) };
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
  return { document, vscode, config, scopedConfigs, delays, requests, applied, statuses, errors, extension, timers,
    review: () => withTimers(() => commands.get('incidentLens.reviewFile')()),
    clear: () => withTimers(() => commands.get('incidentLens.clearDiagnostics')()),
    save: (doc = document) => withTimers(() => onSave(doc)),
    close: (doc = document) => withTimers(() => { doc.isClosed = true; onClose(doc); }),
    deactivate: () => withTimers(() => extension.deactivate()),
    flush: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); } };
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
test('malformed AI responses show an incomplete-review error instead of returning silently to idle', async () => {
  for (const reason of ['parse_error', 'invalid_response', undefined]) {
    const s = setup(); s.review();
    s.requests[0].resolve({ issues: [], skipped: true, reason }); await tick();
    assert.equal(s.statuses.at(-1).name, 'setError');
    assert.match(s.statuses.at(-1).args[0], /review incomplete/i);
    assert.equal(s.applied.length, 0);
    assert.equal(s.statuses.some(status => status.name === 'setClean'), false);
    assert.equal(s.errors.length, 0); // Status feedback, not a popup on every save.
  }
});
test('an incomplete review retains earlier findings and a successful retry can report clean', async () => {
  const s = setup(); s.review();
  s.requests[0].resolve({ issues: [finding('earlier risk')] }); await tick();
  s.review(); s.requests[1].resolve({ issues: [], skipped: true, reason: 'invalid_response' }); await tick();
  assert.equal(s.applied.length, 1);
  assert.equal(s.applied[0].issues[0].message, 'earlier risk');
  assert.equal(s.statuses.at(-1).name, 'setError');
  s.review(); s.requests[2].resolve({ issues: [] }); await tick();
  assert.equal(s.applied.length, 2);
  assert.deepEqual(s.applied[1].issues, []);
  assert.equal(s.statuses.at(-1).name, 'setClean');
});
test('saving a second document does not cancel the first document review', () => {
  const s = setup(), second = { ...s.document, uri: 'file:///second.ts' };
  s.save(); s.save(second);
  assert.equal(s.timers.size, 2); s.flush();
  assert.equal(s.requests.length, 2);
});
test('repeated saves of one document coalesce into one request', () => {
  const s = setup(); s.save(); s.save(); s.save();
  assert.equal(s.timers.size, 1); s.flush();
  assert.equal(s.requests.length, 1); assert.equal(s.timers.size, 0);
});
test('manual review replaces only its own pending save review', () => {
  const s = setup(), second = { ...s.document, uri: 'file:///second.ts' };
  s.save(); s.save(second); s.review();
  assert.equal(s.requests.length, 1); assert.equal(s.timers.size, 1);
  s.flush(); assert.equal(s.requests.length, 2);
});
test('closing a document cancels its timer but preserves another document timer', () => {
  const s = setup(), second = { ...s.document, uri: 'file:///second.ts' };
  s.save(); s.save(second); s.close();
  assert.equal(s.timers.size, 1); s.flush(); assert.equal(s.requests.length, 1);
});
test('clearing and deactivation cancel every pending save review', () => {
  for (const action of ['clear', 'deactivate']) {
    const s = setup(); s.save(); s.save({ ...s.document, uri: 'file:///second.ts' });
    s[action](); assert.equal(s.timers.size, 0); s.flush(); assert.equal(s.requests.length, 0);
  }
});
test('disabled, closed, and unsupported documents do not schedule reviews', () => {
  const s = setup(); s.config.enabled = false; s.save(); s.config.enabled = true;
  s.save({ ...s.document, isClosed: true }); s.save({ ...s.document, languageId: 'plaintext' });
  assert.equal(s.timers.size, 0); s.flush(); assert.equal(s.requests.length, 0);
});
test('folder-level disabling prevents manual and automatic review of that folder only', () => {
  const s = setup(), second = { ...s.document, uri: 'file:///other-folder/file.ts' };
  s.scopedConfigs.set(s.document.uri, { enabled: false });
  s.review(); s.save(); assert.equal(s.requests.length, 0); assert.equal(s.timers.size, 0);
  s.vscode.window.activeTextEditor = { document: second }; s.review();
  assert.equal(s.requests.length, 1);
});
test('extension settings declare resource scope so VS Code permits folder overrides', () => {
  const properties = require('../package.json').contributes.configuration.properties;
  for (const key of ['enabled', 'apiKey', 'debounceMs', 'maxFileLines']) {
    assert.equal(properties['incidentLens.' + key].scope, 'resource');
  }
});
test('each document uses its own folder API key rather than a workspace-wide key', () => {
  const s = setup(), second = { ...s.document, uri: 'file:///other-folder/file.ts' };
  s.config.apiKey = 'test-workspace-key';
  s.scopedConfigs.set(s.document.uri, { apiKey: 'test-folder-one-key' });
  s.scopedConfigs.set(second.uri, { apiKey: 'test-folder-two-key' });
  s.review(); s.vscode.window.activeTextEditor = { document: second }; s.review();
  assert.deepEqual(s.requests.map(request => request.apiKey), ['test-folder-one-key', 'test-folder-two-key']);
});
test('folder-level file-size limits and debounce settings are respected', () => {
  const s = setup(); s.scopedConfigs.set(s.document.uri, { maxFileLines: 1, debounceMs: 75 });
  s.save(); assert.deepEqual(s.delays, [75]); s.flush();
  assert.equal(s.requests.length, 0);
  s.scopedConfigs.set(s.document.uri, { maxFileLines: 2 }); s.review();
  assert.equal(s.requests.length, 1);
});
test('folder-level disabling during a request discards results without disabling other folders', async () => {
  const s = setup(), second = { ...s.document, uri: 'file:///other-folder/file.ts' };
  s.review(); s.vscode.window.activeTextEditor = { document: second }; s.review();
  s.scopedConfigs.set(s.document.uri, { enabled: false });
  s.requests[0].resolve({ issues: [finding('disabled folder')] });
  s.requests[1].resolve({ issues: [finding('enabled folder')] }); await tick();
  assert.deepEqual(s.applied.map(entry => entry.doc), [second]);
});
