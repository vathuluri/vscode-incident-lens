export interface ReviewIssue {
  line: number;        // 1-based line number
  endLine?: number;    // 1-based, inclusive; defaults to line if omitted
  severity: "error" | "warning" | "info";
  rule: string;        // e.g. "MISSING_IDEMPOTENCY_KEY"
  message: string;     // human-readable explanation
  suggestion: string;  // one-line fix hint
}

export interface ReviewResult {
  issues: ReviewIssue[];
  skipped?: boolean;
  reason?: string;
}
