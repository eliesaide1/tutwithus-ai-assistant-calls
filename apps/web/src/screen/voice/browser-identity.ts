// The signed-in TutWithUs portal may launch the assistant with a short-lived
// proof in the URL fragment. Remove it immediately; never put it in storage.
let proof: string | undefined;
export function readBrowserIdentityProof(): string | undefined {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const incoming = params.get('identityProof');
  if (incoming) {
    proof = incoming.length <= 4096 ? incoming : undefined;
    params.delete('identityProof');
    const fragment = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${fragment ? `#${fragment}` : ''}`,
    );
  }
  return proof;
}
