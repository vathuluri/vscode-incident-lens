import * as vscode from "vscode";
import { reviewCode } from "./reviewer";
import { applyDiagnostics, clearDiagnostics, dispose as disposeDiagnostics } from "./diagnostics";
import { setIdle, setReviewing, setIssuesFound, setClean, setError, setDisabled, dispose as disposeStatusBar } from "./statusbar";

const SUPPORTED_LANGUAGES = new Set([
  "typescript", "javascript", "typescriptreact", "javascriptreact",
  "python", "go", "java", "csharp",
]);

let debounceTimer: NodeJS.Timeout | undefined;
let reviewSequence = 0;
let latestReviews = new WeakMap<vscode.TextDocument, number>();

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("incidentLens");
  return {
    enabled: cfg.get<boolean>("enabled", true),
    apiKey: cfg.get<string>("apiKey", "") || undefined,
    debounceMs: cfg.get<number>("debounceMs", 2000),
    maxFileLines: cfg.get<number>("maxFileLines", 500),
  };
}

async function runReview(document: vscode.TextDocument): Promise<void> {
  if (document.isClosed) return;
  const version = document.version;
  const request = ++reviewSequence;
  latestReviews.set(document, request);
  const isCurrent = () => !document.isClosed && document.version === version &&
    latestReviews.get(document) === request && getConfig().enabled;
  const discardIfStale = () => {
    if (isCurrent()) return false;
    // Clear the spinner only if this request still owns the active document.
    if (latestReviews.get(document) === request && vscode.window.activeTextEditor?.document === document) {
      getConfig().enabled ? setIdle() : setDisabled();
    }
    return true;
  };
  const config = getConfig();

  if (!config.enabled) {
    setDisabled();
    return;
  }

  if (!SUPPORTED_LANGUAGES.has(document.languageId)) {
    return;
  }

  const lineCount = document.lineCount;
  const maxLines = config.maxFileLines;
  if (lineCount > maxLines) {
    setIdle();
    return;
  }

  setReviewing();

  try {
    const code = document.getText();
    const result = await reviewCode(code, document.languageId, config.apiKey);

    // Edits, newer reviews, and Clear Diagnostics invalidate the original snapshot.
    // A late response must not place findings on different code or undo a clear.
    if (discardIfStale()) return;

    if (result.skipped) {
      setIdle();
      return;
    }

    applyDiagnostics(document, result.issues);

    if (result.issues.length > 0) {
      setIssuesFound(result.issues.length);
    } else {
      setClean();
    }
  } catch (err) {
    if (discardIfStale()) return;
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("401") || message.includes("authentication")) {
      setError("Invalid API key. Check incidentLens.apiKey setting.");
      vscode.window.showErrorMessage(
        "Incident Lens: Invalid API key. Set ANTHROPIC_API_KEY or configure incidentLens.apiKey in settings."
      );
    } else {
      setError(message);
    }
  }
}

function scheduleReview(document: vscode.TextDocument): void {
  const config = getConfig();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runReview(document), config.debounceMs);
}

export function activate(context: vscode.ExtensionContext): void {
  setIdle();

  // Auto-review on save
  const onSave = vscode.workspace.onDidSaveTextDocument((document) => {
    scheduleReview(document);
  });

  // Manual review command
  const reviewCommand = vscode.commands.registerCommand(
    "incidentLens.reviewFile",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        runReview(editor.document);
      }
    }
  );

  // Clear diagnostics command
  const clearCommand = vscode.commands.registerCommand(
    "incidentLens.clearDiagnostics",
    () => {
      clearTimeout(debounceTimer);
      latestReviews = new WeakMap();
      clearDiagnostics();
      setIdle();
    }
  );

  // Re-review when active editor changes
  const onEditorChange = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      setIdle();
    }
  });

  context.subscriptions.push(onSave, reviewCommand, clearCommand, onEditorChange);
}

export function deactivate(): void {
  clearTimeout(debounceTimer);
  latestReviews = new WeakMap();
  disposeDiagnostics();
  disposeStatusBar();
}
