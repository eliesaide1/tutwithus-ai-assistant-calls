import { useCallback, useEffect, useRef, useState } from 'react';
import { BRAND_LOGO_SRC } from '../../shared/brand';
import { AP_LanguageSwitch } from '../../components/ui/AP_LanguageSwitch';
import { AP_LoadingIndicator } from '../../components/ui/AP_LoadingIndicator';
import {
  checkVoiceAccount,
  createVoiceSession,
  endVoiceSession,
  getPublicConfig,
  PublicApiError,
  saveVoiceTranscriptEntry,
  streamSaudiArabicSpeech,
  type CreateVoiceSessionResponse,
  type PublicConfig,
} from '../../shared/public-api';
import { getDirection, messages, type Locale } from '../../shared/i18n';
import { AP_ConsentStep } from './components/AP_ConsentStep';
import { AP_VoiceCall } from './components/AP_VoiceCall';
import { AP_VoiceOrbCanvas } from './components/AP_VoiceOrbCanvas';
import { AP_BundleCarousel } from './components/AP_BundleCarousel';
import { AP_TutorCarousel } from './components/AP_TutorCarousel';
import {
  connectRealtimeVoice,
  type BundleCarouselDisplay,
  type TutorProfileDisplay,
} from './realtime-connection';
import { playSpeechStream } from './streaming-speech';
import { readBrowserIdentityProof } from './browser-identity';
import { ScreenWakeLock } from './screen-wake-lock';
import { detectBrowserTimeZone } from './browser-timezone';
import './AP_VoicePage.css';

