// The signed-in TutWithUs portal may launch the assistant with a short-lived
// proof in the URL fragment, and with the page the visitor came from so they
// can be sent back. Remove both immediately; never put them in storage.
//
// Both values are read in one pass: each reader rewrites the fragment, so
// parsing twice would lose whichever value had already been stripped.

let proof: string | undefined;
let returnTo: string | undefined;
let parsed = false;

/**
 * Only TutWithUs pages are accepted as a return target. Without this check the
 * button would be an open redirect: anyone could send a caller here with a
 * link pointing anywhere, and the assistant's own branding would lend it
 * credibility.
 */
function safeReturnTo(raw: string | null): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return undefined;
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const isTutWithUs =
    url.hostname === 'tutwithus.com' || url.hostname.endsWith('.tutwithus.com');
  if (!isTutWithUs && !isLocal) return undefined;
  if (url.protocol !== 'https:' && !isLocal) return undefined;
  return url.toString();
}

function parseFragment(): void {
  if (parsed) return;
  parsed = true;

  const params = new URLSearchParams(window.location.hash.slice(1));
  const incomingProof = params.get('identityProof');
  const incomingReturn = params.get('returnTo');
  if (!incomingProof && !incomingReturn) return;

  if (incomingProof) {
    proof = incomingProof.length <= 4096 ? incomingProof : undefined;
    params.delete('identityProof');
  }
  if (incomingReturn) {
    returnTo = safeReturnTo(incomingReturn);
    params.delete('returnTo');
  }

  const fragment = params.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${fragment ? `#${fragment}` : ''}`,
  );
}

export function readBrowserIdentityProof(): string | undefined {
  parseFragment();
  return proof;
}

/** The TutWithUs page the visitor left, when the portal supplied one. */
export function readReturnTo(): string | undefined {
  parseFragment();
  return returnTo;
}
