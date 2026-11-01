import { ReviewIssue, ReviewResult } from "./types";

const RULES = new Set([
  "HTTP_IN_QUEUE_CONSUMER", "MISSING_IDEMPOTENCY_KEY", "NO_DLQ_ON_CONSUMER",
  "UNBOUNDED_RETRY", "UNHANDLED_EXTERNAL_CALL", "N_PLUS_ONE_QUERY",
  "NO_CIRCUIT_BREAKER", "SHARED_MUTABLE_STATE", "MISSING_TRANSACTION",
  "SYNC_IO_IN_ASYNC",
]);
const SEVERITIES = new Set(["error", "warning", "info"]);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Model JSON is untrusted: reject the whole review if a diagnostic is invalid. */
export function parseReviewResponse(text: string, lineCount: number): ReviewResult {
  const skipped = (reason: string): ReviewResult => ({ issues: [], skipped: true, reason });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return skipped("parse_error");
  }
  if (!Number.isInteger(lineCount) || lineCount < 1 || !record(parsed) || !Array.isArray(parsed.issues)) {
    return skipped("invalid_response");
  }
  const issues: ReviewIssue[] = [];
  for (const issue of parsed.issues) {
    if (!record(issue)) return skipped("invalid_response");
    const { line, endLine, severity, rule, message, suggestion } = issue;
    if (typeof line !== "number" || !Number.isInteger(line) || line < 1 || line > lineCount ||
        (endLine !== undefined && (typeof endLine !== "number" || !Number.isInteger(endLine) || endLine < line || endLine > lineCount)) ||
        typeof severity !== "string" || !SEVERITIES.has(severity) ||
        typeof rule !== "string" || !RULES.has(rule) || !nonempty(message) || !nonempty(suggestion)) {
      return skipped("invalid_response");
    }
    // Do not propagate model-controlled metadata such as skipped/reason or extra keys.
    issues.push({ line, ...(endLine !== undefined ? { endLine: endLine as number } : {}),
      severity: severity as ReviewIssue["severity"], rule, message, suggestion });
  }
  return { issues };
}
