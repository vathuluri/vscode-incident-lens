import * as vscode from "vscode";
import { ReviewIssue } from "./types";

const COLLECTION_NAME = "incident-lens";

let collection: vscode.DiagnosticCollection | null = null;

export function getCollection(): vscode.DiagnosticCollection {
  if (!collection) {
    collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
  }
  return collection;
}

export function applyDiagnostics(
  document: vscode.TextDocument,
  issues: ReviewIssue[]
): void {
  const col = getCollection();
  const diagnostics: vscode.Diagnostic[] = issues.map((issue) => {
    const startLine = Math.max(0, issue.line - 1);
    const endLine = issue.endLine ? Math.max(0, issue.endLine - 1) : startLine;
    const lineText = document.lineAt(startLine).text;

    const range = new vscode.Range(
      startLine,
      0,
      endLine,
      endLine === startLine ? lineText.length : document.lineAt(endLine).text.length
    );

    const diag = new vscode.Diagnostic(
      range,
      `[${issue.rule}] ${issue.message}\n💡 ${issue.suggestion}`,
      severityMap(issue.severity)
    );

    diag.source = "Incident Lens";
    diag.code = issue.rule;
    return diag;
  });

  col.set(document.uri, diagnostics);
}

export function clearDiagnostics(uri?: vscode.Uri): void {
  const col = getCollection();
  if (uri) {
    col.delete(uri);
  } else {
    col.clear();
  }
}

export function dispose(): void {
  collection?.dispose();
  collection = null;
}

function severityMap(
  s: "error" | "warning" | "info"
): vscode.DiagnosticSeverity {
  switch (s) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}
