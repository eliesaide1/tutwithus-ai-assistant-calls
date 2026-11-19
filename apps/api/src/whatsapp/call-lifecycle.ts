// What ends a WhatsApp call, as a short reason stored on the session record.
export type CallEndReason =
  'max_duration' | 'idle_timeout' | 'end_call' | 'caller_left' | 'error';

// The few things the lifecycle needs from a LiveKit AgentSession. Declared here
// so the limits can be tested without LiveKit.
export interface LifecycleSession {
  on(
    event: 'user_state_changed',
    listener: (event: UserStateEvent) => void,
  ): unknown;
  on(
    event: 'close',
    listener: (event?: { reason?: string; error?: unknown }) => void,
  ): unknown;
  shutdown(options?: { drain?: boolean }): void;
}

export type UserStateEvent = { newState: string };

export type CallLifecycleOptions = {
  session: LifecycleSession;
  maxCallSec: number;
  // How long the goodbye is given to finish after end_call.
  goodbyeGraceMs: number;
  // Called exactly once, with the first reason the call ended.
  onEnded: (reason: CallEndReason) => Promise<void> | void;
};

// Owns the limits of one WhatsApp call: the maximum length, ending after
// silence, and ending after end_call. Exactly one end is reported, whatever
// order the causes arrive in.
//
// Silence is LiveKit's "away" state. The session must be created with
// `userAwayTimeout` set to the idle limit; away means neither side has spoken
// for that long.
export class CallLifecycle {
  private ended = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  get isEnded(): boolean {
    return this.ended;
  }

  constructor(private readonly options: CallLifecycleOptions) {}

  start(): void {
    const { session, maxCallSec } = this.options;
    this.timers.add(
      setTimeout(() => this.end('max_duration'), maxCallSec * 1000),
    );
    session.on('user_state_changed', (event) => {
      if (event.newState === 'away') {
        this.end('idle_timeout');
      }
    });
    session.on('close', (event) => {
      // The caller hung up, or LiveKit closed the session. No hang-up needed.
      this.finish(
        event?.error || event?.reason === 'error' ? 'error' : 'caller_left',
      );
    });
  }

  // end_call: let the goodbye play, then hang up.
  requestEnd(reason: CallEndReason = 'end_call'): void {
    if (this.ended) {
      return;
    }
    this.timers.add(
      setTimeout(() => this.end(reason), this.options.goodbyeGraceMs),
    );
  }

  // For a failure outside the lifecycle, such as an unrecoverable agent error.
  fail(): void {
    this.end('error');
  }

  private end(reason: CallEndReason): void {
    if (this.ended) {
      return;
    }
    this.finish(reason);
    this.options.session.shutdown({ drain: false });
  }

  private finish(reason: CallEndReason): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    // A failing end handler must never stop the hang-up. It logs its own errors.
    void (async () => {
      await this.options.onEnded(reason);
    })().catch(() => undefined);
  }
}
