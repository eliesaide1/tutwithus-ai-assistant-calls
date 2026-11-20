export type BookingStage = 'idle' | 'slots_offered' | 'awaiting_confirmation';

export class ConversationContext {
  subjectName: string | undefined;
  tutors: Array<{ id: string; fullName: string }> = [];
  pendingBundleLevel: { subjectName: string; levels: string[] } | undefined;
  bookingStage: BookingStage = 'idle';
  lastTutorCalendarDate: string | undefined;
  pendingMoreTutorDates = false;

  rememberSubject(subjectName: string | undefined): void {
    const normalized = subjectName?.trim();
    if (normalized) this.subjectName = normalized;
  }

  rememberTutors(tutors: Array<{ id: string; fullName: string }>): void {
    this.tutors = tutors;
  }

  rememberTutorCalendarDate(date: string | undefined): void {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      this.lastTutorCalendarDate = date;
    }
  }

  requireBundleLevel(subjectName: string, levels: string[]): void {
    this.subjectName = subjectName;
    this.pendingBundleLevel = { subjectName, levels };
  }

  clearBundleLevel(): void {
    this.pendingBundleLevel = undefined;
  }
}
