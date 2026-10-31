# Incident Lens

A VSCode extension that reviews your code in the background and flags patterns known to cause **production incidents** — powered by Claude AI.

Not a linter. Not a style checker. Incident Lens looks specifically for the code patterns that cause 3am pages, data corruption, and cascading failures.

---

## How It Works

1. You save a file
2. Incident Lens sends the code to Claude (Haiku — fast and cheap)
3. Issues appear in the **Problems panel** (`Ctrl+Shift+M`) within a few seconds
4. The status bar shows a live count of incident risks found

---

## Quick Start

**Before your first review:** the saved file's full text is sent to Anthropic. Read [privacy, Windows setup, and how to interpret findings](docs/privacy-and-review.md). Use only code you are permitted to send, and review every suggested fix.

### 1. Install

**From the Marketplace** *(once published)*:
Search for `Incident Lens` in the VSCode Extensions panel, or run:
```
ext install vathuluri.vscode-incident-lens
```

**From source:**
```bash
git clone https://github.com/vathuluri/vscode-incident-lens
cd vscode-incident-lens
npm install
npm run compile
```
Then press `F5` in VSCode to launch the Extension Development Host.

### 2. Get an API Key

Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key.

### 3. Configure

**Option A — Environment variable (recommended):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```
Add this to your shell profile (`.bashrc`, `.zshrc`, etc.) so it's always available.

**Option B — VSCode setting:**
Open Settings (`Ctrl+,`) and search for `incidentLens.apiKey`. Paste your key there.

> Note: Option A is preferred — your key won't be stored in `settings.json`.

---

## What It Detects

Incident Lens checks for exactly 10 patterns. Nothing else.

| Rule | What it catches | Why it matters |
|------|----------------|----------------|
| `HTTP_IN_QUEUE_CONSUMER` | HTTP/external call inside a queue consumer with no timeout | Stalls the consumer; blocks the entire queue |
| `MISSING_IDEMPOTENCY_KEY` | DB write in a retryable path with no idempotency check | Duplicate records on retry |
| `NO_DLQ_ON_CONSUMER` | Queue consumer with no dead-letter queue | Failed messages silently dropped or infinite retry loop |
| `UNBOUNDED_RETRY` | Retry logic with no max attempts, backoff, or jitter | Thundering herd on downstream services |
| `UNHANDLED_EXTERNAL_CALL` | Call to DB/HTTP/cache with no try/catch | One transient failure brings down the whole function |
| `N_PLUS_ONE_QUERY` | Database query inside a loop | O(n) round trips to your database |
| `NO_CIRCUIT_BREAKER` | Repeated calls to a third-party API with no circuit breaker | One slow third-party takes down your service |
| `SHARED_MUTABLE_STATE` | Mutable variable outside the handler in a Lambda/serverless function | State leaks between requests |
| `MISSING_TRANSACTION` | Related DB writes without a transaction boundary | Partial writes on failure leave data inconsistent |
| `SYNC_IO_IN_ASYNC` | Synchronous file I/O inside an async function | Blocks the event loop |

---

## Supported Languages

TypeScript, JavaScript, Python, Go, Java, C#

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `incidentLens.apiKey` | `""` | Anthropic API key. Leave empty to use `ANTHROPIC_API_KEY` env var. |
| `incidentLens.enabled` | `true` | Enable auto-review on save. |
| `incidentLens.debounceMs` | `2000` | Wait this many ms after save before reviewing. |
| `incidentLens.maxFileLines` | `500` | Skip files larger than this line count. |

---

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and run:

| Command | What it does |
|---------|-------------|
| `Incident Lens: Review Current File` | Trigger a review immediately (also the status bar click action) |
| `Incident Lens: Clear Diagnostics` | Remove all Incident Lens markers from the Problems panel |

---

## Status Bar

The status bar item in the bottom-right corner shows the current state:

| Icon | Meaning |
|------|---------|
| `🛡 Incident Lens` | Idle — click to review the active file |
| `⟳ Reviewing...` | Review in progress |
| `✓ Incident Lens` | No issues found |
| `⚠ 3 incident risks` | Issues found — open Problems panel to see them |
| `✕ Incident Lens` | Error — hover for details |

---

## Cost

Incident Lens uses `claude-haiku-4-5` — the fastest and cheapest Claude model.

A typical 200-line file costs roughly **$0.00015** per review (less than a cent for 60 saves). For most developers, monthly cost is under **$0.50**.

---

## Example

Given this TypeScript:

```typescript
async function processOrder(orderId: string) {
  const items = await db.query("SELECT * FROM order_items WHERE order_id = $1", [orderId]);
  for (const item of items) {
    const price = await db.query("SELECT price FROM products WHERE id = $1", [item.productId]);
    await db.query("UPDATE inventory SET stock = stock - 1 WHERE product_id = $1", [item.productId]);
  }
}
```

Incident Lens flags:
- **Line 3** `N_PLUS_ONE_QUERY` *(warning)* — "DB query inside a loop over `items` causes O(n) round trips. Fetch all product prices in a single query with `WHERE id = ANY($1)`."
- **Line 4** `MISSING_TRANSACTION` *(error)* — "Multiple inventory writes without a transaction; a failure mid-loop leaves stock partially decremented."

---

## Contributing

Issues and PRs welcome at [github.com/vathuluri/vscode-incident-lens](https://github.com/vathuluri/vscode-incident-lens). The 10 detection rules live in `src/reviewer.ts` in the system prompt — if you want to propose a new rule, open an issue with a code example that triggered a real incident.

---

## License

MIT
