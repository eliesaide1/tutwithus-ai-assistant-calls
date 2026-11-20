import {
  connectVoiceSession,
  type CreateVoiceSessionResponse,
} from '../../shared/public-api';
import type { VoiceTranscriptEntry } from '@tutwithus/contracts';

type RealtimeConnectionOptions = {
  localStream: MediaStream;
  session: CreateVoiceSessionResponse;
  signal: AbortSignal;
  onPeerConnection: (connection: RTCPeerConnection) => void;
  onReady?: () => void | Promise<void>;
  onRemoteStream: (stream: MediaStream) => void;
  onTranscript: (entry: VoiceTranscriptEntry) => Promise<void>;
  onTranscriptError: (error: unknown) => void;
  onTutorProfile?: (profile: TutorProfileDisplay) => void;
  onTutorProfiles?: (profiles: TutorProfileDisplay[]) => void;
  onCallerSpeechStarted?: () => void;
  onBundleCarousel?: (carousel: BundleCarouselDisplay) => void;
  // The server hung up (call limit, idle, goodbye) or the channel dropped.
  onRemoteClosed?: () => void;
};

export type TutorProfileDisplay = {
  fullName: string;
  profilePic: string;
};

export type BundleEditionDisplay = {
  id: string;
  name: string;
  sessions: number;
  totalPrice: number;
  pricePerSession: number;
  currency: 'SAR';
};

export type BundleFamilyDisplay = {
  id: string;
  name: string;
  deliveryMode: 'one_to_one' | 'group';
  editions: BundleEditionDisplay[];
};

export type BundleCarouselDisplay = {
  subjectName: string;
  activeFamilyId: string;
  families: BundleFamilyDisplay[];
};

const ICE_GATHERING_TIMEOUT_MS = 10_000;
const SESSION_START_TIMEOUT_MS = 15_000;
const OPENING_GREETING_TIMEOUT_MS = 10_000;

