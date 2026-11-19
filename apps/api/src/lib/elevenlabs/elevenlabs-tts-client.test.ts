import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElevenLabsTtsClient } from './elevenlabs-tts-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ElevenLabs Saudi Arabic TTS client', () => {
  it('yields audio before the provider finishes and cancels the reader', async () => {
    const cancel = vi.fn();
    const client = new ElevenLabsTtsClient(
      { apiKey: 'test-key', saudiArabicVoiceId: 'voice', modelId: 'model' },
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(new Uint8Array([1, 2]));
              },
              cancel,
            }),
          ),
      ),
    );
    const iterator = client.streamSaudiArabic('مرحبا');
    expect((await iterator.next()).value).toEqual(new Uint8Array([1, 2]));
    await iterator.return(undefined);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('sends Arabic text to the configured voice without exposing the key', async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toContain(
          '/v1/text-to-speech/saudi-voice/stream?output_format=mp3_44100_128',
        );
        expect(init?.method).toBe('POST');
        const headers = new Headers(init?.headers);
        expect(headers.get('xi-api-key')).toBe('test-elevenlabs-key');
        expect(headers.get('Accept')).toBe('audio/mpeg');
        expect(JSON.parse(String(init?.body))).toEqual({
          text: 'أهلًا بك',
          model_id: 'eleven_multilingual_v2',
          language_code: 'ar',
          voice_settings: { speed: 0.95 },
        });
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        });
      },
    );

    const client = new ElevenLabsTtsClient(
      {
        apiKey: 'test-elevenlabs-key',
        saudiArabicVoiceId: 'saudi-voice',
        modelId: 'eleven_multilingual_v2',
      },
      fetchMock,
    );

    const chunks: Uint8Array[] = [];
    for await (const chunk of client.streamSaudiArabic('أهلًا بك')) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the spoken brand name to ElevenLabs', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body)).text).toBe(
          'مرحبًا بك في Tute With Us',
        );
        return new Response(new Uint8Array([1]), { status: 200 });
      },
    );
    const client = new ElevenLabsTtsClient(
      {
        apiKey: 'test-elevenlabs-key',
        saudiArabicVoiceId: 'saudi-voice',
        modelId: 'eleven_multilingual_v2',
      },
      fetchMock,
    );

    for await (const _chunk of client.streamSaudiArabic(
      'مرحبًا بك في TutWithUs',
    )) {
      // Consume the stream so the request completes.
    }
  });

  it('reports provider failures without returning provider error content', async () => {
    const client = new ElevenLabsTtsClient(
      {
        apiKey: 'test-elevenlabs-key',
        saudiArabicVoiceId: 'saudi-voice',
        modelId: 'eleven_multilingual_v2',
      },
      vi.fn(
        async () => new Response('private provider response', { status: 401 }),
      ),
    );

    await expect(
      client.streamSaudiArabic('مرحبا').next(),
    ).rejects.toMatchObject({
      name: 'ElevenLabsTtsError',
      message: 'ElevenLabs speech synthesis returned HTTP 401.',
    });
  });
});
