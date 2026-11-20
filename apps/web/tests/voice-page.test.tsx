import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkVoiceAccount,
  createVoiceSession,
  endVoiceSession,
  getPublicConfig,
  type PublicConfig,
} from '../src/shared/public-api';
import { AP_VoicePage } from '../src/screen/voice/AP_VoicePage';
import { AP_VoiceOrbCanvas } from '../src/screen/voice/components/AP_VoiceOrbCanvas';
import { AP_VoiceCall } from '../src/screen/voice/components/AP_VoiceCall';
import { connectRealtimeVoice } from '../src/screen/voice/realtime-connection';

vi.mock('../src/shared/public-api', () => ({
  checkVoiceAccount: vi.fn(),
  createVoiceSession: vi.fn(),
  connectVoiceSession: vi.fn(),
  endVoiceSession: vi.fn(),
  getPublicConfig: vi.fn(),
  PublicApiError: class PublicApiError extends Error {
    status?: number;
  },
}));

vi.mock('../src/screen/voice/realtime-connection', () => ({
  connectRealtimeVoice: vi.fn(),
}));

const publicConfig: PublicConfig = {
  languages: ['ar-SA', 'en', 'fr'],
  consentVersion: '2026-11-03.1',
  consentText: {
    'ar-SA': 'إشعار الموافقة',
    en: 'Consent notice',
    fr: 'Avis de consentement',
  },
  maxCallSec: 300,
};

const session = {
  sessionId: '4c2b64aa-205b-43f0-a4df-e14c4c9f7688',
  sessionToken: 'short-lived-token',
  maxDurationSec: 300,
};