export async function connectRealtimeVoice({
  localStream,
  session,
  signal,
  onPeerConnection,
  onReady,
  onRemoteStream,
  onTranscript,
  onTranscriptError,
  onTutorProfile,
  onTutorProfiles,
  onCallerSpeechStarted,
  onBundleCarousel,
  onRemoteClosed,
}: RealtimeConnectionOptions): Promise<RTCPeerConnection> {
  const peer = new RTCPeerConnection();
  onPeerConnection(peer);

  const remoteStream = new MediaStream();
  const events = peer.createDataChannel('oai-events');
  const callerAudioTracks = localStream.getAudioTracks();
  // Keep caller audio out of the Realtime session until the one configured
  // opening greeting finishes. Otherwise early speech or room noise can create
  // an automatic response while the app is also requesting the greeting.
  callerAudioTracks.forEach((track) => {
    track.enabled = false;
  });
  let openingGreetingPending = true;
  let openingGreetingRequested = false;
  let openingGreetingResponseId: string | undefined;
  let openingGreetingTimeout: number | undefined;
  const enableCallerAudio = () => {
    if (!openingGreetingPending) return;
    openingGreetingPending = false;
    if (openingGreetingTimeout !== undefined) {
      window.clearTimeout(openingGreetingTimeout);
      openingGreetingTimeout = undefined;
    }
    callerAudioTracks.forEach((track) => {
      track.enabled = true;
    });
  };
  let transcriptQueue = Promise.resolve();
  let transcriptFailureReported = false;
  let sensitiveInputExpected = false;
  const memberVerificationCallIds = new Set<string>();
  const toolRoutingResponseIds = new Set<string>();
  let pendingTutorProfiles: TutorProfileDisplay[] = [];
  let assistantTranscriptBuffer = '';
  const displayedTutorNames = new Set<string>();
  const showMentionedTutors = (text: string) => {
    assistantTranscriptBuffer += ` ${text}`;
    const normalizedTranscript = ` ${normalizeTutorMention(
      assistantTranscriptBuffer,
    )} `;
    let changed = false;
    for (const profile of pendingTutorProfiles) {
      const key = normalizeTutorMention(profile.fullName);
      if (
        key &&
        !displayedTutorNames.has(key) &&
        normalizedTranscript.includes(` ${key} `)
      ) {
        displayedTutorNames.add(key);
        onTutorProfile?.(profile);
        changed = true;
      }
    }
    if (changed) {
      onTutorProfiles?.(
        pendingTutorProfiles.filter((profile) =>
          displayedTutorNames.has(normalizeTutorMention(profile.fullName)),
        ),
      );
    }
  };
  events.addEventListener('message', (event: MessageEvent<string>) => {
    const parsedEvent = parseRealtimeEvent(event.data);
    if (
      (parsedEvent?.type === 'conversation.item.created' ||
        parsedEvent?.type === 'conversation.item.added' ||
        parsedEvent?.type === 'conversation.item.done') &&
      parsedEvent.item?.type === 'function_call_output'
    ) {
      if (
        typeof parsedEvent.item.call_id === 'string' &&
        memberVerificationCallIds.delete(parsedEvent.item.call_id)
      ) {
        sensitiveInputExpected = isIncompleteMemberIdOutput(
          parsedEvent.item.output,
        );
      }
      const profiles = parseTutorProfilesFromToolOutput(
        parsedEvent.item.output,
      );
      if (profiles) {
        pendingTutorProfiles = profiles;
        assistantTranscriptBuffer = '';
        displayedTutorNames.clear();
      }
      const carousel = parseBundleCarouselFromToolOutput(
        parsedEvent.item.output,
      );
      if (carousel) onBundleCarousel?.(carousel);
      return;
    }
    if (
      parsedEvent?.type === 'response.output_audio_transcript.delta' &&
      typeof parsedEvent.delta === 'string'
    ) {
      if (
        typeof parsedEvent.response_id === 'string' &&
        toolRoutingResponseIds.has(parsedEvent.response_id)
      ) {
        return;
      }
      showMentionedTutors(parsedEvent.delta);
      return;
    }
    if (
      parsedEvent?.type === 'conversation.item.input_audio_transcription.failed'
    ) {
      if (!transcriptFailureReported) {
        transcriptFailureReported = true;
        onTranscriptError(
          new Error('The caller audio could not be transcribed.'),
        );
      }
      return;
    }
    if (
      parsedEvent?.type === 'response.function_call_arguments.done' &&
      parsedEvent.name === 'request_member_id'
    ) {
      sensitiveInputExpected = true;
      return;
    }
    if (
      parsedEvent?.type === 'response.function_call_arguments.done' &&
      parsedEvent.name === 'verify_member_id' &&
      typeof parsedEvent.call_id === 'string'
    ) {
      memberVerificationCallIds.add(parsedEvent.call_id);
      return;
    }

    // The caller started talking: stop the agent's spoken reply at once.
    if (parsedEvent?.type === 'input_audio_buffer.speech_started') {
      onCallerSpeechStarted?.();
      return;
    }
    if (
      parsedEvent?.type === 'response.created' &&
      typeof parsedEvent.response?.id === 'string'
    ) {
      if (
        parsedEvent.response.metadata?.tutwithus_response_kind ===
        'tool_routing'
      ) {
        toolRoutingResponseIds.add(parsedEvent.response.id);
      }
      if (openingGreetingPending) {
        openingGreetingResponseId = parsedEvent.response.id;
        return;
      }
    }
    if (parsedEvent?.type === 'response.done') {
      const response = parsedEvent.response;
      if (
        openingGreetingPending &&
        (!openingGreetingResponseId ||
          response?.id === openingGreetingResponseId)
      ) {
        enableCallerAudio();
      }
      assistantTranscriptBuffer = '';
      displayedTutorNames.clear();
      if (typeof response?.id === 'string') {
        toolRoutingResponseIds.delete(response.id);
      }
      return;
    }

    if (
      typeof parsedEvent?.response_id === 'string' &&
      toolRoutingResponseIds.has(parsedEvent.response_id) &&
      (parsedEvent.type === 'response.output_text.done' ||
        parsedEvent.type === 'response.output_audio_transcript.done')
    ) {
      return;
    }

    const entry = parseRealtimeTranscriptEvent(event.data);
    if (!entry || signal.aborted) {
      return;
    }
    if (entry.speaker === 'assistant') {
      showMentionedTutors(entry.text);
    }
    if (entry.speaker === 'user' && sensitiveInputExpected) {
      return;
    }
    transcriptQueue = transcriptQueue
      .then(() => onTranscript(entry))
      .catch((error: unknown) => {
        if (!transcriptFailureReported) {
          transcriptFailureReported = true;
          onTranscriptError(error);
        }
      });
  });
  peer.addEventListener('track', (event) => {
    const stream = event.streams[0];
    if (stream) {
      onRemoteStream(stream);
      return;
    }
    if (
      !remoteStream.getTracks().some((track) => track.id === event.track.id)
    ) {
      remoteStream.addTrack(event.track);
    }
    onRemoteStream(remoteStream);
  });
  callerAudioTracks.forEach((track) => {
    peer.addTrack(track, localStream);
  });

  let sessionStartWaiter: SessionStartWaiter | null = null;
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer, signal);

    const sdp = peer.localDescription?.sdp;
    if (!sdp) {
      throw new Error('The browser did not produce an SDP offer.');
    }

    const answer = await connectVoiceSession(session, sdp, signal);
    sessionStartWaiter = createSessionStartWaiter(events, signal);
    await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    await sessionStartWaiter.wait();
    events.addEventListener('close', () => onRemoteClosed?.(), { once: true });
    await onReady?.();
    // Let React commit the connected state before the greeting can produce
    // remote audio.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    // The server provides the active greeting so the model has one exact
    // opening response instead of improvising from its general instructions.
    if (events.readyState === 'open' && !openingGreetingRequested) {
      openingGreetingRequested = true;
      events.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            instructions: `Say this exact greeting once, verbatim, and say nothing else: ${JSON.stringify(answer.greeting)}. End the response immediately after the greeting, then wait silently for the caller. Do not speak formatting labels or tags.`,
            tool_choice: 'none',
          },
        }),
      );
      openingGreetingTimeout = window.setTimeout(
        enableCallerAudio,
        OPENING_GREETING_TIMEOUT_MS,
      );
    } else {
      enableCallerAudio();
    }
    return peer;
  } catch (error) {
    if (openingGreetingTimeout !== undefined) {
      window.clearTimeout(openingGreetingTimeout);
    }
    sessionStartWaiter?.cancel();
    events.close();
    peer.close();
    throw error;
  }
}

