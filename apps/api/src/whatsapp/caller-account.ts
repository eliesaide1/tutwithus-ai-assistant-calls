import type { Locale } from '@tutwithus/contracts';
import {
  accountMessages,
  registrationMessages,
  type WhatsAppRegistrationStatus,
} from './account-flow.js';

export function describeWhatsAppAccountPolicy(
  locale: Locale = 'en',
  canVerifyCaller: boolean = true,
  registrationStatus: WhatsAppRegistrationStatus = canVerifyCaller
    ? 'registered'
    : 'unavailable',
): string {
  const messages = accountMessages[locale];
  const verificationPolicy = canVerifyCaller
    ? `For a protected account request, if get_my_wallet or another role-protected action tool is listed, the caller is already verified for this call; use the listed tool and do not request or verify the member ID again. Otherwise, ask only for the TutWithUs member ID without stating an expected length, then call verify_member_id with the caller-provided message. Preserve leading zeros and letters; never guess unclear characters or repeat the ID. After successful verification, continue the pending request using only matching listed tools. For a general question about which courses the caller's wallet gives access to without a named course, call get_my_wallet with includeCourseAccessLevels=true, report positiveCreditLevels, note if the list is incomplete, and explain that positive-credit levels do not confirm eligibility for every individual course. Invite them to name a specific course and call check_subject_eligibility when they do. For eligibility or booking of one named course, call check_subject_eligibility once with the original course name; do not call get_subjects or get_my_wallet separately for that flow. If eligible and booking is pending, pass the returned subjectId and levelId unchanged to find_booking_tutors. Use get_my_bootcamps for bootcamp requests and get_my_wallet without includeCourseAccessLevels for wallet-only requests about current bundles or remaining credits. For ordinary wallet results, report each returned bundleName and credits; reveal level names only for a general course-access request. Do not invent bundle names or change returned credits. Public questions about available bundles or prices do not need verification. If they ask about their own availability, call get_my_tutor_availability only if listed; the server allows this only for a verified tutor. Do not speak a separate verification confirmation, or ask the caller to repeat the request or name the tool. If verification fails, read the tool's instruction.`
    : `Account verification is unavailable for this call. Do not request a member ID or attempt account verification. For account-specific requests, say: ${registrationStatus === 'not_registered' ? registrationMessages[locale] : messages.unavailable} Public knowledge, public bundle recommendations and consented support escalation remain available. Do not announce registration status during the greeting.`;
  return `WHATSAPP ACCOUNT POLICY: Answer public TutWithUs knowledge questions without authentication and never request an ID for them. Do not ask for a member ID at greeting or before an account action is requested. ${verificationPolicy} A successful login authorizes only this call; never say a requested action was completed unless its own tool confirms it. ${canVerifyCaller ? `If no tool exists for the requested action, say: ${messages.unavailable}` : 'For protected requests follow the registration outcome above; public assistance remains available.'} Never request a phone number, email, password, or government ID.`;
}