describe('voice page call flow', () => {
  let canvasContext: CanvasRenderingContext2D;
  const stopTrack = vi.fn();
  const audioTrack = { stop: stopTrack, enabled: true };
  const stream = {
    getTracks: () => [audioTrack],
    getAudioTracks: () => [audioTrack],
  } as unknown as MediaStream;
  const getUserMedia = vi.fn();

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
      () => undefined,
    );
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(
      () => undefined,
    );
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const gradient = { addColorStop: vi.fn() };
    canvasContext = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      clip: vi.fn(),
      createRadialGradient: vi.fn(() => gradient),
      createLinearGradient: vi.fn(() => gradient),
      fill: vi.fn(),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext,
    );
    vi.mocked(getPublicConfig).mockResolvedValue(publicConfig);
    vi.mocked(createVoiceSession).mockResolvedValue(session);
    vi.mocked(checkVoiceAccount).mockResolvedValue({
      status: 'submitted',
      accountStatus: 'verified',
    });
    vi.mocked(endVoiceSession).mockResolvedValue();
    vi.mocked(connectRealtimeVoice).mockResolvedValue({} as RTCPeerConnection);
    getUserMedia.mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
  });

  describe('voice call activity indicator', () => {
    it('waves while remote audio is active and settles after the assistant stops', () => {
      const source = {
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      const analyser = {
        fftSize: 512,
        smoothingTimeConstant: 0,
        getByteTimeDomainData: vi.fn((samples: Uint8Array) =>
          samples.fill(128),
        ),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      const silentGain = {
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      const audioContext = {
        state: 'running',
        destination: {},
        createMediaStreamSource: vi.fn(() => source),
        createAnalyser: vi.fn(() => analyser),
        createGain: vi.fn(() => silentGain),
        resume: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as AudioContext;
      const AudioContextMock = vi.fn(() => audioContext);
      const remoteStream = {
        getAudioTracks: () => [{}],
      } as unknown as MediaStream;
      const onSpeakingChange = vi.fn();
      const originalAudioContext = Object.getOwnPropertyDescriptor(
        window,
        'AudioContext',
      );
      const originalSrcObject = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'srcObject',
      );
      const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(
        window,
        'requestAnimationFrame',
      );
      const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(
        window,
        'cancelAnimationFrame',
      );
      const frames = new Map<number, FrameRequestCallback>();
      let nextFrameId = 0;
      Object.defineProperty(window, 'AudioContext', {
        configurable: true,
        value: AudioContextMock,
      });
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        configurable: true,
        set: () => undefined,
      });
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        value: (callback: FrameRequestCallback) => {
          const id = ++nextFrameId;
          frames.set(id, callback);
          return id;
        },
      });
      Object.defineProperty(window, 'cancelAnimationFrame', {
        configurable: true,
        value: (id: number) => frames.delete(id),
      });

      const runFrame = (time: number) => {
        const next = frames.entries().next().value as
          [number, FrameRequestCallback] | undefined;
        if (!next) {
          throw new Error('No audio analysis frame was scheduled.');
        }
        frames.delete(next[0]);
        next[1](time);
      };
      const restoreProperty = (
        target: object,
        key: string,
        descriptor: PropertyDescriptor | undefined,
      ) => {
        if (descriptor) {
          Object.defineProperty(target, key, descriptor);
        } else {
          Reflect.deleteProperty(target, key);
        }
      };

      const { unmount } = render(
        <AP_VoiceCall
          assistantSpeakingLabel="The assistant is speaking."
          connectedLabel="I’m listening."
          connectingLabel="Connecting."
          endLabel="End call"
          muteLabel="Mute"
          muted={false}
          onEndCall={vi.fn()}
          onSpeakingChange={onSpeakingChange}
          onToggleMute={vi.fn()}
          remoteStream={remoteStream}
          status="connected"
          unmuteLabel="Unmute"
        />,
      );

      try {
        analyser.getByteTimeDomainData.mockImplementation((samples) =>
          samples.fill(150),
        );
        act(() => runFrame(16));
        expect(screen.getByRole('status').textContent).toBe(
          'The assistant is speaking.',
        );
        expect(
          document.querySelector('.ap-voice-call[data-speaking="true"]'),
        ).not.toBeNull();
        expect(onSpeakingChange).toHaveBeenLastCalledWith(true);

        analyser.getByteTimeDomainData.mockImplementation((samples) =>
          samples.fill(128),
        );
        act(() => runFrame(100));
        expect(
          document.querySelector('.ap-voice-call[data-speaking="true"]'),
        ).not.toBeNull();

        act(() => runFrame(320));
        expect(screen.getByRole('status').textContent).toBe('I’m listening.');
        expect(
          document.querySelector('.ap-voice-call[data-speaking="true"]'),
        ).toBeNull();
        expect(onSpeakingChange).toHaveBeenLastCalledWith(false);
      } finally {
        unmount();
        restoreProperty(window, 'AudioContext', originalAudioContext);
        restoreProperty(
          HTMLMediaElement.prototype,
          'srcObject',
          originalSrcObject,
        );
        restoreProperty(
          window,
          'requestAnimationFrame',
          originalRequestAnimationFrame,
        );
        restoreProperty(
          window,
          'cancelAnimationFrame',
          originalCancelAnimationFrame,
        );
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws a transparent orb made only from dots', () => {
    const bounds = {
      bottom: 320,
      height: 320,
      left: 0,
      right: 320,
      top: 0,
      width: 320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    const boundsSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(bounds);
    const { unmount } = render(<AP_VoiceOrbCanvas state="idle" />);

    try {
      expect(canvasContext.arc).toHaveBeenCalled();
      expect(canvasContext.fill).toHaveBeenCalled();
      expect(canvasContext.fillRect).not.toHaveBeenCalled();
      expect(canvasContext.stroke).not.toHaveBeenCalled();
    } finally {
      unmount();
      boundsSpy.mockRestore();
    }
  });

  it('does not request the microphone before consent and the explicit Start action', async () => {
    render(<AP_VoicePage />);

    await screen.findByText('Consent notice');
    expect(
      screen.queryByText(/Your browser will ask for microphone access/),
    ).toBeNull();
    expect(
      screen.queryByRole('checkbox', {
        name: /written copy|transcript/i,
      }),
    ).toBeNull();
    expect(screen.queryByText('Here to help')).toBeNull();
    expect(screen.queryByText('Available now')).toBeNull();
    expect(document.querySelector('.ap-sound-orb canvas')).not.toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I understand this is an AI assistant/i,
      }),
    );
    const phoneInput = screen.getByLabelText(
      /Phone number/i,
    ) as HTMLInputElement;
    expect(
      (screen.getByRole('button', { name: 'Arabic' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    const phonePattern = phoneInput.getAttribute('pattern');
    expect(phonePattern).toBeTruthy();
    const phoneRegex = new RegExp(`^(?:${phonePattern ?? ''})$`, 'v');
    expect(phoneRegex.test('+966 (50) 123-4567')).toBe(true);
    expect(phoneRegex.test('not a phone')).toBe(false);
    expect(phoneRegex.test('----------')).toBe(false);
    fireEvent.change(phoneInput, {
      target: { value: '+966501234567' },
    });
    fireEvent.change(screen.getByLabelText(/member ID/i), {
      target: { value: '2610037' },
    });
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start talking' }));
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    });
    await screen.findByText('Listening…');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Arabic' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('dialog').querySelector('canvas')).not.toBeNull();
    expect(
      screen.getByRole('dialog').querySelector('.ap-voice-call__button--end'),
    ).not.toBeNull();
    expect(createVoiceSession).toHaveBeenCalledOnce();
    expect(createVoiceSession).toHaveBeenCalledWith({
      locale: 'en',
      consentVersion: publicConfig.consentVersion,
      phone: '+966501234567',
      timeZone: expect.any(String),
    });
    expect(checkVoiceAccount).toHaveBeenCalledWith(session, '2610037');
    expect(connectRealtimeVoice).toHaveBeenCalledOnce();
  });

  it('does not create a backend session when microphone permission is denied', async () => {
    getUserMedia.mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    );
    render(<AP_VoicePage />);

    await screen.findByText('Consent notice');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I understand this is an AI assistant/i,
      }),
    );
    fireEvent.change(screen.getByLabelText(/Phone number/i), {
      target: { value: '+966501234567' },
    });
    fireEvent.change(screen.getByLabelText(/member ID/i), {
      target: { value: '2610037' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start talking' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Microphone access was denied.',
    );
    expect(createVoiceSession).not.toHaveBeenCalled();
    expect(connectRealtimeVoice).not.toHaveBeenCalled();
  });

  it('shows returned tutors inside the orb and hides them when the caller responds', async () => {
    render(<AP_VoicePage />);

    await screen.findByText('Consent notice');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I understand this is an AI assistant/i,
      }),
    );
    fireEvent.change(screen.getByLabelText(/Phone number/i), {
      target: { value: '+966501234567' },
    });
    fireEvent.change(screen.getByLabelText(/member ID/i), {
      target: { value: '2610037' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start talking' }));
    await screen.findByRole('button', { name: 'End call' });

    const realtimeOptions = vi.mocked(connectRealtimeVoice).mock.calls[0]?.[0];
    expect(realtimeOptions).toBeDefined();
    expect(document.querySelectorAll('.ap-tutor-carousel')).toHaveLength(0);

    act(() =>
      realtimeOptions?.onTutorProfiles?.([
        {
          fullName: 'Taylor Tutor',
          profilePic: 'https://cdn.example.com/taylor.jpg',
        },
        {
          fullName: 'Alice Tutor',
          profilePic: 'https://cdn.example.com/alice.jpg',
        },
      ]),
    );
    expect(document.querySelectorAll('.ap-tutor-carousel')).toHaveLength(1);
    expect(screen.getByAltText('Taylor Tutor').getAttribute('src')).toBe(
      'https://cdn.example.com/taylor.jpg',
    );

    act(() => realtimeOptions?.onCallerSpeechStarted?.());
    expect(document.querySelectorAll('.ap-tutor-carousel')).toHaveLength(0);
  });

  it('stops microphone tracks and ends the session when the caller hangs up', async () => {
    render(<AP_VoicePage />);

    await screen.findByText('Consent notice');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I understand this is an AI assistant/i,
      }),
    );
    fireEvent.change(screen.getByLabelText(/Phone number/i), {
      target: { value: '+966501234567' },
    });
    fireEvent.change(screen.getByLabelText(/member ID/i), {
      target: { value: '2610037' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start talking' }));
    fireEvent.click(await screen.findByRole('button', { name: 'End call' }));

    await waitFor(() => {
      expect(endVoiceSession).toHaveBeenCalledWith(session, 'user_ended');
      expect(stopTrack).toHaveBeenCalledOnce();
    });
  });

  it('ignores a delayed close event from a call that ended before a new call started', async () => {
    const firstSession = session;
    const secondSession = {
      ...session,
      sessionId: '7b330699-d910-42cc-9758-7328a4eebafd',
    };
    vi.mocked(createVoiceSession)
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession);

    render(<AP_VoicePage />);

    await screen.findByText('Consent notice');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I understand this is an AI assistant/i,
      }),
    );
    fireEvent.change(screen.getByLabelText(/Phone number/i), {
      target: { value: '+966501234567' },
    });
    fireEvent.change(screen.getByLabelText(/member ID/i), {
      target: { value: '2610037' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start talking' }));
    await screen.findByRole('button', { name: 'End call' });

    const firstConnection = vi.mocked(connectRealtimeVoice).mock.calls[0]?.[0];
    expect(firstConnection).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'End call' }));
    await waitFor(() =>
      expect(endVoiceSession).toHaveBeenCalledWith(firstSession, 'user_ended'),
    );

    // The member id is discarded once verified, so a second call needs it
    // entered again; the phone number is still held.
    fireEvent.change(screen.getByLabelText(/member ID/i), {
      target: { value: '2610037' },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Start talking' }),
    );
    await waitFor(() => expect(connectRealtimeVoice).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: 'End call' });

    act(() => firstConnection?.onRemoteClosed?.());

    expect(screen.getByRole('button', { name: 'End call' })).toBeTruthy();
    expect(endVoiceSession).not.toHaveBeenCalledWith(
      secondSession,
      'call_ended_by_server',
    );
  });
});