function parseRealtimeEvent(data: unknown): {
  type?: unknown;
  name?: unknown;
  call_id?: unknown;
  item_id?: unknown;
  response_id?: unknown;
  response?: {
    id?: unknown;
    status?: unknown;
    metadata?: { tutwithus_response_kind?: unknown };
  };
  transcript?: unknown;
  text?: unknown;
  delta?: unknown;
  item?: { type?: unknown; call_id?: unknown; output?: unknown };
} | null {
  if (typeof data !== 'string') {
    return null;
  }
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    return value as {
      type?: unknown;
      name?: unknown;
      call_id?: unknown;
      item_id?: unknown;
      transcript?: unknown;
      text?: unknown;
      delta?: unknown;
      item?: { type?: unknown; call_id?: unknown; output?: unknown };
    };
  } catch {
    return null;
  }
}

function isIncompleteMemberIdOutput(output: unknown): boolean {
  if (typeof output !== 'string') return false;
  try {
    const value: unknown = JSON.parse(output);
    return (
      typeof value === 'object' &&
      value !== null &&
      'error' in value &&
      value.error === 'denied' &&
      'reason' in value &&
      value.reason === 'INVALID_ARGUMENTS'
    );
  } catch {
    return false;
  }
}

function normalizeTutorMention(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function parseTutorProfilesFromToolOutput(
  output: unknown,
): TutorProfileDisplay[] | null {
  if (typeof output !== 'string') return null;
  try {
    const value: unknown = JSON.parse(output);
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const candidates: unknown[] =
      'uiTutorProfiles' in value && Array.isArray(value.uiTutorProfiles)
        ? value.uiTutorProfiles
        : 'tutor' in value &&
            typeof value.tutor === 'object' &&
            value.tutor !== null
          ? [value.tutor]
          : [];
    if (candidates.length === 0) return null;
    const profiles: TutorProfileDisplay[] = [];
    for (const profile of candidates) {
      if (
        typeof profile !== 'object' ||
        profile === null ||
        !('profilePic' in profile) ||
        typeof profile.profilePic !== 'string'
      ) {
        continue;
      }
      const fullName =
        'fullName' in profile && typeof profile.fullName === 'string'
          ? profile.fullName
          : 'name' in profile && typeof profile.name === 'string'
            ? profile.name
            : undefined;
      if (!fullName?.trim()) continue;
      try {
        const url = new URL(profile.profilePic);
        if (url.protocol !== 'https:') continue;
        profiles.push({
          fullName: fullName.trim(),
          profilePic: url.toString(),
        });
      } catch {
        continue;
      }
    }
    return profiles;
  } catch {
    return null;
  }
}

export function parseBundleCarouselFromToolOutput(
  output: unknown,
): BundleCarouselDisplay | null {
  if (typeof output !== 'string') return null;
  try {
    const value: unknown = JSON.parse(output);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('uiBundleCarousel' in value) ||
      typeof value.uiBundleCarousel !== 'object' ||
      value.uiBundleCarousel === null
    ) {
      return null;
    }
    const carousel = value.uiBundleCarousel as Record<string, unknown>;
    if (
      typeof carousel.subjectName !== 'string' ||
      !carousel.subjectName.trim() ||
      typeof carousel.activeFamilyId !== 'string' ||
      !Array.isArray(carousel.families)
    ) {
      return null;
    }
    const families: BundleFamilyDisplay[] = [];
    for (const candidate of carousel.families.slice(0, 12)) {
      if (
        typeof candidate !== 'object' ||
        candidate === null ||
        !('id' in candidate) ||
        typeof candidate.id !== 'string' ||
        !candidate.id ||
        !('name' in candidate) ||
        typeof candidate.name !== 'string' ||
        !candidate.name.trim() ||
        !('deliveryMode' in candidate) ||
        (candidate.deliveryMode !== 'one_to_one' &&
          candidate.deliveryMode !== 'group') ||
        !('editions' in candidate) ||
        !Array.isArray(candidate.editions)
      ) {
        continue;
      }
      const editions: BundleEditionDisplay[] = [];
      for (const edition of candidate.editions.slice(0, 6)) {
        if (
          typeof edition !== 'object' ||
          edition === null ||
          !('id' in edition) ||
          typeof edition.id !== 'string' ||
          !edition.id ||
          !('name' in edition) ||
          typeof edition.name !== 'string' ||
          !edition.name.trim() ||
          !('sessions' in edition) ||
          typeof edition.sessions !== 'number' ||
          !Number.isInteger(edition.sessions) ||
          edition.sessions <= 0 ||
          !('totalPrice' in edition) ||
          typeof edition.totalPrice !== 'number' ||
          !Number.isFinite(edition.totalPrice) ||
          edition.totalPrice < 0 ||
          !('pricePerSession' in edition) ||
          typeof edition.pricePerSession !== 'number' ||
          !Number.isFinite(edition.pricePerSession) ||
          edition.pricePerSession < 0 ||
          !('currency' in edition) ||
          edition.currency !== 'SAR'
        ) {
          continue;
        }
        editions.push({
          id: edition.id,
          name: edition.name.trim(),
          sessions: edition.sessions,
          totalPrice: edition.totalPrice,
          pricePerSession: edition.pricePerSession,
          currency: 'SAR',
        });
      }
      if (editions.length) {
        families.push({
          id: candidate.id,
          name: candidate.name.trim(),
          deliveryMode: candidate.deliveryMode,
          editions,
        });
      }
    }
    if (!families.length) return null;
    return {
      subjectName: carousel.subjectName.trim(),
      activeFamilyId: carousel.activeFamilyId,
      families,
    };
  } catch {
    return null;
  }
}

