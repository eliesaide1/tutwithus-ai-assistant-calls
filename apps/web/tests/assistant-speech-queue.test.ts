import { describe, expect, it, vi } from 'vitest';
import { createAssistantSpeechQueue } from '../src/screen/voice/assistant-speech-queue';

const entry = (text: string) => ({
  eventId: `assistant:${text}`,
  speaker: 'assistant' as const,
  text,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// A fake speaker: each clip plays until released, or until its signal aborts.
function createSetup() {
  const played: string[] = [];
  const aborted: string[] = [];
  const releases = new Map<string, () => void>();
  const errors: unknown[] = [];
  const call = new AbortController();
  const speak = vi.fn(
    (spoken: { text: string }, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        played.push(spoken.text);
        releases.set(spoken.text, resolve);
        signal.addEventListener('abort', () => {
          aborted.push(spoken.text);
          reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
        });
      }),
  );
  const queue = createAssistantSpeechQueue({
    speak,
    onError: (error) => errors.push(error),
    signal: call.signal,
  });
  return { queue, played, aborted, releases, errors, call };
}

describe('assistant speech queue', () => {
  it('does not treat a wrapped HTTP cancellation as a speech failure', async () => {
    const onError = vi.fn();
    const queue = createAssistantSpeechQueue({
      signal: new AbortController().signal,
      onError,
      speak: async (_entry, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new Error('HTTP request cancelled')),
          );
        }),
    });
    queue.hold(undefined, entry('hello'));
    await tick();
    queue.interrupt();
    await tick();
    expect(onError).not.toHaveBeenCalled();
  });
  it('speaks a completed response in order, only after the response is done', async () => {
    const t = createSetup();
    t.queue.hold('r1', entry('one'));
    t.queue.hold('r1', entry('two'));
    await tick();
    expect(t.played).toEqual([]);

    t.queue.responseDone('r1', 'completed');
    await tick();
    expect(t.played).toEqual(['one']);

    t.releases.get('one')!();
    await tick();
    expect(t.played).toEqual(['one', 'two']);
  });

  it('never speaks a response the server cancelled or that failed', async () => {
    const t = createSetup();
    t.queue.hold('r1', entry('cut off'));
    t.queue.responseDone('r1', 'cancelled');
    t.queue.hold('r2', entry('failed'));
    t.queue.responseDone('r2', 'failed');
    await tick();

    expect(t.played).toEqual([]);
  });

  it('still speaks a reply that stopped at its length limit', async () => {
    const t = createSetup();
    t.queue.hold('r1', entry('long answer'));
    t.queue.responseDone('r1', 'incomplete');
    await tick();

    expect(t.played).toEqual(['long answer']);
  });

  it('stops the clip being played and drops the clips waiting behind it', async () => {
    const t = createSetup();
    t.queue.hold('r1', entry('playing'));
    t.queue.hold('r1', entry('waiting'));
    t.queue.hold('r1', entry('also waiting'));
    t.queue.responseDone('r1', 'completed');
    await tick();
    expect(t.played).toEqual(['playing']);

    t.queue.interrupt();
    await tick();

    expect(t.aborted).toEqual(['playing']);
    expect(t.played).toEqual(['playing']);
    // Being interrupted is expected, not a failure.
    expect(t.errors).toEqual([]);
  });

  it('drops replies still waiting for their response when the caller speaks', async () => {
    const t = createSetup();
    t.queue.hold('r1', entry('half-written'));
    t.queue.interrupt();
    t.queue.responseDone('r1', 'completed');
    await tick();

    expect(t.played).toEqual([]);
  });

  it('speaks the next reply normally after an interruption', async () => {
    const t = createSetup();
    t.queue.hold('r1', entry('old'));
    t.queue.responseDone('r1', 'completed');
    await tick();
    t.queue.interrupt();
    await tick();
    t.queue.hold('r2', entry('new answer'));
    t.queue.responseDone('r2', 'completed');
    await tick();

    expect(t.played).toEqual(['old', 'new answer']);
  });

  it('speaks straight away when the event carries no response id', async () => {
    const t = createSetup();
    t.queue.hold(undefined, entry('no id'));
    await tick();

    expect(t.played).toEqual(['no id']);
  });

  it('reports real speech failures and keeps going', async () => {
    const played: string[] = [];
    const errors: unknown[] = [];
    const queue = createAssistantSpeechQueue({
      speak: async (spoken) => {
        played.push(spoken.text);
        if (spoken.text === 'bad') {
          throw new Error('speech service down');
        }
      },
      onError: (error) => errors.push(error),
      signal: new AbortController().signal,
    });
    queue.hold('r1', entry('bad'));
    queue.hold('r1', entry('good'));
    queue.responseDone('r1', 'completed');
    await tick();
    await tick();

    expect(errors).toHaveLength(1);
    expect(played).toEqual(['bad', 'good']);
  });

  it('stops the current clip when the call itself ends', async () => {
    const t = createSetup();
    t.queue.hold('r1', entry('talking'));
    t.queue.responseDone('r1', 'completed');
    await tick();
    t.call.abort();
    await tick();

    expect(t.aborted).toEqual(['talking']);
    expect(t.errors).toEqual([]);
  });
});
