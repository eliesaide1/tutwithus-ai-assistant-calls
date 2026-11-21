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
const availabilityPreferenceKeys = [
  'levelId',
  'subjectId',
  'tutorPreference',
  'tutorId',
  'preferredDays',
  'timeZone',
  'fromDate',
  'toDate',
  'preferredTimeFrom',
  'preferredTimeTo',
  'curriculum',
] as const;
const fingerprint = (value: Selection) =>
  JSON.stringify(slotKeys.map((key) => value[key] ?? null));
const record = (value: unknown): Selection | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Selection)
    : undefined;
const selectionIndex = (transcript: string): number | undefined => {
  let normalized = transcript
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  normalized = normalized.replace(
    /^(?:i (?:want|choose|select|take)|i ll take|i will take|i d like|je (?:prends|choisis|veux)|(?:أختار|اختار|أبغى|ابغى|أبي|ابي|باخذ))\s+/u,
    '',
  );
  normalized = normalized.replace(
    /^(?:the|le|la|option|number|numéro|رقم|الخيار|الموعد)\s+/u,
    '',
  );
  const first = new Set([
    'first',
    'first one',
    'first slot',
    'first option',
    '1',
    '1st',
    'premier',
    'première',
    'premier créneau',
    'première option',
    'الأول',
    'الاول',
    'الأولى',
    'الاولى',
    'أول موعد',
    'اول موعد',
    'أول خيار',
    'اول خيار',
    'واحد',
  ]);
  const second = new Set([
    'second',
    'second one',
    'second slot',
    'second option',
    '2',
    '2nd',
    'deuxième',
    'deuxieme',
    'second',
    'seconde',
    'deuxième créneau',
    'deuxieme creneau',
    'le deuxième',
    'la deuxième',
    'الثاني',
    'الثانية',
    'التاني',
    'التانية',
    'الموعد الثاني',
    'الموعد الثانية',
    'الخيار الثاني',
    'الخيار الثانية',
    'اثنين',
    'اثنان',
  ]);
  if (first.has(normalized)) return 0;
  if (second.has(normalized)) return 1;
  return undefined;
};

// Only actual caller transcript events can confirm an offer. Tool arguments
// cannot assert consent. Each offer expires and is consumed before submission.
export class BookingConfirmation {
  private readonly sessions = new Map<
    string,
    {
      expires: number;
      revision: number;
      preferences: Selection;
      selections: Selection[];
      selected?: Selection;
      pending?: string;
      pendingSelection?: Selection;
      pendingDescription?: string;
      defaultDescription?: string;
      confirmed: boolean;
    }
  >();

  revision(sessionId: string): number {
    this.prune();
    return this.sessions.get(sessionId)?.revision ?? 0;
  }

  mergeAvailabilityPreferences(sessionId: string, args: Selection): Selection {
    this.prune();
    const preferences = this.sessions.get(sessionId)?.preferences;
    if (!preferences) return args;
    return {
      ...Object.fromEntries(
        availabilityPreferenceKeys.flatMap((key) =>
          preferences[key] === undefined ? [] : [[key, preferences[key]]],
        ),
      ),
      ...args,
    };
  }

  remember(
    sessionId: string,
    args: Selection,
    output: unknown,
    expectedRevision?: number,
  ) {
    this.prune();
    const existing = this.sessions.get(sessionId);
    if (
      expectedRevision !== undefined &&
      (existing?.revision ?? 0) !== expectedRevision
    ) {
      return;
    }
    const result = record(output);
    const tutor = record(result?.tutor);
    const subjectName =
      typeof result?.subjectName === 'string'
        ? result.subjectName
        : typeof args.subjectName === 'string'
          ? args.subjectName
          : undefined;
    const previousSubjectName = existing?.preferences.subjectName;
    const subjectChanged =
      typeof subjectName === 'string' &&
      typeof previousSubjectName === 'string' &&
      subjectName.normalize('NFKC').toLocaleLowerCase() !==
        previousSubjectName.normalize('NFKC').toLocaleLowerCase();
    const state = existing ?? {
      expires: Date.now() + 5 * 60_000,
      revision: 0,
      preferences: {},
      selections: [],
      confirmed: false,
    };
    if (subjectChanged) {
      state.preferences = {};
    }
    for (const key of availabilityPreferenceKeys) {
      if (args[key] === null) {
        delete state.preferences[key];
      } else if (args[key] !== undefined) {
        state.preferences[key] = args[key];
      }
    }
    if (subjectName) state.preferences.subjectName = subjectName;
    for (const key of ['subjectId', 'levelId'] as const) {
      const value = result?.[key];
      if (typeof value === 'string') state.preferences[key] = value;
    }
    if (typeof result?.timeZone === 'string') {
      state.preferences.timeZone = result.timeZone;
    }
    state.expires = Date.now() + 5 * 60_000;
    state.selections =
      result?.status === 'available' && Array.isArray(result.slots) && tutor
        ? result.slots.flatMap((slot) => {
            const value = record(slot);
            if (!value) return [];
            return [
              Object.fromEntries(
                Object.entries({
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
                }).filter(
                  ([key, entry]) =>
                    (slotKeys as readonly string[]).includes(key) &&
                    entry !== undefined &&
                    entry !== null,
                ),
              ),
            ];
          })
        : [];
    state.selected = undefined;
    state.pending = undefined;
    state.pendingSelection = undefined;
    state.pendingDescription = undefined;
    state.defaultDescription =
      subjectName && typeof tutor?.name === 'string'
        ? `${subjectName} session with ${tutor.name}`
        : undefined;
    state.confirmed = false;
    this.sessions.set(sessionId, state);
  }

  prepare(sessionId: string, args: Selection): string | undefined {
    this.prune();
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    const selection =
      state.selected ??
      state.selections.find(
        (option) => fingerprint(option) === fingerprint(args),
      );
    if (!selection) return undefined;
    const suppliedDescription =
      typeof args.description === 'string' ? args.description.trim() : '';
    const description = suppliedDescription || state.defaultDescription;
    if (!description || description.length < 3 || description.length > 500) {
      return undefined;
    }
    state.pending = fingerprint(selection);
    state.pendingSelection = selection;
    state.pendingDescription = description;
    state.confirmed = false;
    return description;
  }

  observe(sessionId: string, transcript: string) {
    this.prune();
    const state = this.sessions.get(sessionId) ?? {
      expires: Date.now() + 5 * 60_000,
      revision: 0,
      preferences: {},
      selections: [],
      confirmed: false,
    };
    state.revision += 1;
    state.expires = Date.now() + 5 * 60_000;
    this.sessions.set(sessionId, state);
    if (!state.pending) {
      const index = selectionIndex(transcript);
      if (index !== undefined) state.selected = state.selections[index];
      return;
    }
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
    if (!state.confirmed) {
      state.pending = undefined;
      state.pendingSelection = undefined;
      state.pendingDescription = undefined;
      state.selected = undefined;
    }
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
