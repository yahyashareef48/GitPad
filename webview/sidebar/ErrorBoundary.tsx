import { Component, type ErrorInfo, type ReactNode } from 'react';

/*
 * Turns a webview crash into a readable message.
 *
 * Without this, any render error unmounts the tree and leaves an empty panel
 * that is indistinguishable from "you have no notes" -- the single most
 * confusing failure mode a sidebar can have, because nothing tells you
 * anything is wrong.
 */

interface ErrorBoundaryState {
  readonly message?: string;
}

export class ErrorBoundary extends Component<{ readonly children: ReactNode }, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {};

  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  public componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Surfaces in "Developer: Open Webview Developer Tools" with the component
    // stack, which is what actually locates the fault.
    console.error('GitPad sidebar crashed', error, info.componentStack);
  }

  public render(): ReactNode {
    if (this.state.message === undefined) {
      return this.props.children;
    }

    return (
      <div className="error">
        <p className="error__title">The sidebar hit an error.</p>
        <p className="error__detail">{this.state.message}</p>
        <p className="hint">
          Run “Developer: Open Webview Developer Tools” from the Command Palette for the full
          stack.
        </p>
      </div>
    );
  }
}
