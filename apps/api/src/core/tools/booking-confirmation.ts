type Selection = Record<string, unknown>;
const slotKeys = [
  'levelId',
  'subjectId',
  'tutorId',
  'date',
  'timeFrom',
  'timeTo',
  'timeZone',
  'curriculum',
] as const;
const fingerprint = (value: Selection) =>
  JSON.stringify(slotKeys.map((key) => value[key] ?? null));
const record = (value: unknown): Selection | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Selection)
    : undefined;

// Only actual caller transcript events can confirm an offer. Tool arguments
// cannot assert consent. Each offer expires and is consumed before submission.
export class BookingConfirmation {
  private readonly sessions = new Map<
    string,
    {
      expires: number;
      selections: string[];
      pending?: string;
      pendingSelection?: Selection;
      pendingDescription?: string;
      defaultDescription?: string;
      confirmed: boolean;
    }
  >();

  remember(sessionId: string, args: Selection, output: unknown) {
    const result = record(output);
    const tutor = record(result?.tutor);
    if (
      result?.status !== 'available' ||
      !Array.isArray(result.slots) ||
      !tutor
    ) {
      this.sessions.delete(sessionId);
      return;
    }
    this.prune();
    this.sessions.set(sessionId, {
      expires: Date.now() + 5 * 60_000,
      confirmed: false,
      ...(typeof result.subjectName === 'string' &&
      typeof tutor.name === 'string'
        ? {
            defaultDescription: `${result.subjectName} session with ${tutor.name}`,
          }
        : {}),
      selections: result.slots.flatMap((slot) => {
        const value = record(slot);
        return value
          ? [
              fingerprint({
                ...args,
                ...(typeof result.subjectId === 'string'
                  ? { subjectId: result.subjectId }
                  : {}),
                ...(typeof result.levelId === 'string'
                  ? { levelId: result.levelId }
                  : {}),
                ...value,
                tutorId: tutor.id,
                timeZone: result.timeZone,
              }),
            ]
          : [];
      }),
    });
  }

  prepare(sessionId: string, args: Selection): string | undefined {
    this.prune();
    const state = this.sessions.get(sessionId);
    const selection = fingerprint(args);
    if (!state?.selections.includes(selection)) return undefined;
    const suppliedDescription =
      typeof args.description === 'string' ? args.description.trim() : '';
    const description = suppliedDescription || state.defaultDescription;
    if (!description || description.length < 3 || description.length > 500) {
      return undefined;
    }
    state.pending = selection;
    state.pendingSelection = Object.fromEntries(
      slotKeys.flatMap((key) =>
        args[key] === undefined ? [] : [[key, args[key]]],
      ),
    );
    state.pendingDescription = description;
    state.confirmed = false;
    return description;
  }

  observe(sessionId: string, transcript: string) {
    this.prune();
    const state = this.sessions.get(sessionId);
    if (!state?.pending) return;
    const normalized = transcript
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    state.confirmed =
      /^(yes|yes please|yes book it|yes proceed|confirm|confirmed|confirmed proceed|please proceed|oui|oui merci|oui confirmez|je confirme|نعم|نعم احجز|نعم احجزه|أكيد|اكيد|موافق|أوافق)$/.test(
        normalized,
      );
    // Any other reply invalidates the offer, including a changed time or refusal.
    if (!state.confirmed) state.pending = undefined;
  }

  consume(sessionId: string, args: Selection): string | undefined {
    return this.consumePrepared(sessionId, args)?.description;
  }

  consumePrepared(
    sessionId: string,
    _args: Selection,
  ): { description: string; selection: Selection } | undefined {
    this.prune();
    const state = this.sessions.get(sessionId);
    if (
      !state?.confirmed ||
      !state.pendingDescription ||
      !state.pendingSelection
    ) {
      return undefined;
    }
    const description = state.pendingDescription;
    const selection = state.pendingSelection;
    this.sessions.delete(sessionId);
    return { description, selection };
  }

  clear(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  private prune() {
    for (const [key, value] of this.sessions)
      if (value.expires <= Date.now()) this.sessions.delete(key);
  }
}
