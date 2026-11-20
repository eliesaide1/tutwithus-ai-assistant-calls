import { forcedToolForRoute, type TurnRoute } from './turn-router.js';
import type { ToolContext } from '../tools/tool-registry.js';

export type TurnResponseContract = {
  instructions: string[];
  toolChoice: 'auto' | 'none' | { type: 'function'; name: string };
  textOnly: boolean;
};

export function turnResponseContract(input: {
  route: TurnRoute;
  subjectName?: string;
  tutorProfiles: Array<{ id: string; fullName: string }>;
  locale: ToolContext['locale'];
}): TurnResponseContract {
  const { route } = input;
  const forcedTool = forcedToolForRoute(route);
  const instructions: string[] = [];
  switch (route.kind) {
    case 'request_member_id':
      instructions.push(
        'Call request_member_id now. Do not speak the member-ID question yourself; the tool result supplies it once.',
      );
      break;
    case 'check_subject_eligibility':
      instructions.push(
        `First say one short waiting sentence tied to the course, then immediately call check_subject_eligibility once with ${input.subjectName ? `the established subjectName “${input.subjectName}”` : 'the exact course name from the caller'}. Do not mention verification, wallet details, availability, or a result before the tool returns.`,
      );
      break;
    case 'check_tutor_calendar':
      instructions.push(
        `${input.locale === 'ar-SA' ? 'Say exactly one short Saudi Arabic waiting sentence: «أكيد، أشيك لك على المواعيد المتاحة الحين.» Then immediately call check_tutor_calendar once. Do not add filler or use a gendered title for the tutor.' : 'First say one short waiting sentence tied to the requested tutor, then immediately call check_tutor_calendar once.'} Resolve names and ordinal references only against this server-preserved list: ${JSON.stringify(input.tutorProfiles)}. For one tutor, pass that exact id and fullName. For any tutor, one of them, nearest, earliest, or first available, pass every preserved tutor so the server compares the calendars. Never invent an id or mention verification.`,
      );
      break;
    case 'search_tutor_profiles':
      instructions.push(
        "Output exactly one search_tutor_profiles call using the caller's complete requested subject or topic in subjectName. Produce no text or audio before it.",
      );
      break;
    case 'unverified_tutor_calendar':
      instructions.push(
        'Say exactly: “Account details are required for this action. End the call, enter both your phone number and member ID, then start a new call.” Say nothing else.',
      );
      break;
    case 'start_course_booking':
      instructions.push(
        'Call start_course_booking once with the exact course name and only preferences the caller stated. Do not call separate eligibility, tutor, or availability tools first.',
      );
      break;
    case 'book_course':
      instructions.push(
        'Say one short waiting sentence, then immediately call book_course once using the identical server-preserved prepared selection. Do not repeat the summary or ask for confirmation again. Claim success only when the result status is booked.',
      );
      break;
    case 'cancel_course':
      instructions.push(
        'Output exactly one cancel_course call. The server supplies the preserved selected session. Do not ask for confirmation again or claim success before the result.',
      );
      break;
    case 'list_courses_for_cancellation':
      instructions.push(
        'Output exactly one get_my_courses call with scope="upcoming" and intent="cancel". Do not call cancel_course before the caller confirms the returned session.',
      );
      break;
    case 'account_lookup':
      instructions.push(
        `Call ${route.tool} once and answer only from its result. Do not discuss verification.`,
      );
      break;
    case 'recommend_course_bundle':
      instructions.push(
        `Output exactly one recommend_course_bundle call with subjectName “${input.subjectName ?? ''}”, another=false${route.levelName ? `, levelName “${route.levelName}”` : route.anyLevel ? ', anyLevel=true' : ', no levelName and anyLevel=false'}. Present returned bundles as choices without ranking them.`,
      );
      break;
    case 'none':
      break;
  }
  return {
    instructions,
    toolChoice:
      route.kind === 'unverified_tutor_calendar'
        ? 'none'
        : forcedTool
          ? { type: 'function', name: forcedTool }
          : 'auto',
    textOnly: Boolean(forcedTool),
  };
}
