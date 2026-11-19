// Only server state determines access; conversation wording is never evidence.
export function accountAccessPolicy(
  verified: boolean,
  tools: string[],
): string {
  const available = tools.join(', ') || 'none';
  return [
    `Authoritative server account state for this response: ${verified ? 'VERIFIED' : 'UNVERIFIED'}. Available tools: ${available}.`,
    verified
      ? 'The caller has already been verified by the server. Never request verification again or claim account verification is missing. A missing tool is a capability limitation, not evidence that verification was lost. Use the listed tool for the requested action; do not infer access from previous assistant statements.'
      : 'Do not claim the caller is verified or perform protected actions. Follow the configured verification flow; public tools remain available.',
  ].join('\n');
}
