import { useEffect, useRef, useState } from 'react';
import './AP_VoiceCall.css';

type AP_VoiceCallProps = {
  status: 'connecting' | 'connected';
  muted: boolean;
  remoteStream: MediaStream | null;
  connectingLabel: string;
  connectedLabel: string;
  assistantSpeakingLabel: string;
  muteLabel: string;
  unmuteLabel: string;
  endLabel: string;
  onToggleMute: () => void;
  onEndCall: () => void;
  onSpeakingChange: (speaking: boolean) => void;
  // Smoothed voice loudness from 0 (silent) to 1 (loud), called every frame.
  onLevelChange?: (level: number) => void;
};

export function AP_VoiceCall({
  status,
  muted,
  remoteStream,
  connectingLabel,
  connectedLabel,
  assistantSpeakingLabel,
  muteLabel,
  unmuteLabel,
  endLabel,
  onToggleMute,
  onEndCall,
  onSpeakingChange,
  onLevelChange,
}: AP_VoiceCallProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const statusLabel =
    status === 'connecting'
      ? connectingLabel
      : isSpeaking
        ? assistantSpeakingLabel
        : connectedLabel;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.srcObject = remoteStream;
    return () => {
      audio.pause();
      if (audio.srcObject === remoteStream) {
        audio.srcObject = null;
      }
      audio.load();
    };
  }, [remoteStream]);

  useEffect(() => {
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) {
      return;
    }

    try {
      const audioContext = new AudioContextConstructor();
      audioContextRef.current = audioContext;
      void audioContext.resume().catch((error: unknown) => {
        console.error(
          'Could not start remote voice activity monitoring.',
          error,
        );
      });
    } catch (error) {
      console.error('Could not monitor remote voice activity.', error);
    }

    return () => {
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (audioContext && audioContext.state !== 'closed') {
        void audioContext.close().catch((error: unknown) => {
          console.error(
            'Could not close remote voice activity monitoring.',
            error,
          );
        });
      }
    };
  }, []);

  useEffect(() => {
    const audioContext = audioContextRef.current;
    if (!remoteStream?.getAudioTracks().length || !audioContext) {
      setIsSpeaking(false);
      onSpeakingChange(false);
      onLevelChange?.(0);
      return;
    }

    let source: MediaStreamAudioSourceNode;
    let analyser: AnalyserNode;
    let silentGain: GainNode;

    try {
      source = audioContext.createMediaStreamSource(remoteStream);
      analyser = audioContext.createAnalyser();
      silentGain = audioContext.createGain();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.15;
      silentGain.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(audioContext.destination);
    } catch (error) {
      console.error('Could not monitor remote voice activity.', error);
      onSpeakingChange(false);
      return;
    }

    let frameId = 0;
    let speaking = false;
    let lastVoiceAt = 0;
    let disposed = false;
    let smoothedLevel = 0;
    const samples = new Uint8Array(analyser.fftSize);
    const updateSpeaking = (next: boolean) => {
      if (speaking !== next) {
        speaking = next;
        setIsSpeaking(next);
        onSpeakingChange(next);
      }
    };
    const detectVoice = (time: number) => {
      if (disposed) {
        return;
      }

      analyser.getByteTimeDomainData(samples);
      const energy =
        samples.reduce((sum, sample) => {
          const amplitude = (sample - 128) / 128;
          return sum + amplitude * amplitude;
        }, 0) / samples.length;
      const volume = Math.sqrt(energy);

      // Speech sits around 0.03–0.3 RMS. Scale it to 0–1 and ease toward the
      // target so the orb swells smoothly instead of flickering.
      const target = Math.min(1, volume * 4);
      smoothedLevel += (target - smoothedLevel) * 0.25;
      onLevelChange?.(smoothedLevel);

      if (volume >= 0.025) {
        lastVoiceAt = time;
        updateSpeaking(true);
      } else if (speaking && time - lastVoiceAt >= 300) {
        updateSpeaking(false);
      }

      frameId = window.requestAnimationFrame(detectVoice);
    };

    frameId = window.requestAnimationFrame(detectVoice);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      source.disconnect();
      analyser.disconnect();
      silentGain.disconnect();
      onLevelChange?.(0);
      if (speaking) {
        onSpeakingChange(false);
      }
    };
  }, [onLevelChange, onSpeakingChange, remoteStream]);

  return (
    <section
      aria-label={statusLabel}
      className="ap-voice-call"
      data-speaking={isSpeaking}
    >
      <audio autoPlay ref={audioRef} />
      <div className="ap-voice-call__message">
        <span
          aria-hidden="true"
          className="ap-voice-call__indicator"
          data-speaking={isSpeaking}
        />
        <p aria-live="polite" className="ap-voice-call__status" role="status">
          {statusLabel}
        </p>
      </div>
      <div className="ap-voice-call__controls">
        <button
          aria-pressed={muted}
          className="ap-voice-call__button"
          disabled={status !== 'connected'}
          onClick={onToggleMute}
          type="button"
        >
          {muted ? unmuteLabel : muteLabel}
        </button>
        <button
          className="ap-voice-call__button ap-voice-call__button--end"
          onClick={onEndCall}
          type="button"
        >
          {endLabel}
        </button>
      </div>
    </section>
  );
}
