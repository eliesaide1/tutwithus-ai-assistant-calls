type RecordValue = Record<string, unknown>;
const asRecord = (value: unknown): RecordValue | undefined =>
  typeof value === 'object' && value !== null
    ? (value as RecordValue)
    : undefined;

export class CancellationConfirmation {
  private readonly sessions = new Map<
    string,
    { expires: number; ids: Set<string>; pending?: string; confirmed: boolean }
  >();

  remember(sessionId: string, output: unknown) {
    const result = asRecord(output);
    if (result?.status !== 'available' || !Array.isArray(result.courses))
      return void this.sessions.delete(sessionId);
    const ids = new Set(
      result.courses.flatMap((item) => {
        const id = asRecord(item)?.id;
        return typeof id === 'string' && id ? [id] : [];
      }),
    );
    const onlyCourseId = ids.size === 1 ? [...ids][0] : undefined;
    this.sessions.set(sessionId, {
      expires: Date.now() + 5 * 60_000,
      ids,
      ...(onlyCourseId ? { pending: onlyCourseId } : {}),
      confirmed: false,
    });
  }

  prepare(sessionId: string, courseId: string): boolean {
    this.prune();
    const state = this.sessions.get(sessionId);
    if (!state?.ids.has(courseId) || state.ids.size < 2) return false;
    state.pending = courseId;
    state.confirmed = false;
    return true;
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
      /^(yes|yes please|yes confirm|yes confirmed|yes cancel it|yes confirm cancellation|confirm|confirm cancellation|confirmed|confirmed cancel it|confirmed cancellation|cancel it|oui|oui confirmez|oui annulez|je confirme|نعم|نعم أكد|نعم اكد|نعم ألغها|نعم الغها|أكد الإلغاء|اكد الالغاء|أكيد|اكيد|أوافق|اوافق)$/.test(
        normalized,
      );
    if (!state.confirmed) state.pending = undefined;
  }

  consume(sessionId: string, courseId: string): boolean {
    return this.consumePrepared(sessionId, courseId) !== undefined;
  }

  consumePrepared(sessionId: string, _courseId: string): string | undefined {
    this.prune();
    const state = this.sessions.get(sessionId);
    if (!state?.confirmed || !state.pending) return undefined;
    const courseId = state.pending;
    this.sessions.delete(sessionId);
    return courseId;
  }

  hasConfirmed(sessionId: string): boolean {
    this.prune();
    return this.sessions.get(sessionId)?.confirmed === true;
  }

  confirmPending(sessionId: string): boolean {
    this.prune();
    const state = this.sessions.get(sessionId);
    if (!state?.pending) return false;
    state.confirmed = true;
    return true;
  }

  private prune() {
    for (const [id, state] of this.sessions)
      if (state.expires <= Date.now()) this.sessions.delete(id);
  }
}
