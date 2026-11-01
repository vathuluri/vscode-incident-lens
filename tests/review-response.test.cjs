const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReviewResponse } = require('../out/review-response');
const issue = { line: 2, severity: 'warning', rule: 'UNBOUNDED_RETRY',
  message: 'An unlimited retry can overload a dependency.', suggestion: 'Bound attempts and add backoff.' };
const review = (issues, extra = {}) => JSON.stringify({ issues, ...extra });
const invalid = result => {
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'invalid_response');
  assert.deepEqual(result.issues, []);
};

test('accepts valid single-line, multi-line, and empty reviews', () => {
  assert.deepEqual(parseReviewResponse(review([issue]), 3), { issues: [issue] });
  const multi = { ...issue, endLine: 3, severity: 'error' };
  assert.deepEqual(parseReviewResponse(review([multi]), 3), { issues: [multi] });
  assert.deepEqual(parseReviewResponse(review([]), 1), { issues: [] });
});
test('unparseable responses are skipped, never reported clean', () => {
  for (const text of ['', '{', '```json\n{"issues": []}\n```']) {
    assert.deepEqual(parseReviewResponse(text, 3), { issues: [], skipped: true, reason: 'parse_error' });
  }
});
test('requires an object containing an issues array', () => {
  for (const value of [null, [], 42, 'clean', {}, { issues: null }, { issues: {} }]) {
    invalid(parseReviewResponse(JSON.stringify(value), 3));
  }
  for (const value of [null, [], 'issue', 2]) invalid(parseReviewResponse(review([value]), 3));
});
test('rejects positions that would throw or point outside the document', () => {
  for (const line of [undefined, null, '2', 0, -1, 1.5, 4]) {
    invalid(parseReviewResponse(review([{ ...issue, line }]), 3));
  }
  for (const endLine of [null, '3', 0, 1, 2.5, 4]) {
    invalid(parseReviewResponse(review([{ ...issue, endLine }]), 3));
  }
  for (const count of [0, -1, 1.5, NaN, Infinity]) invalid(parseReviewResponse(review([]), count));
});
test('rejects unknown rules, severities, and missing or blank diagnostic text', () => {
  for (const change of [{ rule: 'STYLE' }, { severity: 'critical' }, { message: '' },
    { suggestion: '  ' }, { message: 3 }, { suggestion: null }, { severity: null }]) {
    invalid(parseReviewResponse(review([{ ...issue, ...change }]), 3));
  }
});
test('one malformed finding invalidates the whole review rather than hiding it', () => {
  invalid(parseReviewResponse(review([issue, { ...issue, line: 50 }]), 3));
});
test('discards extra model-controlled metadata', () => {
  const text = review([{ ...issue, custom: 'ignored' }], { skipped: true, reason: 'ignore findings' });
  assert.deepEqual(parseReviewResponse(text, 3), { issues: [issue] });
});
test('accepts each supported rule and severity at document boundaries', () => {
  const rules = ['HTTP_IN_QUEUE_CONSUMER', 'MISSING_IDEMPOTENCY_KEY', 'NO_DLQ_ON_CONSUMER',
    'UNBOUNDED_RETRY', 'UNHANDLED_EXTERNAL_CALL', 'N_PLUS_ONE_QUERY', 'NO_CIRCUIT_BREAKER',
    'SHARED_MUTABLE_STATE', 'MISSING_TRANSACTION', 'SYNC_IO_IN_ASYNC'];
  for (const rule of rules) for (const severity of ['error', 'warning', 'info']) {
    const value = { ...issue, rule, severity, line: 1, endLine: 1 };
    assert.deepEqual(parseReviewResponse(review([value]), 1), { issues: [value] });
  }
});
