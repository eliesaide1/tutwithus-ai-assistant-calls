import { describe, expect, it } from 'vitest';
import {
  parseBundleCarouselFromToolOutput,
  parseRealtimeTranscriptEvent,
  parseTutorProfilesFromToolOutput,
} from '../src/screen/voice/realtime-connection';

describe('Realtime transcript events', () => {
  it('captures completed caller and assistant transcripts', () => {
    expect(
      parseRealtimeTranscriptEvent(
        JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'item-1',
          transcript: 'Hello',
        }),
      ),
    ).toEqual({
      eventId: 'user:item-1',
      speaker: 'user',
      text: 'Hello',
    });

    expect(
      parseRealtimeTranscriptEvent(
        JSON.stringify({
          type: 'response.output_audio_transcript.done',
          item_id: 'item-2',
          transcript: 'Hi there',
        }),
      ),
    ).toEqual({
      eventId: 'assistant:item-2',
      speaker: 'assistant',
      text: 'Hi there',
    });

    expect(
      parseRealtimeTranscriptEvent(
        JSON.stringify({
          type: 'response.output_text.done',
          item_id: 'item-3',
          text: 'أهلًا بك',
        }),
      ),
    ).toEqual({
      eventId: 'assistant:item-3',
      speaker: 'assistant',
      text: 'أهلًا بك',
    });
  });

  it('ignores malformed, empty, and unrelated events', () => {
    expect(parseRealtimeTranscriptEvent('{')).toBeNull();
    expect(
      parseRealtimeTranscriptEvent(
        JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'item-1',
          transcript: '   ',
        }),
      ),
    ).toBeNull();
    expect(
      parseRealtimeTranscriptEvent(
        JSON.stringify({ type: 'response.created' }),
      ),
    ).toBeNull();
  });
});

describe('Bundle carousel UI metadata', () => {
  it('accepts structured Saudi-riyal editions and rejects invalid prices', () => {
    expect(
      parseBundleCarouselFromToolOutput(
        JSON.stringify({
          uiBundleCarousel: {
            subjectName: 'Python',
            activeFamilyId: 'tech',
            families: [
              {
                id: 'tech',
                name: 'Tech Programs',
                deliveryMode: 'one_to_one',
                editions: [
                  {
                    id: 'five',
                    name: 'Tech Programs Start',
                    sessions: 5,
                    totalPrice: 1075,
                    pricePerSession: 215,
                    currency: 'SAR',
                  },
                  {
                    id: 'invalid',
                    name: 'Invalid',
                    sessions: 10,
                    totalPrice: -1,
                    pricePerSession: 0,
                    currency: 'SAR',
                  },
                ],
              },
            ],
          },
        }),
      ),
    ).toEqual({
      subjectName: 'Python',
      activeFamilyId: 'tech',
      families: [
        {
          id: 'tech',
          name: 'Tech Programs',
          deliveryMode: 'one_to_one',
          editions: [
            {
              id: 'five',
              name: 'Tech Programs Start',
              sessions: 5,
              totalPrice: 1075,
              pricePerSession: 215,
              currency: 'SAR',
            },
          ],
        },
      ],
    });
  });
});

describe('Tutor profile UI metadata', () => {
  it('accepts only HTTPS tutor images with a name', () => {
    expect(
      parseTutorProfilesFromToolOutput(
        JSON.stringify({
          uiTutorProfiles: [
            {
              fullName: 'Alice Abou Chacra',
              profilePic: 'https://cdn.example.com/alice.jpg',
            },
            { fullName: 'Unsafe', profilePic: 'javascript:alert(1)' },
          ],
        }),
      ),
    ).toEqual([
      {
        fullName: 'Alice Abou Chacra',
        profilePic: 'https://cdn.example.com/alice.jpg',
      },
    ]);
  });
});
