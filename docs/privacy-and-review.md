# What a review sends, and how to use the result

Incident Lens reviews the saved document with the Anthropic API. Before enabling it on a repository, check whether that repository's code may be sent to an external model provider.

## Data path

The current implementation sends the document's **full text**, its language identifier, and the extension's reliability-review prompt to Anthropic. It does not redact secrets or proprietary code first. It does not upload the entire repository, traverse neighboring files, or attach your Git history. This describes the extension's request construction; provider-side retention and account controls are governed by your Anthropic agreement.

Supported saved files are automatically reviewed when `incidentLens.enabled` is true. The default debounce is 2 seconds, and documents longer than the configured `incidentLens.maxFileLines` (500 by default) are skipped. A line-count limit is not a token or spending limit: long lines can still contain substantial text. The manual review command also checks the enabled flag.

To stop reviews, set this in VS Code settings:

```json
{
  "incidentLens.enabled": false
}
```

Disabling prevents later reviews from starting; it does not cancel a request that has already been sent. Use **Incident Lens: Clear Diagnostics** to remove existing results from the editor.

## API key setup on Windows

Start a fresh VS Code process from a PowerShell session with the environment variable set. Avoid pasting keys into source files, screenshots, or committed settings. Replace the placeholder locally:

```powershell
$env:ANTHROPIC_API_KEY = '<your-key>'
code .
```

An already-running VS Code process may retain its earlier environment. Close all VS Code processes before testing this approach. For persistent configuration, use your operating system's environment-variable settings and restart VS Code.

The `incidentLens.apiKey` setting is also supported, but it stores the key in settings and takes precedence over the environment variable. Clear it if you intend to use the environment variable. Do not place credentials in a repository's `.vscode/settings.json`.

## Findings are leads, not proof

The model sees one file, so it can miss protections configured elsewhere: a transaction wrapper, infrastructure-managed DLQ, or shared retry policy. It can also miss a real defect. Confirm a finding against the surrounding architecture, reproduce the failure when practical, and add a regression test before changing production behavior.

No findings is not a reliability certification. A review that fails or returns an unparseable response is not evidence that the code is safe. This tool supplements code review, testing, observability, and incident analysis.

An unparseable or invalid response shows an error status with a **Review incomplete** tooltip. Existing findings remain visible until a successful review replaces them or you clear them. Click the status bar item to retry; automatic reviews do not display a popup for every malformed response.

## Contributing a useful example

Use a small synthetic reproduction with no employer or customer data. Include the rule, the failure scenario, the risky code, the proposed correction, and the test or reasoning that demonstrates the difference. Keep external API calls mocked so contributors can run checks without a paid model account.
