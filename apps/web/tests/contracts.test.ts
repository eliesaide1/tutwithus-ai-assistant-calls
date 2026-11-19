import { describe, expect, it } from 'vitest';
import {
  AccountCheckRequestSchema,
  AccountCheckResponseSchema,
  ApiErrorEnvelopeSchema,
  CreateBookingRequestArgumentsSchema,
  CreateVoiceSessionRequestSchema,
  EscalateToHumanArgumentsSchema,
  PublicConfigResponseSchema,
  RealtimeConnectionRequestSchema,
  RealtimeConnectionResponseSchema,
  SaveVoiceTranscriptRequestSchema,
  VoiceSessionEventSchema,
} from '@tutwithus/contracts';

describe('shared REST and realtime contracts', () => {
  it('validates account-check requests and returns only a coarse status', () => {
    expect(
      AccountCheckRequestSchema.safeParse({ memberId: 'tw-user-1001' }).success,
    ).toBe(true);
    expect(
      AccountCheckRequestSchema.safeParse({
        memberId: 'tw-user-1001',
        phone: '+966500000001',
      }).success,
    ).toBe(false);
    expect(
      AccountCheckResponseSchema.safeParse({
        status: 'submitted',
        accountStatus: 'verified',
      }).success,
    ).toBe(true);
    expect(
      AccountCheckResponseSchema.safeParse({
        status: 'submitted',
        accountStatus: 'verified',
        customerId: 'customer-1',
      }).success,
    ).toBe(false);
  });

  it('accepts a complete public config and rejects stale-shaped values', () => {
    const config = {
      languages: ['ar-SA', 'en', 'fr'],
      consentVersion: '2026-11-03.1',
      consentText: {
        'ar-SA': 'Arabic consent',
        en: 'English consent',
        fr: 'French consent',
      },
      maxCallSec: 300,
    };

    expect(PublicConfigResponseSchema.safeParse(config).success).toBe(true);
    expect(
      PublicConfigResponseSchema.safeParse({
        ...config,
        consentVersion: 'invalid',
      }).success,
    ).toBe(false);
    expect(
      PublicConfigResponseSchema.safeParse({
        ...config,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it('requires accepted consent and rejects removed transcript preference fields', () => {
    const request = {
      locale: 'en',
      consentVersion: '2026-11-03.1',
      consentAccepted: true,
    };

    expect(CreateVoiceSessionRequestSchema.safeParse(request).success).toBe(
      true,
    );
    expect(
      CreateVoiceSessionRequestSchema.safeParse({
        locale: 'en',
        consentVersion: '2026-11-03.1',
        consentAccepted: false,
      }).success,
    ).toBe(false);
    expect(
      CreateVoiceSessionRequestSchema.safeParse({
        ...request,
        transcriptOptIn: false,
      }).success,
    ).toBe(false);
  });

  it('validates bounded transcript entries', () => {
    expect(
      SaveVoiceTranscriptRequestSchema.safeParse({
        eventId: 'user:item-1',
        speaker: 'user',
        text: 'Hello',
      }).success,
    ).toBe(true);
    expect(
      SaveVoiceTranscriptRequestSchema.safeParse({
        eventId: '',
        speaker: 'system',
        text: 'Hello',
      }).success,
    ).toBe(false);
  });

  it('validates bounded SDP offers and provider answers', () => {
    expect(
      RealtimeConnectionRequestSchema.safeParse({ sdp: 'v=0' }).success,
    ).toBe(true);
    expect(
      RealtimeConnectionRequestSchema.safeParse({ sdp: '  ' }).success,
    ).toBe(false);
    expect(
      RealtimeConnectionResponseSchema.safeParse({
        sdp: 'v=0',
        greeting: 'Welcome',
      }).success,
    ).toBe(true);
    expect(
      RealtimeConnectionResponseSchema.safeParse({
        sdp: 'v=0',
        greeting: '',
      }).success,
    ).toBe(false);
  });

  it('validates known UI events while leaving provider events unpinned', () => {
    expect(
      VoiceSessionEventSchema.safeParse({
        type: 'ui.citations',
        citations: [{ sourceId: 'source-1', title: 'Bootcamp FAQ' }],
      }).success,
    ).toBe(true);
    expect(
      VoiceSessionEventSchema.safeParse({
        type: 'provider.event-name-not-yet-verified',
      }).success,
    ).toBe(false);
  });

  it('requires explicit contact consent and rejects model-supplied callback numbers', () => {
    const escalation = {
      reason: 'user_requested',
      summary: 'Caller requested a person.',
      contactConsent: false,
    };

    expect(EscalateToHumanArgumentsSchema.safeParse(escalation).success).toBe(
      false,
    );
    expect(
      EscalateToHumanArgumentsSchema.safeParse({
        ...escalation,
        contactConsent: true,
      }).success,
    ).toBe(true);
    expect(
      EscalateToHumanArgumentsSchema.safeParse({
        ...escalation,
        contactConsent: true,
        contactPhone: '+966500000000',
      }).success,
    ).toBe(false);
    expect(
      EscalateToHumanArgumentsSchema.safeParse({
        ...escalation,
        contactConsent: true,
        contactPhone: 'not a phone number',
      }).success,
    ).toBe(false);
    expect(
      CreateBookingRequestArgumentsSchema.safeParse({
        subject: 'Mathematics',
        level: 'Secondary',
        preferredTimes: ['Sunday afternoon'],
        timezone: 'Asia/Riyadh',
        contactName: 'Caller',
        contactPhone: '+966500000000',
      }).success,
    ).toBe(true);
    expect(
      CreateBookingRequestArgumentsSchema.safeParse({
        subject: 'Mathematics',
        level: 'Secondary',
        preferredTimes: ['Sunday afternoon'],
        timezone: 'Asia/Riyadh',
        contactName: 'Caller',
      }).success,
    ).toBe(false);
    expect(
      ApiErrorEnvelopeSchema.safeParse({
        error: {
          code: 'CONSENT_REQUIRED',
          message: 'Consent is required.',
          requestId: 'request-1',
        },
      }).success,
    ).toBe(true);
  });
});
