import { describe, expect, it } from 'vitest';
import { describeWhatsAppAccountPolicy } from './caller-account.js';

describe('describeWhatsAppAccountPolicy', () => {
  it('keeps public knowledge available without asking for an ID', () => {
    const line = describeWhatsAppAccountPolicy();

    expect(line).toContain(
      'Answer public TutWithUs knowledge questions without authentication',
    );
    expect(line).toContain('Do not ask for a member ID at greeting');
    expect(line).toContain('For a protected account request');
    expect(line).toContain('the caller is already verified for this call');
    expect(line).toContain('verify_member_id');
    expect(line).toContain(
      'After successful verification, continue the pending request using only matching listed tools.',
    );
    expect(line).toContain('get_my_bootcamps');
    expect(line).toContain(
      'get_my_wallet without includeCourseAccessLevels for wallet-only requests',
    );
    expect(line).toContain(
      'check_subject_eligibility once with the original course name',
    );
    expect(line).toContain(
      'do not call get_subjects or get_my_wallet separately for that flow',
    );
    expect(line).toContain(
      "For a general question about which courses the caller's wallet gives access to without a named course",
    );
    expect(line).toContain('positiveCreditLevels');
    expect(line).toContain(
      'positive-credit levels do not confirm eligibility for every individual course',
    );
    expect(line).toContain('report each returned bundleName and credits');
    expect(line).toContain('Do not speak a separate verification confirmation');
  });

  it('instructs the agent not to expose credentials or claim actions prematurely', () => {
    const line = describeWhatsAppAccountPolicy();

    expect(line).toContain('or repeat the ID');
    expect(line).toContain('never say a requested action was completed');
    expect(line).toContain(
      'Never request a phone number, email, password, or government ID',
    );
  });

  it('does not request an ID if the trusted caller phone is missing', () => {
    const line = describeWhatsAppAccountPolicy('en', false);

    expect(line).toContain('Account verification is unavailable');
    expect(line).toContain('Do not request a member ID');
  });

  it('continues the pending account request after verification in every locale', () => {
    for (const locale of ['en', 'fr', 'ar-SA'] as const) {
      const line = describeWhatsAppAccountPolicy(locale);

      expect(line).toContain('get_my_bootcamps');
      expect(line).toContain('get_my_wallet');
      expect(line).toContain('get_my_tutor_availability');
      expect(line).toContain('check_subject_eligibility');
      expect(line).toContain(
        'do not call get_subjects or get_my_wallet separately',
      );
      expect(line).toContain('positiveCreditLevels');
      expect(line).toContain('check_subject_eligibility');
      expect(line).toContain(
        'continue the pending request using only matching listed tools',
      );
      expect(line).not.toContain('You are a verified TutWithUs customer');
      expect(line).not.toContain('Votre compte client TutWithUs est vérifié');
      expect(line).not.toContain('تم التحقق من أنك أحد عملاء TutWithUs');
    }
  });
});
