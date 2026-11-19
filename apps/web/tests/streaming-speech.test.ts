import { afterEach, describe, expect, it, vi } from 'vitest';
import { playSpeechStream } from '../src/screen/voice/streaming-speech';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(streaming: boolean) {
  const audio = document.createElement('audio');
  vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
  vi.spyOn(audio, 'load').mockImplementation(() => undefined);
  const play = vi.spyOn(audio, 'play').mockImplementation(async () => {
    audio.dispatchEvent(new Event('playing'));
    if (!streaming)
      queueMicrotask(() => audio.dispatchEvent(new Event('ended')));
  });
  const append = vi.fn();
  class FakeSource extends EventTarget {
    static isTypeSupported() {
      return streaming;
    }
    addSourceBuffer() {
      const buffer = new EventTarget();
      return Object.assign(buffer, {
        appendBuffer: (bytes: Uint8Array) => {
          append(bytes);
          queueMicrotask(() => buffer.dispatchEvent(new Event('updateend')));
        },
      });
    }
    endOfStream() {
      queueMicrotask(() => audio.dispatchEvent(new Event('ended')));
    }
  }
  vi.stubGlobal('MediaSource', FakeSource);
  const revoke = vi.fn();
  vi.stubGlobal('URL', {
    createObjectURL: (source: unknown) => {
      if (source instanceof FakeSource)
        queueMicrotask(() => source.dispatchEvent(new Event('sourceopen')));
      return 'blob:test';
    },
    revokeObjectURL: revoke,
  });
  return { audio, play, append, revoke };
}

describe('ElevenLabs audio playback', () => {
  it('starts playing before the audio download finishes', async () => {
    const t = setup(true);
    let producer!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        producer = c;
      },
    });
    const playing = playSpeechStream(
      t.audio,
      stream,
      new AbortController().signal,
      vi.fn(),
    );
    producer.enqueue(new Uint8Array([1, 2]));
    await vi.waitFor(() => expect(t.play).toHaveBeenCalledOnce());
    producer.enqueue(new Uint8Array([3, 4]));
    producer.close();
    await playing;
    expect(t.append).toHaveBeenCalledTimes(2);
    expect(t.revoke).toHaveBeenCalledWith('blob:test');
  });

  it('cancels a stalled download and stops playback when interrupted', async () => {
    const t = setup(true);
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    const controller = new AbortController();
    const playing = playSpeechStream(
      t.audio,
      stream,
      controller.signal,
      vi.fn(),
    );
    const rejected = expect(playing).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.waitFor(() => expect(t.play).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(t.audio.pause).toHaveBeenCalled();
  });

  it('uses buffered playback when MP3 streaming is unavailable', async () => {
    const t = setup(false);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1]));
        c.close();
      },
    });
    await playSpeechStream(
      t.audio,
      stream,
      new AbortController().signal,
      vi.fn(),
    );
    expect(t.play).toHaveBeenCalledOnce();
    expect(t.append).not.toHaveBeenCalled();
  });
});
