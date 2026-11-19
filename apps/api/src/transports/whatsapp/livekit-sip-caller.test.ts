import { describe, expect, it } from 'vitest';
import { getTrustedWhatsAppCallerNumber } from './livekit-sip-caller.js';

const sipParticipantKind = 3;
const trunkId = 'whatsapp-inbound-trunk';

describe('getTrustedWhatsAppCallerNumber', () => {
  it('returns the E.164 caller number from the configured SIP trunk', () => {
    expect(
      getTrustedWhatsAppCallerNumber(
        {
          kind: sipParticipantKind,
          attributes: {
            'sip.trunkID': trunkId,
            'sip.phoneNumber': '+966501234567',
          },
        },
        sipParticipantKind,
        trunkId,
      ),
    ).toBe('+966501234567');
  });

  it('rejects callers that did not join as SIP participants', () => {
    expect(
      getTrustedWhatsAppCallerNumber(
        {
          kind: 1,
          attributes: {
            'sip.trunkID': trunkId,
            'sip.phoneNumber': '+966501234567',
          },
        },
        sipParticipantKind,
        trunkId,
      ),
    ).toBeUndefined();
  });

  it('rejects SIP participants from an unconfigured trunk', () => {
    expect(
      getTrustedWhatsAppCallerNumber(
        {
          kind: sipParticipantKind,
          attributes: {
            'sip.trunkID': 'another-trunk',
            'sip.phoneNumber': '+966501234567',
          },
        },
        sipParticipantKind,
        trunkId,
      ),
    ).toBeUndefined();
  });

  it('rejects missing or malformed caller numbers', () => {
    for (const phoneNumber of [
      undefined,
      '0501234567',
      '+01234',
      '+1234567890123456',
    ]) {
      expect(
        getTrustedWhatsAppCallerNumber(
          {
            kind: sipParticipantKind,
            attributes: {
              'sip.trunkID': trunkId,
              'sip.phoneNumber': phoneNumber,
            },
          },
          sipParticipantKind,
          trunkId,
        ),
      ).toBeUndefined();
    }
  });

  it('fails closed until the expected SIP trunk is configured', () => {
    expect(
      getTrustedWhatsAppCallerNumber(
        {
          kind: sipParticipantKind,
          attributes: {
            'sip.trunkID': trunkId,
            'sip.phoneNumber': '+966501234567',
          },
        },
        sipParticipantKind,
        undefined,
      ),
    ).toBeUndefined();
  });
});
