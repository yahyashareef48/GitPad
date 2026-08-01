import * as vscode from 'vscode';

import type { Logger } from '../core/ports/Logger';

/*
 * Logger port backed by a VS Code output channel.
 *
 * One channel for the whole extension. When a user asks "what happened to my
 * note", this is the record that answers it -- particularly once sync starts
 * resolving conflicts on its own.
 */
export class OutputChannelLogger implements Logger, vscode.Disposable {
  private readonly channel: vscode.OutputChannel;

  constructor(name = 'GitPad') {
    this.channel = vscode.window.createOutputChannel(name);
  }

  public debug(message: string, ...details: readonly unknown[]): void {
    this.write('debug', message, details);
  }

  public info(message: string, ...details: readonly unknown[]): void {
    this.write('info', message, details);
  }

  public warn(message: string, ...details: readonly unknown[]): void {
    this.write('warn', message, details);
  }

  public error(message: string, error?: unknown): void {
    this.write('error', message, error === undefined ? [] : [formatError(error)]);
  }

  public dispose(): void {
    this.channel.dispose();
  }

  private write(level: string, message: string, details: readonly unknown[]): void {
    const timestamp = new Date().toISOString().slice(11, 23);
    const suffix = details.length > 0 ? ` ${details.map(format).join(' ')}` : '';

    this.channel.appendLine(`[${timestamp}] [${level}] ${message}${suffix}`);
  }
}

function format(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular structures and similar -- a log line is never worth throwing over.
    return String(value);
  }
}

/** Stacks are the useful part of an error in a log; messages alone rarely locate anything. */
function formatError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : format(error);
}
