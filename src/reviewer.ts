import Anthropic from "@anthropic-ai/sdk";
import { ReviewResult } from "./types";
import { parseReviewResponse } from "./review-response";

const SYSTEM_PROMPT = `You are an expert code reviewer specializing in production reliability and incident prevention.
Your job is to identify patterns in code that are known to cause production incidents — 3am pages, data corruption, cascading failures.

You only flag issues from this exact list of 10 rules. Do NOT flag style, naming, or general best practices.

RULES:
1. HTTP_IN_QUEUE_CONSUMER — HTTP/external call inside a message queue consumer with no timeout or error boundary. Causes consumers to stall and block the queue.
2. MISSING_IDEMPOTENCY_KEY — DB write or state mutation inside a retryable code path (consumer, retry loop, scheduled job) with no idempotency check. Causes duplicate records on retry.
3. NO_DLQ_ON_CONSUMER — Queue/event consumer with no dead-letter queue or error routing. Failed messages are silently dropped or cause infinite retry loops.
4. UNBOUNDED_RETRY — Retry logic (loop, recursive call, or framework retry config) with no maximum attempts, backoff, or jitter. Causes thundering herd on downstream services.
5. UNHANDLED_EXTERNAL_CALL — Call to an external service (HTTP, DB, cache, queue) with no try/catch or error handling. One transient failure brings down the whole function.
6. N_PLUS_ONE_QUERY — Database query inside a loop iterating over a collection. Causes O(n) database round trips.
7. NO_CIRCUIT_BREAKER — Multiple calls to a third-party integration (payment provider, email service, external API) with no circuit breaker or timeout. One slow third-party takes down your service.
8. SHARED_MUTABLE_STATE — Mutable variable declared outside the handler function in a Lambda/serverless/stateless context. Causes state leakage between requests.
9. MISSING_TRANSACTION — Related database operations (multiple writes that must succeed or fail together) without a transaction boundary. Leaves data in a partial state on failure.
10. SYNC_IO_IN_ASYNC — Synchronous file system or blocking I/O call inside an async function or event handler. Blocks the event loop.

Respond ONLY with a JSON object in this exact shape — no prose, no markdown fences, no explanation:
{
  "issues": [
    {
      "line": <1-based integer>,
      "endLine": <1-based integer, optional>,
      "severity": "error" | "warning" | "info",
      "rule": "<RULE_NAME>",
      "message": "<one sentence explaining what could go wrong in production>",
      "suggestion": "<one sentence fix>"
    }
  ]
}

If no issues are found, return: {"issues": []}

Severity guide:
- "error"   → almost certain to cause an incident (data loss, deadlock, cascading failure)
- "warning" → likely to cause problems under load or failure conditions
- "info"    → relevant pattern worth being aware of`;

let client: Anthropic | null = null;

function getClient(apiKey?: string): Anthropic {
  if (!client || apiKey) {
    client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }
  return client;
}

export async function reviewCode(
  code: string,
  language: string,
  apiKey?: string
): Promise<ReviewResult> {
  const anthropic = getClient(apiKey);

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Language: ${language}\n\n\`\`\`${language}\n${code}\n\`\`\``,
      },
    ],
  });

  const first = response.content[0];
  const text = first?.type === "text" ? first.text : "";
  return parseReviewResponse(text, code.split(/\r\n|\r|\n/).length);
}