export function parseRealtimeTranscriptEvent(
  data: unknown,
): VoiceTranscriptEntry | null {
  return parseTranscriptEntry(parseRealtimeEvent(data));
}

function parseTranscriptEntry(
  event: ReturnType<typeof parseRealtimeEvent>,
): VoiceTranscriptEntry | null {
  if (!event || typeof event.item_id !== 'string') {
    return null;
  }

  if (event.type === 'conversation.item.input_audio_transcription.completed') {
    if (typeof event.transcript !== 'string' || !event.transcript.trim()) {
      return null;
    }
    return {
      eventId: `user:${event.item_id}`,
      speaker: 'user',
      text: event.transcript,
    };
  }
  if (
    event.type === 'response.output_audio_transcript.done' ||
    event.type === 'response.output_text.done'
  ) {
    const text =
      event.type === 'response.output_text.done'
        ? event.text
        : event.transcript;
    if (typeof text !== 'string' || !text.trim()) {
      return null;
    }
    return {
      eventId: `assistant:${event.item_id}`,
      speaker: 'assistant',
      text,
    };
  }
  return null;
}

function waitForIceGathering(
  peer: RTCPeerConnection,
  signal: AbortSignal,
): Promise<void> {
  if (peer.iceGatheringState === 'complete') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => finish(new Error('ICE candidate gathering timed out.')),
      ICE_GATHERING_TIMEOUT_MS,
    );
    const onStateChange = () => {
      if (peer.iceGatheringState === 'complete') {
        finish();
      }
    };
    const onAbort = () =>
      finish(new DOMException('Call cancelled.', 'AbortError'));
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', onStateChange);
      signal.removeEventListener('abort', onAbort);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    peer.addEventListener('icegatheringstatechange', onStateChange);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  });
}

