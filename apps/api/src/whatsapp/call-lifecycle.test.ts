import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CallLifecycle,
  type CallEndReason,
  type LifecycleSession,
} from './call-lifecycle.js';

class FakeSession extends EventEmitter {
  shutdown = vi.fn();
}

function setup(options: { maxCallSec?: number; goodbyeGraceMs?: number } = {}) {
  const session = new FakeSession();
  const ended: CallEndReason[] = [];
  const lifecycle = new CallLifecycle({
    session: session as unknown as LifecycleSession,
    maxCallSec: options.maxCallSec ?? 300,
    goodbyeGraceMs: options.goodbyeGraceMs ?? 6_000,
    onEnded: (reason) => {
      ended.push(reason);
    },
  });
  lifecycle.start();
  return { session, lifecycle, ended };
}

describe('CallLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends the call at the maximum duration', () => {
    const { session, ended } = setup({ maxCallSec: 60 });

    expect(ended).toEqual([]);
    vi.advanceTimersByTime(59_999);
    expect(ended).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(ended).toEqual(['max_duration']);
    expect(session.shutdown).toHaveBeenCalledTimes(1);
  });

  it('exposes whether the call has ended', () => {
    const { session, lifecycle } = setup();

    expect(lifecycle.isEnded).toBe(false);
    session.emit('close');
    expect(lifecycle.isEnded).toBe(true);
  });

  it('ends the call after silence, when the user goes away', () => {
    const { session, ended } = setup();

    session.emit('user_state_changed', { newState: 'speaking' });
    session.emit('user_state_changed', { newState: 'listening' });
    expect(ended).toEqual([]);
    session.emit('user_state_changed', { newState: 'away' });

    expect(ended).toEqual(['idle_timeout']);
    expect(session.shutdown).toHaveBeenCalledTimes(1);
  });

  it('waits for the goodbye before ending after end_call', () => {
    const { session, lifecycle, ended } = setup({ goodbyeGraceMs: 6_000 });

    lifecycle.requestEnd('end_call');
    vi.advanceTimersByTime(5_999);
    expect(ended).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(ended).toEqual(['end_call']);
    expect(session.shutdown).toHaveBeenCalledTimes(1);
  });

  it('records a caller hang-up without shutting the session down again', () => {
    const { session, ended } = setup();

    session.emit('close');

    expect(ended).toEqual(['caller_left']);
    expect(session.shutdown).not.toHaveBeenCalled();
  });

  it('reports only the first cause when several arrive', () => {
    const { session, lifecycle, ended } = setup({ maxCallSec: 10 });

    session.emit('user_state_changed', { newState: 'away' });
    lifecycle.requestEnd('end_call');
    session.emit('close');
    vi.advanceTimersByTime(60_000);

    expect(ended).toEqual(['idle_timeout']);
    expect(session.shutdown).toHaveBeenCalledTimes(1);
  });

  it('records provider closure as an error instead of a caller hang-up', () => {
    const { session, ended } = setup();
    session.emit('close', {
      reason: 'error',
      error: new Error('provider down'),
    });
    expect(ended).toEqual(['error']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops its timers once the call has ended', () => {
    const { session, ended } = setup({ maxCallSec: 10 });

    session.emit('close');
    vi.advanceTimersByTime(60_000);

    expect(ended).toEqual(['caller_left']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores an end request after the call is already over', () => {
    const { session, lifecycle, ended } = setup();

    session.emit('close');
    lifecycle.requestEnd('end_call');
    vi.advanceTimersByTime(60_000);

    expect(ended).toEqual(['caller_left']);
  });

  it('ends with the error reason when the agent fails', () => {
    const { session, lifecycle, ended } = setup();

    lifecycle.fail();

    expect(ended).toEqual(['error']);
    expect(session.shutdown).toHaveBeenCalledTimes(1);
  });

  it('survives an end handler that throws', async () => {
    const session = new FakeSession();
    const lifecycle = new CallLifecycle({
      session: session as unknown as LifecycleSession,
      maxCallSec: 300,
      goodbyeGraceMs: 1_000,
      onEnded: () => {
        throw new Error('database down');
      },
    });
    lifecycle.start();

    expect(() =>
      session.emit('user_state_changed', { newState: 'away' }),
    ).not.toThrow();
    expect(session.shutdown).toHaveBeenCalledTimes(1);
  });
});
