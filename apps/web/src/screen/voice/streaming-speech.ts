// ElevenLabs MP3 is appended as it arrives. Browsers without MP3 MediaSource
// support use the same provider with buffered playback.
export async function playSpeechStream(
  audio: HTMLAudioElement,
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onSpeaking: (speaking: boolean) => void,
): Promise<void> {
  const reader = stream.getReader();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = window.setTimeout(
    () => controller.abort(new Error('Speech playback timed out.')),
    60_000,
  );
  const cancelled = () => {
    void reader.cancel().catch(() => undefined);
    audio.pause();
  };
  controller.signal.addEventListener('abort', cancelled, { once: true });
  let url: string | undefined;

  function wait(target: EventTarget, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        target.removeEventListener(name, done);
        target.removeEventListener('error', failed);
        controller.signal.removeEventListener('abort', aborted);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error('Speech playback failed.'));
      };
      const aborted = () => {
        cleanup();
        reject(controller.signal.reason);
      };
      target.addEventListener(name, done, { once: true });
      target.addEventListener('error', failed, { once: true });
      controller.signal.addEventListener('abort', aborted, { once: true });
      if (controller.signal.aborted) aborted();
    });
  }

  const playing = () => onSpeaking(true);
  audio.addEventListener('playing', playing);
  try {
    controller.signal.throwIfAborted();
    if (
      typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('audio/mpeg')
    ) {
      const source = new MediaSource();
      const opened = wait(source, 'sourceopen');
      url = URL.createObjectURL(source);
      audio.src = url;
      await opened;
      const buffer = source.addSourceBuffer('audio/mpeg');
      let started = false;
      // Attach a rejection handler immediately while the network is pumping.
      const ended = wait(audio, 'ended');
      void ended.catch(() => undefined);
      while (true) {
        const { value, done } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        if (!value.byteLength) continue;
        const appended = wait(buffer, 'updateend');
        void appended.catch(() => undefined);
        buffer.appendBuffer(new Uint8Array(value));
        await appended;
        if (!started) {
          started = true;
          await audio.play();
        }
      }
      if (!started) throw new Error('Speech service returned empty audio.');
      source.endOfStream();
      await ended;
    } else {
      const chunks: ArrayBuffer[] = [];
      while (true) {
        const { value, done } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        chunks.push(new Uint8Array(value).buffer);
      }
      const blob = new Blob(chunks, { type: 'audio/mpeg' });
      if (!blob.size) throw new Error('Speech service returned empty audio.');
      url = URL.createObjectURL(blob);
      audio.src = url;
      const ended = wait(audio, 'ended');
      void ended.catch(() => undefined);
      await audio.play();
      await ended;
    }
  } finally {
    controller.abort(new DOMException('Speech finished.', 'AbortError'));
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', cancelled);
    audio.removeEventListener('playing', playing);
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (url) URL.revokeObjectURL(url);
    onSpeaking(false);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