type SessionStartWaiter = {
  wait: () => Promise<void>;
  cancel: () => void;
};

function createSessionStartWaiter(
  channel: RTCDataChannel,
  signal: AbortSignal,
): SessionStartWaiter {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: Error) => void;
  let settled = false;
  let timeout: number | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const finish = (error?: Error) => {
    if (settled) {
      return;
    }
    settled = true;
    if (timeout !== null) {
      window.clearTimeout(timeout);
    }
    channel.removeEventListener('message', onMessage);
    channel.removeEventListener('close', onClose);
    signal.removeEventListener('abort', onAbort);
    if (error) {
      rejectPromise(error);
    } else {
      resolvePromise();
    }
  };
  const onMessage = (event: MessageEvent<string>) => {
    if (typeof event.data !== 'string') {
      return;
    }
    let payload: { type?: unknown };
    try {
      payload = JSON.parse(event.data) as { type?: unknown };
    } catch {
      return;
    }
    if (payload.type === 'session.created') {
      finish();
    } else if (payload.type === 'error') {
      finish(new Error('The voice provider rejected the session.'));
    }
  };
  const onClose = () => finish(new Error('The voice connection closed.'));
  const onAbort = () =>
    finish(new DOMException('Call cancelled.', 'AbortError'));

  channel.addEventListener('message', onMessage);
  channel.addEventListener('close', onClose);
  signal.addEventListener('abort', onAbort, { once: true });

  return {
    wait: () => {
      if (!settled) {
        timeout = window.setTimeout(
          () => finish(new Error('The voice session did not start in time.')),
          SESSION_START_TIMEOUT_MS,
        );
        if (signal.aborted) {
          onAbort();
        }
      }
      return promise;
    },
    cancel: () => finish(new DOMException('Call cancelled.', 'AbortError')),
  };
}
