import * as vscode from "vscode";

let statusBar: vscode.StatusBarItem | null = null;

export function getStatusBar(): vscode.StatusBarItem {
  if (!statusBar) {
    statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    statusBar.command = "incidentLens.reviewFile";
    statusBar.show();
  }
  return statusBar;
}

export function setIdle(): void {
  const bar = getStatusBar();
  bar.text = "$(shield) Incident Lens";
  bar.tooltip = "Click to review current file";
  bar.backgroundColor = undefined;
}

export function setReviewing(): void {
  const bar = getStatusBar();
  bar.text = "$(sync~spin) Reviewing...";
  bar.tooltip = "Incident Lens is reviewing your file";
  bar.backgroundColor = undefined;
}

export function setIssuesFound(count: number): void {
  const bar = getStatusBar();
  bar.text = `$(warning) ${count} incident risk${count === 1 ? "" : "s"}`;
  bar.tooltip = `Incident Lens found ${count} potential incident pattern${count === 1 ? "" : "s"}. Click to re-review.`;
  bar.backgroundColor = new vscode.ThemeColor(
    "statusBarItem.warningBackground"
  );
}

export function setClean(): void {
  const bar = getStatusBar();
  bar.text = "$(pass) Incident Lens";
  bar.tooltip = "No incident patterns detected. Click to re-review.";
  bar.backgroundColor = undefined;
}

export function setError(message: string): void {
  const bar = getStatusBar();
  bar.text = "$(error) Incident Lens";
  bar.tooltip = `Error: ${message}`;
  bar.backgroundColor = new vscode.ThemeColor(
    "statusBarItem.errorBackground"
  );
}

export function setDisabled(): void {
  const bar = getStatusBar();
  bar.text = "$(shield) Incident Lens (disabled)";
  bar.tooltip = "Incident Lens is disabled. Enable in settings.";
  bar.backgroundColor = undefined;
}

export function dispose(): void {
  statusBar?.dispose();
  statusBar = null;
}
