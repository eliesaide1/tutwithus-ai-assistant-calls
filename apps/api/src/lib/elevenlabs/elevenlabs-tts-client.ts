import { normalizeTextForSpeech } from '../../core/speech/brand-pronunciation.js';

export type ElevenLabsTtsConfig = {
  apiKey: string | undefined;
  saudiArabicVoiceId: string | undefined;
  modelId: string;
};

export class ElevenLabsTtsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ElevenLabsTtsError';
  }
}

export class ElevenLabsTtsClient {
  constructor(
    private readonly config: ElevenLabsTtsConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async *streamSaudiArabic(
    text: string,
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    const deadline = AbortSignal.timeout(15_000);
    signal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const voiceId = this.config.saudiArabicVoiceId;
    if (
      !this.config.apiKey ||
      !voiceId ||
      voiceId.startsWith('replace-with-')
    ) {
      throw new ElevenLabsTtsError(
        'Saudi Arabic speech synthesis is not configured.',
      );
    }

    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': this.config.apiKey,
          },
          body: JSON.stringify({
            text: normalizeTextForSpeech(text),
            model_id: this.config.modelId,
            language_code: 'ar',
            voice_settings: { speed: 0.95 },
          }),
          signal,
        },
      );
    } catch (error) {
      throw new ElevenLabsTtsError(
        'ElevenLabs speech synthesis request failed.',
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new ElevenLabsTtsError(
        `ElevenLabs speech synthesis returned HTTP ${response.status}.`,
      );
    }

    if (!response.body) {
      throw new ElevenLabsTtsError('ElevenLabs returned no speech audio.');
    }
    const reader = response.body.getReader();
    let bytes = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8 * 1024 * 1024) {
          throw new ElevenLabsTtsError(
            'ElevenLabs returned too much speech audio.',
          );
        }
        if (value.byteLength) yield value;
      }
      if (!bytes)
        throw new ElevenLabsTtsError('ElevenLabs returned no speech audio.');
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
