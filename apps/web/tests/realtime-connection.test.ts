import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectVoiceSession } from '../src/shared/public-api';
import { connectRealtimeVoice } from '../src/screen/voice/realtime-connection';

vi.mock('../src/shared/public-api', () => ({
  connectVoiceSession: vi.fn(),
}));

const session = {
  sessionId: '4c2b64aa-205b-43f0-a4df-e14c4c9f7688',
  sessionToken: 'short-lived-token',
  maxDurationSec: 300,
};

class FakeDataChannel extends EventTarget {
  readyState: RTCDataChannelState = 'open';
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.dispatchEvent(new Event('close'));
  }

  // Delivers a server event to the page, as OpenAI would.
  emit(event: Record<string, unknown>) {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(event) }),
    );
  }
}

class FakePeer extends EventTarget {
  iceGatheringState = 'complete';
  localDescription = { sdp: 'offer' };
  channel = new FakeDataChannel();

  createDataChannel() {
    return this.channel;
  }
  addTrack() {}
  async createOffer() {
    return { type: 'offer', sdp: 'offer' };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {
    // The provider announces the session as soon as the answer is applied.
    this.channel.emit({ type: 'session.created' });
  }
  close() {}
}

let peer: FakePeer;

beforeEach(() => {
  peer = new FakePeer();
  vi.stubGlobal('RTCPeerConnection', function () {
    return peer;
  });
  vi.stubGlobal(
    'MediaStream',
    class {
      getTracks() {
        return [];
      }
      addTrack() {}
    },
  );
  vi.mocked(connectVoiceSession).mockResolvedValue({
    sdp: 'answer-sdp',
    greeting: 'Thank you for calling TutWithUs. How may I help you today?',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function connect(
  overrides: Partial<Parameters<typeof connectRealtimeVoice>[0]> = {},
) {
  const signal = new AbortController().signal;
  return connectRealtimeVoice({
    localStream: { getAudioTracks: () => [] } as unknown as MediaStream,
    session,
    signal,
    onPeerConnection: vi.fn(),
    onRemoteStream: vi.fn(),
    onTranscript: vi.fn(async () => undefined),
    onTranscriptError: vi.fn(),
    ...overrides,
  });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('starting the conversation', () => {
  it('starts one response with the exact server-configured greeting', async () => {
    await connect();

    expect(peer.channel.sent).toEqual([
      JSON.stringify({
        type: 'response.create',
        response: {
          instructions:
            'Say this exact greeting once, verbatim, and say nothing else: "Thank you for calling TutWithUs. How may I help you today?". End the response immediately after the greeting, then wait silently for the caller. Do not speak formatting labels or tags.',
          tool_choice: 'none',
        },
      }),
    ]);
  });

  it('does not wrap the spoken greeting in model-visible markup', async () => {
    await connect();

    expect(peer.channel.sent[0]).not.toContain('<greeting>');
  });

  it('keeps caller audio muted until the single opening greeting completes', async () => {
    const callerTrack = { enabled: true } as MediaStreamTrack;
    await connect({
      localStream: {
        getAudioTracks: () => [callerTrack],
      } as unknown as MediaStream,
    });

    expect(callerTrack.enabled).toBe(false);
    expect(peer.channel.sent).toHaveLength(1);

    peer.channel.emit({
      type: 'response.created',
      response: { id: 'opening-greeting' },
    });
    expect(callerTrack.enabled).toBe(false);

    peer.channel.emit({
      type: 'response.done',
      response: { id: 'opening-greeting', status: 'completed' },
    });
    expect(callerTrack.enabled).toBe(true);
    expect(peer.channel.sent).toHaveLength(1);
  });

  it('waits for the ready callback before starting the greeting', async () => {
    const order: string[] = [];
    await connect({
      onReady: async () => {
        order.push('ready');
        await tick();
        expect(peer.channel.sent).toEqual([]);
        order.push('painted');
      },
    });

    order.push('connected');
    expect(order).toEqual(['ready', 'painted', 'connected']);
    expect(peer.channel.sent).toHaveLength(1);
  });

  it('does not try to speak first on a closed channel', async () => {
    peer.channel.readyState = 'closing';
    await connect();

    expect(peer.channel.sent).toEqual([]);
  });

  it('reports when the server ends the call', async () => {
    const onRemoteClosed = vi.fn();
    await connect({ onRemoteClosed });
    expect(onRemoteClosed).not.toHaveBeenCalled();

    peer.channel.close();

    expect(onRemoteClosed).toHaveBeenCalledOnce();
  });
});

describe('tool-routing responses', () => {
  it('does not display model text generated before a forced tool call', async () => {
    const onTranscript = vi.fn(async () => undefined);
    await connect({ onTranscript });
    peer.channel.emit({
      type: 'response.created',
      response: { id: 'opening-greeting' },
    });
    peer.channel.emit({
      type: 'response.done',
      response: { id: 'opening-greeting', status: 'completed' },
    });
    peer.channel.emit({
      type: 'response.created',
      response: {
        id: 'tool-route',
        metadata: { tutwithus_response_kind: 'tool_routing' },
      },
    });
    peer.channel.emit({
      type: 'response.output_text.done',
      response_id: 'tool-route',
      item_id: 'routing-text',
      text: 'Let me check that for you.',
    });
    await tick();

    expect(onTranscript).not.toHaveBeenCalled();
  });
});

describe('saving the transcript', () => {
  it('shows a returned tutor picture when the assistant says the full name', async () => {
    const onTutorProfile = vi.fn();
    const onTutorProfiles = vi.fn();
    await connect({ onTutorProfile, onTutorProfiles });

    peer.channel.emit({
      type: 'conversation.item.created',
      item: {
        type: 'function_call_output',
        output: JSON.stringify({
          uiTutorProfiles: [
            {
              fullName: 'Alice Abou Chacra',
              profilePic: 'https://cdn.example.com/alice.jpg',
            },
            {
              fullName: 'Taylor Tutor',
              profilePic: 'https://cdn.example.com/taylor.jpg',
            },
          ],
        }),
      },
    });
    peer.channel.emit({
      type: 'response.output_audio_transcript.delta',
      delta: 'Alice Abou ',
    });
    expect(onTutorProfile).not.toHaveBeenCalled();
    peer.channel.emit({
      type: 'response.output_audio_transcript.delta',
      delta: 'Chacra teaches Math.',
    });

    expect(onTutorProfile).toHaveBeenCalledOnce();
    expect(onTutorProfile).toHaveBeenCalledWith({
      fullName: 'Alice Abou Chacra',
      profilePic: 'https://cdn.example.com/alice.jpg',
    });
    expect(onTutorProfiles).toHaveBeenCalledWith([
      {
        fullName: 'Alice Abou Chacra',
        profilePic: 'https://cdn.example.com/alice.jpg',
      },
    ]);

    peer.channel.emit({
      type: 'response.output_audio_transcript.delta',
      delta: ' Taylor Tutor.',
    });
    expect(onTutorProfiles).toHaveBeenLastCalledWith([
      {
        fullName: 'Alice Abou Chacra',
        profilePic: 'https://cdn.example.com/alice.jpg',
      },
      {
        fullName: 'Taylor Tutor',
        profilePic: 'https://cdn.example.com/taylor.jpg',
      },
    ]);
  });

  it('shows the only returned tutor only after the assistant says their name', async () => {
    const onTutorProfile = vi.fn();
    await connect({ onTutorProfile });

    peer.channel.emit({
      type: 'conversation.item.created',
      item: {
        type: 'function_call_output',
        output: JSON.stringify({
          uiTutorProfiles: [
            {
              fullName: 'Elie Saide',
              profilePic: 'https://cdn.example.com/elie.jpg',
            },
          ],
        }),
      },
    });
    expect(onTutorProfile).not.toHaveBeenCalled();

    peer.channel.emit({
      type: 'response.output_audio_transcript.delta',
      delta: 'Great news—',
    });
    expect(onTutorProfile).not.toHaveBeenCalled();

    peer.channel.emit({
      type: 'response.output_audio_transcript.delta',
      delta: 'Elie Saide is the only tutor listed.',
    });

    expect(onTutorProfile).toHaveBeenCalledOnce();
    expect(onTutorProfile).toHaveBeenCalledWith({
      fullName: 'Elie Saide',
      profilePic: 'https://cdn.example.com/elie.jpg',
    });
  });

  it('shows the tutor again when their name is repeated in a later confirmation', async () => {
    const onTutorProfile = vi.fn();
    await connect({ onTutorProfile });

    peer.channel.emit({
      type: 'conversation.item.created',
      item: {
        type: 'function_call_output',
        output: JSON.stringify({
          uiTutorProfiles: [
            {
              fullName: 'Taylor Tutor',
              profilePic: 'https://cdn.example.com/taylor.jpg',
            },
          ],
        }),
      },
    });
    peer.channel.emit({
      type: 'response.output_audio_transcript.delta',
      delta: 'Taylor Tutor has an opening.',
    });
    expect(onTutorProfile).toHaveBeenCalledOnce();

    peer.channel.emit({
      type: 'response.done',
      response: { id: 'availability-response', status: 'completed' },
    });
    peer.channel.emit({
      type: 'response.created',
      response: { id: 'booking-confirmation' },
    });
    peer.channel.emit({
      type: 'response.output_audio_transcript.delta',
      delta: 'Please confirm your booking with Taylor Tutor.',
    });

    expect(onTutorProfile).toHaveBeenCalledTimes(2);
    expect(onTutorProfile).toHaveBeenLastCalledWith({
      fullName: 'Taylor Tutor',
      profilePic: 'https://cdn.example.com/taylor.jpg',
    });
  });

  it('notifies the page as soon as the caller starts speaking', async () => {
    const onCallerSpeechStarted = vi.fn();
    await connect({ onCallerSpeechStarted });

    peer.channel.emit({ type: 'input_audio_buffer.speech_started' });

    expect(onCallerSpeechStarted).toHaveBeenCalledOnce();
  });

  it('shows structured bundle editions as soon as the recommendation tool returns', async () => {
    const onBundleCarousel = vi.fn();
    await connect({ onBundleCarousel });

    peer.channel.emit({
      type: 'conversation.item.created',
      item: {
        type: 'function_call_output',
        output: JSON.stringify({
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
                ],
              },
            ],
          },
        }),
      },
    });

    expect(onBundleCarousel).toHaveBeenCalledOnce();
    expect(onBundleCarousel).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectName: 'Python',
        activeFamilyId: 'tech',
      }),
    );
  });