export function AP_VoicePage() {
  const [identityProof] = useState(readBrowserIdentityProof);
  const [locale, setLocale] = useState<Locale>('en');
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [phone, setPhone] = useState('');
  const [memberId, setMemberId] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState<
    'connecting' | 'connected' | null
  >(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [callGenerationKey, setCallGenerationKey] = useState(0);
  const [activeTutorProfiles, setActiveTutorProfiles] = useState<
    TutorProfileDisplay[]
  >([]);
  const [tutorProfilesRevision, setTutorProfilesRevision] = useState(0);
  const [activeBundleCarousel, setActiveBundleCarousel] =
    useState<BundleCarouselDisplay | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const activeSessionRef = useRef<CreateVoiceSessionResponse | null>(null);
  const connectAbortRef = useRef<AbortController | null>(null);
  // React state is not a synchronous lock. A second click can arrive before
  // isStarting/callStatus has rendered, especially while a cold API is waking.
  const callStartGuardRef = useRef(false);
  // Every asynchronous callback captures the generation that created it.
  // This prevents a late close/error event from an ended call from touching a
  // call that the visitor started immediately afterwards.
  const callGenerationRef = useRef(0);
  const callTimerRef = useRef<number | null>(null);
  const tutorCarouselTimerRef = useRef<number | null>(null);
  const endingCallRef = useRef(false);
  const transcriptWritesRef = useRef<Promise<void>>(Promise.resolve());
  const arabicAudioRef = useRef<HTMLAudioElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const mobileOrbRef = useRef<HTMLDivElement>(null);
  const screenWakeLockRef = useRef<ScreenWakeLock | null>(null);
  const direction = getDirection(locale);
  const text = messages[locale];
  useEffect(
    () => () => {
      if (tutorCarouselTimerRef.current !== null) {
        window.clearTimeout(tutorCarouselTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 600px)');
    const updateLayout = () => setIsMobileLayout(mobileQuery.matches);
    updateLayout();
    mobileQuery.addEventListener('change', updateLayout);
    return () => mobileQuery.removeEventListener('change', updateLayout);
  }, []);

  useEffect(() => {
    const wakeLock = new ScreenWakeLock();
    screenWakeLockRef.current = wakeLock;
    return () => {
      if (screenWakeLockRef.current === wakeLock) {
        screenWakeLockRef.current = null;
      }
      void wakeLock.stop();
    };
  }, []);

  const orbState =
    callStatus === 'connecting'
      ? 'connecting'
      : callStatus === 'connected'
        ? isAssistantSpeaking
          ? 'speaking'
          : 'listening'
        : 'idle';
  const orbLabel =
    orbState === 'connecting'
      ? text.callConnecting
      : orbState === 'speaking'
        ? text.callSpeaking
        : orbState === 'listening'
          ? text.callConnected
          : text.decorativeWaveLabel;

  // Voice loudness drives the orb size directly on the element. Writing a CSS
  // variable avoids re-rendering React about 60 times a second.
  const handleLevelChange = useCallback((level: number) => {
    const value = level.toFixed(3);
    orbRef.current?.style.setProperty('--ap-level', value);
    mobileOrbRef.current?.style.setProperty('--ap-level', value);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    getPublicConfig(controller.signal)
      .then(setConfig)
      .catch(() => {
        if (!controller.signal.aborted) {
          setConfigError(true);
        }
      });

    return () => controller.abort();
  }, [configAttempt]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    document.title = text.pageTitle;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', text.pageDescription);
  }, [direction, locale, text.pageDescription, text.pageTitle]);

  useEffect(
    () => () => {
      connectAbortRef.current?.abort();
      if (callTimerRef.current !== null) {
        window.clearTimeout(callTimerRef.current);
      }
      peerConnectionRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
      void screenWakeLockRef.current?.stop();
      const activeSession = activeSessionRef.current;
      if (activeSession) {
        void endVoiceSession(activeSession, 'page_closed', true).catch(
          (error: unknown) => {
            console.error(
              'Could not notify the API that the call ended.',
              error,
            );
          },
        );
      }
    },
    [],
  );

  function releaseCallResources(callGeneration = callGenerationRef.current) {
    if (callGeneration !== callGenerationRef.current) {
      return;
    }
    callStartGuardRef.current = false;
    connectAbortRef.current?.abort();
    connectAbortRef.current = null;
    if (callTimerRef.current !== null) {
      window.clearTimeout(callTimerRef.current);
      callTimerRef.current = null;
    }
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;
    void screenWakeLockRef.current?.stop();
    const audio = arabicAudioRef.current;
    audio?.pause();
    if (audio) {
      audio.removeAttribute('src');
      audio.load();
    }
    setRemoteStream(null);
    setIsAssistantSpeaking(false);
    setActiveTutorProfiles([]);
  }

  async function playSaudiArabicSpeech(
    session: CreateVoiceSessionResponse,
    text: string,
    signal: AbortSignal,
  ) {
    const audio = arabicAudioRef.current;
    if (!audio) throw new Error('Saudi Arabic audio player is unavailable.');
    // Retry only before anything was audible, so callers never hear a repeated
    // partial answer. Arabic speech always stays on ElevenLabs.
    let audible = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const stream = await streamSaudiArabicSpeech(session, text, signal);
        await playSpeechStream(audio, stream, signal, (speaking) => {
          audible ||= speaking;
          setIsAssistantSpeaking(speaking);
        });
        return;
      } catch (error) {
        if (signal.aborted || audible || attempt === 1) throw error;
      }
    }
  }

  async function finishCall(
    reason: string,
    callGeneration = callGenerationRef.current,
  ) {
    if (callGeneration !== callGenerationRef.current || endingCallRef.current) {
      return;
    }
    endingCallRef.current = true;
    const activeSession = activeSessionRef.current;
    activeSessionRef.current = null;
    const pendingTranscriptWrites = transcriptWritesRef.current;
    releaseCallResources(callGeneration);
    setCallStatus(null);
    setIsAssistantSpeaking(false);
    setIsStarting(false);
    setIsMuted(false);
    setActiveTutorProfiles([]);
    setActiveBundleCarousel(null);

    if (activeSession) {
      try {
        await pendingTranscriptWrites.catch(() => undefined);
        await endVoiceSession(activeSession, reason);
      } catch {
        if (
          callGeneration === callGenerationRef.current &&
          reason !== 'transcript_save_failed'
        ) {
          setStartError(text.sessionEndError);
        }
      }
    }
  }

  async function handleStart() {
    if (
      !config ||
      !acknowledged ||
      isStarting ||
      callStatus ||
      callStartGuardRef.current
    ) {
      return;
    }

    const trimmedPhone = phone.trim();
    const trimmedMemberId = memberId.trim();
    if (Boolean(trimmedPhone) !== Boolean(trimmedMemberId)) {
      setStartError(text.accountCredentialsPairError);
      return;
    }

    // Set this before any await so one user action can create only one call.
    callStartGuardRef.current = true;
    const callGeneration = callGenerationRef.current + 1;
    callGenerationRef.current = callGeneration;
    setCallGenerationKey(callGeneration);
    const isCurrentCall = () =>
      callGeneration === callGenerationRef.current && !endingCallRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      callStartGuardRef.current = false;
      setStartError(text.microphoneUnsupported);
      return;
    }

    let mediaRequest: Promise<MediaStream>;
    try {
      mediaRequest = navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      void screenWakeLockRef.current?.start();
    } catch {
      callStartGuardRef.current = false;
      void screenWakeLockRef.current?.stop();
      setStartError(text.microphoneUnavailable);
      return;
    }

    endingCallRef.current = false;
    transcriptWritesRef.current = Promise.resolve();
    setIsStarting(true);
    setCallStatus('connecting');
    setIsAssistantSpeaking(false);
    setActiveTutorProfiles([]);
    setActiveBundleCarousel(null);
    setStartError(null);

    try {
      const localStream = await mediaRequest;
      if (!isCurrentCall()) {
        localStream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = localStream;
      const createdSession = await createVoiceSession({
        locale,
        timeZone: detectBrowserTimeZone(),
        consentVersion: config.consentVersion,
        ...(trimmedPhone ? { phone: trimmedPhone } : {}),
        ...(identityProof ? { identityProof } : {}),
      });

      if (!isCurrentCall()) {
        await endVoiceSession(createdSession, 'user_ended');
        return;
      }
      activeSessionRef.current = createdSession;

      if (trimmedMemberId) {
        let accountCheck;
        try {
          accountCheck = await checkVoiceAccount(
            createdSession,
            trimmedMemberId,
          );
        } finally {
          // Member IDs are needed only for this request and are never retained
          // in browser state once verification has been attempted.
          setMemberId('');
        }
        if (accountCheck.accountStatus !== 'verified') {
          throw new PublicApiError(
            accountCheck.accountStatus === 'not_registered'
              ? text.accountCredentialsInvalid
              : text.accountVerificationUnavailable,
            401,
            accountCheck.accountStatus === 'not_registered'
              ? 'ACCOUNT_CREDENTIALS_INVALID'
              : 'ACCOUNT_VERIFICATION_UNAVAILABLE',
          );
        }
      }

      const connectAbort = new AbortController();
      connectAbortRef.current = connectAbort;
      await connectRealtimeVoice({
        localStream,
        session: createdSession,
        signal: connectAbort.signal,
        useElevenLabsTts: locale === 'ar-SA',
        onPeerConnection: (connection) => {
          if (!isCurrentCall()) {
            connection.close();
            return;
          }
          peerConnectionRef.current = connection;
          connection.addEventListener('connectionstatechange', () => {
            if (connection.connectionState === 'failed' && isCurrentCall()) {
              void finishCall('connection_lost', callGeneration);
            }
          });
        },
        onReady: async () => {
          if (!isCurrentCall()) {
            return;
          }
          callTimerRef.current = window.setTimeout(
            () => void finishCall('duration_limit', callGeneration),
            createdSession.maxDurationSec * 1000,
          );
          setCallStatus('connected');
          setIsStarting(false);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        },
        onRemoteClosed: () => {
          if (isCurrentCall()) {
            void finishCall('call_ended_by_server', callGeneration);
          }
        },
        onRemoteStream: (stream) => {
          if (isCurrentCall()) {
            remoteStreamRef.current = stream;
            setRemoteStream(stream);
          } else {
            stream.getTracks().forEach((track) => track.stop());
          }
        },
        onTranscript: (entry) => {
          if (!isCurrentCall()) {
            return Promise.resolve();
          }
          const write = transcriptWritesRef.current.then(() =>
            saveVoiceTranscriptEntry(createdSession, entry),
          );
          // A failed write must not poison all later transcript writes.
          transcriptWritesRef.current = write.catch(() => undefined);
          return write;
        },
        onTranscriptError: () => {
          if (!isCurrentCall()) return;
          setStartError(text.transcriptSaveError);
        },
        onAssistantText: (entry, signal) => {
          if (!isCurrentCall()) return Promise.resolve();
          return playSaudiArabicSpeech(createdSession, entry.text, signal);
        },
        onSpeechError: () => {
          if (isCurrentCall()) {
            setStartError(text.voiceServiceUnavailable);
            void finishCall('speech_synthesis_failed', callGeneration);
          }
        },
        onTutorProfiles: (profiles) => {
          if (!isCurrentCall()) return;
          if (tutorCarouselTimerRef.current !== null) {
            window.clearTimeout(tutorCarouselTimerRef.current);
          }
          setActiveBundleCarousel(null);
          setActiveTutorProfiles(profiles);
          setTutorProfilesRevision((revision) => revision + 1);
          tutorCarouselTimerRef.current = window.setTimeout(() => {
            if (isCurrentCall()) setActiveTutorProfiles([]);
            tutorCarouselTimerRef.current = null;
          }, 20_000);
        },
        onCallerSpeechStarted: () => {
          if (isCurrentCall()) setActiveTutorProfiles([]);
        },
        onBundleCarousel: (carousel) => {
          if (!isCurrentCall()) return;
          setActiveTutorProfiles([]);
          setActiveBundleCarousel(carousel);
        },
      });

      if (!isCurrentCall()) {
        return;
      }
      setCallStatus('connected');
    } catch (error) {
      if (callGeneration !== callGenerationRef.current) {
        return;
      }
      releaseCallResources(callGeneration);
      const activeSession = activeSessionRef.current;
      activeSessionRef.current = null;
      setCallStatus(null);
      if (!endingCallRef.current) {
        if (activeSession) {
          try {
            await endVoiceSession(activeSession, 'connection_failed');
          } catch {
            setStartError(text.sessionEndError);
          }
        }
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          setStartError(text.microphonePermissionDenied);
        } else if (
          error instanceof DOMException &&
          error.name === 'NotFoundError'
        ) {
          setStartError(text.microphoneUnavailable);
        } else if (
          error instanceof PublicApiError &&
          error.code === 'ACCOUNT_CREDENTIALS_INVALID'
        ) {
          setStartError(text.accountCredentialsInvalid);
        } else if (
          error instanceof PublicApiError &&
          error.code === 'ACCOUNT_VERIFICATION_UNAVAILABLE'
        ) {
          setStartError(text.accountVerificationUnavailable);
        } else if (error instanceof PublicApiError && error.status === 503) {
          setStartError(text.voiceServiceUnavailable);
        } else {
          setStartError(text.callConnectionError);
        }
      }
    } finally {
      if (callGeneration === callGenerationRef.current) {
        setIsStarting(false);
      }
    }
  }

  function toggleMute() {
    const nextMuted = !isMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  }

  const tutorProfilesKey = `${tutorProfilesRevision}:${JSON.stringify(activeTutorProfiles)}`;

  return (
    <div
      className={`ap-voice-page${callStatus ? ' ap-voice-page--in-call' : ''}`}
      dir={direction}
      lang={locale}
    >
      <audio
        aria-hidden="true"
        hidden
        key={callGenerationKey}
        ref={arabicAudioRef}
      />
      <header className="ap-public-header">
        <div className="ap-brand">
          <img
            alt={text.brandName}
            className="ap-brand__logo"
            src={BRAND_LOGO_SRC}
          />
        </div>
        <AP_LanguageSwitch
          disabled={isStarting || callStatus !== null}
          languageNames={{
            'ar-SA': text.languageArabic,
            en: text.languageEnglish,
            fr: text.languageFrench,
          }}
          label={text.languagePickerLabel}
          locale={locale}
          onLocaleChange={setLocale}
        />
      </header>

      <main className="ap-public-main" id="home">
        <section aria-labelledby="ap-hero-heading" className="ap-hero-card">
          {isStarting && (
            <AP_LoadingIndicator
              label={text.startingSession}
              variant="overlay"
            />
          )}
          <div className="ap-hero-copy">
            <p className="ap-eyebrow" id="ap-hero-eyebrow">
              <span aria-hidden="true" className="ap-eyebrow__dot" />
              {text.eyebrow}
            </p>
            <h1 id="ap-hero-heading">{text.heading}</h1>
            <p className="ap-hero-description">{text.description}</p>
            {configError ? (
              <div className="ap-public-config-error" role="alert">
                <p>{text.configLoadError}</p>
                <button
                  className="ap-consent-step__submit"
                  onClick={() => {
                    setConfig(null);
                    setConfigError(false);
                    setConfigAttempt((attempt) => attempt + 1);
                  }}
                  type="button"
                >
                  {text.retry}
                </button>
              </div>
            ) : !config ? (
              <AP_LoadingIndicator
                label={text.configLoading}
                variant="section"
              />
            ) : callStatus ? null : (
              <>
                <p>
                  {
                    {
                      en: 'Enter both your phone number and member ID for account services, or leave both empty for public TutWithUs information only.',
                      fr: 'Saisissez votre numéro de téléphone et votre identifiant membre pour les services du compte, ou laissez les deux champs vides pour accéder uniquement aux informations publiques TutWithUs.',
                      'ar-SA':
                        'أدخل رقم الهاتف ومعرّف العضو معًا لخدمات الحساب، أو اترك الحقلين فارغين للحصول على معلومات TutWithUs العامة فقط.',
                    }[locale]
                  }
                </p>
                <AP_ConsentStep
                  acknowledgeLabel={text.acknowledgeConsent}
                  acknowledged={acknowledged}
                  consentText={config.consentText[locale]}
                  phone={phone}
                  phoneLabel={text.accountCheckPhoneLabel}
                  memberId={memberId}
                  memberIdLabel={text.accountCheckMemberIdLabel}
                  error={startError}
                  heading={text.consentHeading}
                  isStarting={isStarting}
                  onAcknowledgeChange={setAcknowledged}
                  onStart={handleStart}
                  onPhoneChange={setPhone}
                  onMemberIdChange={setMemberId}
                  startLabel={text.startWithConsent}
                />
              </>
            )}
          </div>

          <aside className="ap-hero-art">
            <div
              aria-label={orbLabel}
              className="ap-sound-orb"
              data-has-bundle={activeBundleCarousel ? 'true' : undefined}
              data-state={orbState}
              ref={orbRef}
              role={activeBundleCarousel ? 'group' : 'img'}
            >
              <AP_VoiceOrbCanvas state={orbState} />
              {activeTutorProfiles.length > 0 && !isMobileLayout && (
                <AP_TutorCarousel
                  key={tutorProfilesKey}
                  profiles={activeTutorProfiles}
                  onImageError={(fullName) =>
                    setActiveTutorProfiles((current) =>
                      current.filter(
                        (profile) => profile.fullName !== fullName,
                      ),
                    )
                  }
                />
              )}
              {activeBundleCarousel && (
                <AP_BundleCarousel
                  carousel={activeBundleCarousel}
                  key={`${activeBundleCarousel.activeFamilyId}:${activeBundleCarousel.subjectName}`}
                  locale={locale}
                  variant="orb"
                />
              )}
            </div>
          </aside>
        </section>
        {callStatus && (
          <div className="ap-mobile-call-overlay">
            <section
              aria-label={orbLabel}
              aria-modal={isMobileLayout}
              className="ap-mobile-call-overlay__panel"
              data-state={orbState}
              role="dialog"
            >
              <div
                aria-hidden={activeBundleCarousel ? undefined : true}
                className="ap-mobile-call-overlay__orb ap-sound-orb"
                data-has-bundle={activeBundleCarousel ? 'true' : undefined}
                data-state={orbState}
                ref={mobileOrbRef}
              >
                <AP_VoiceOrbCanvas state={orbState} />
                {activeTutorProfiles.length > 0 && (
                  <AP_TutorCarousel
                    key={tutorProfilesKey}
                    profiles={activeTutorProfiles}
                    onImageError={(fullName) =>
                      setActiveTutorProfiles((current) =>
                        current.filter(
                          (profile) => profile.fullName !== fullName,
                        ),
                      )
                    }
                  />
                )}
                {activeBundleCarousel && (
                  <AP_BundleCarousel
                    carousel={activeBundleCarousel}
                    key={`${activeBundleCarousel.activeFamilyId}:${activeBundleCarousel.subjectName}:mobile`}
                    locale={locale}
                    variant="orb"
                  />
                )}
              </div>
              <AP_VoiceCall
                assistantSpeakingLabel={text.callSpeaking}
                connectedLabel={text.callConnected}
                connectingLabel={text.callConnecting}
                endLabel={text.endCall}
                muteLabel={text.muteMicrophone}
                muted={isMuted}
                onEndCall={() => void finishCall('user_ended')}
                onLevelChange={handleLevelChange}
                onSpeakingChange={setIsAssistantSpeaking}
                onToggleMute={toggleMute}
                remoteStream={remoteStream}
                status={callStatus}
                unmuteLabel={text.unmuteMicrophone}
              />
            </section>
          </div>
        )}
        <p className="ap-trust-line">
          <span aria-hidden="true">🔒</span>
          {text.privacyDescription}
        </p>
      </main>
    </div>
  );
}
