import type { SessionController } from './session-controller.js';
import type { AccountCheckOutcome } from './session-ports.js';

// What route handlers need from the registry: end a live call by session ID.
export interface CallStopper {
  stop(sessionId: string, reason: string): Promise<void>;
}

// Tells a live call the result of the caller's account check.
export interface AccountCheckNotifier {
  notifyAccountCheck(
    sessionId: string,
    outcome: AccountCheckOutcome,
    serverAccessToken?: string,
    serverRole?: string,
  ): Promise<void>;
}

export type CallControl = CallStopper & AccountCheckNotifier;

export type PendingAccountCheck = {
  outcome: AccountCheckOutcome;
  serverAccessToken?: string;
  serverRole?: string;
};

// The live calls running in this API process. Lets the HTTP "end" endpoint and
// server shutdown hang up calls that are still connected to OpenAI.
export class ActiveCallRegistry implements CallControl {
  private readonly calls = new Map<string, SessionController>();
  private readonly pendingAccountChecks = new Map<
    string,
    PendingAccountCheck & { expiresAt: number }
  >();

  add(controller: SessionController): void {
    this.calls.set(controller.sessionId, controller);
  }

  remove(sessionId: string): void {
    this.calls.delete(sessionId);
    this.pendingAccountChecks.delete(sessionId);
  }

  consumePendingAccountCheck(
    sessionId: string,
  ): PendingAccountCheck | undefined {
    const pending = this.pendingAccountChecks.get(sessionId);
    this.pendingAccountChecks.delete(sessionId);
    if (!pending || pending.expiresAt <= Date.now()) return undefined;
    const { outcome, serverAccessToken, serverRole } = pending;
    return { outcome, serverAccessToken, serverRole };
  }

  get size(): number {
    return this.calls.size;
  }

  async notifyAccountCheck(
    sessionId: string,
    outcome: AccountCheckOutcome,
    serverAccessToken?: string,
    serverRole?: string,
  ): Promise<void> {
    const call = this.calls.get(sessionId);
    if (call) {
      await call.notifyAccountCheck(outcome, serverAccessToken, serverRole);
      return;
    }
    this.pendingAccountChecks.set(sessionId, {
      outcome,
      serverAccessToken,
      serverRole,
      expiresAt: Date.now() + 2 * 60_000,
    });
  }

  async stop(sessionId: string, reason: string): Promise<void> {
    await this.calls.get(sessionId)?.stop(reason);
    this.pendingAccountChecks.delete(sessionId);
  }

  async stopAll(reason: string): Promise<void> {
    await Promise.allSettled(
      [...this.calls.values()].map((controller) => controller.stop(reason)),
    );
    this.pendingAccountChecks.clear();
  }
}