  it('saves what the caller and the agent said', async () => {
    const onTranscript = vi.fn(async () => undefined);
    await connect({ onTranscript });

    peer.channel.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'u1',
      transcript: 'hello',
    });
    peer.channel.emit({
      type: 'response.output_audio_transcript.done',
      item_id: 'a1',
      transcript: 'Welcome',
    });
    await tick();

    expect(onTranscript).toHaveBeenNthCalledWith(1, {
      eventId: 'user:u1',
      speaker: 'user',
      text: 'hello',
    });
    expect(onTranscript).toHaveBeenNthCalledWith(2, {
      eventId: 'assistant:a1',
      speaker: 'assistant',
      text: 'Welcome',
    });
  });

  it('does not save the caller turn expected to contain a spoken member ID', async () => {
    const onTranscript = vi.fn(async () => undefined);
    await connect({ onTranscript });

    peer.channel.emit({
      type: 'response.function_call_arguments.done',
      name: 'request_member_id',
      arguments: '{}',
    });
    peer.channel.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'member-id',
      transcript: 'My member ID is 000123',
    });
    peer.channel.emit({
      type: 'response.output_audio_transcript.done',
      item_id: 'assistant',
      transcript: 'Please tell me your member ID.',
    });
    await tick();

    expect(onTranscript).toHaveBeenCalledOnce();
    expect(onTranscript).toHaveBeenCalledWith({
      eventId: 'assistant:assistant',
      speaker: 'assistant',
      text: 'Please tell me your member ID.',
    });
    expect(JSON.stringify(onTranscript.mock.calls)).not.toContain('000123');
  });

  it('keeps split member-ID retries private until verification finishes', async () => {
    const onTranscript = vi.fn(async () => undefined);
    await connect({ onTranscript });

    peer.channel.emit({
      type: 'response.function_call_arguments.done',
      name: 'request_member_id',
      call_id: 'request-id',
      arguments: '{}',
    });
    peer.channel.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'fragment-1',
      transcript: '261003',
    });
    peer.channel.emit({
      type: 'response.function_call_arguments.done',
      name: 'verify_member_id',
      call_id: 'verify-1',
      arguments: JSON.stringify({ memberId: '261003' }),
    });
    peer.channel.emit({
      type: 'conversation.item.created',
      item: {
        type: 'function_call_output',
        call_id: 'verify-1',
        output: JSON.stringify({
          error: 'denied',
          reason: 'INVALID_ARGUMENTS',
        }),
      },
    });
    peer.channel.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'complete-id',
      transcript: '2610037',
    });
    peer.channel.emit({
      type: 'response.function_call_arguments.done',
      name: 'verify_member_id',
      call_id: 'verify-2',
      arguments: JSON.stringify({ memberId: '2610037' }),
    });
    peer.channel.emit({
      type: 'conversation.item.created',
      item: {
        type: 'function_call_output',
        call_id: 'verify-2',
        output: JSON.stringify({ status: 'verified' }),
      },
    });
    peer.channel.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'booking-request',
      transcript: 'Please continue my booking.',
    });
    await tick();

    expect(onTranscript).toHaveBeenCalledOnce();
    expect(onTranscript).toHaveBeenCalledWith({
      eventId: 'user:booking-request',
      speaker: 'user',
      text: 'Please continue my booking.',
    });
    expect(JSON.stringify(onTranscript.mock.calls)).not.toContain('2610037');
  });

  it('reports transcription failure once without suppressing later speech', async () => {
    const onTranscriptError = vi.fn();
    await connect({ onTranscriptError });

    peer.channel.emit({
      type: 'conversation.item.input_audio_transcription.failed',
    });
    peer.channel.emit({
      type: 'conversation.item.input_audio_transcription.failed',
    });

    expect(onTranscriptError).toHaveBeenCalledOnce();
  });

  it('continues saving and speaking after a transient transcript write failure', async () => {
    const onTranscript = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    await connect({ onTranscript });
    peer.channel.emit({
      type: 'response.output_audio_transcript.done',
      item_id: 'a1',
      transcript: 'مرحبا',
    });
    await tick();
    peer.channel.emit({
      type: 'response.output_audio_transcript.done',
      item_id: 'a2',
      transcript: 'كيف أساعدك؟',
    });
    await tick();
    expect(onTranscript).toHaveBeenCalledTimes(2);
  });
});
