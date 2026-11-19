export type LiveKitParticipantIdentity = {
  kind: number;
  attributes: Readonly<Record<string, string | undefined>>;
};

const E164_PHONE_NUMBER = /^\+[1-9]\d{1,14}$/;

export function getTrustedWhatsAppCallerNumber(
  participant: LiveKitParticipantIdentity,
  sipParticipantKind: number,
  configuredTrunkId: string | undefined,
): string | undefined {
  if (
    participant.kind !== sipParticipantKind ||
    !configuredTrunkId ||
    participant.attributes['sip.trunkID'] !== configuredTrunkId
  ) {
    return undefined;
  }

  const phoneNumber = participant.attributes['sip.phoneNumber']?.trim();
  return phoneNumber && E164_PHONE_NUMBER.test(phoneNumber)
    ? phoneNumber
    : undefined;
}
