import { z } from 'zod';
import { publicToolData } from './public-tool-data.js';
import { errorName, type Logger } from '../../lib/logger.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export const CustomerQuerySchema = z
  .object({
    phone: z.string().trim().min(8).max(24),
  })
  .strict();

export const CustomerResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('registered'), customerId: z.string().min(1) }),
  z.object({ status: z.literal('not_registered') }),
  z.object({ status: z.literal('unavailable') }),
]);

export type CustomerQuery = z.infer<typeof CustomerQuerySchema>;
export type CustomerResult = z.infer<typeof CustomerResultSchema>;

export const MemberLoginQuerySchema = z
  .object({
    phone: z.string().regex(/^[1-9]\d{7,14}$/),
    memberId: z.string().trim().min(1).max(128),
  })
  .strict();
export type MemberLoginQuery = z.infer<typeof MemberLoginQuerySchema>;

export type MemberLoginResult =
  | { status: 'verified'; accessToken: string; role: string }
  | { status: 'not_verified' }
  | { status: 'unavailable' };
export type TutorAvailabilityResult =
  { status: 'available'; data: unknown } | { status: 'unavailable' };
export const MemberLoginResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('verified'),
    accessToken: z.string().min(1),
    role: z.string().trim().min(1),
  }),
  z.object({ status: z.literal('not_verified') }),
  z.object({ status: z.literal('unavailable') }),
]);

export type BootcampResult =
  { status: 'available'; data: unknown } | { status: 'unavailable' };
export type CatalogEntry = {
  label: string;
  value: string;
};
export type SubjectsResult =
  { status: 'available'; subjects: CatalogEntry[] } | { status: 'unavailable' };
export type TutorProfile = {
  id: string;
  fullName: string;
  subjects: string[];
  curriculums: Array<{ label: string; value: string }>;
  profilePic?: string;
  degree?: string;
  school?: string;
  rating?: number;
};
export type TutorProfileSearch = {
  tutorName?: string;
  subjectName?: string;
  subjectMatchMode?: 'exact' | 'related';
  curriculum?: string;
};
export type TutorProfilesResult =
  { status: 'available'; profiles: TutorProfile[] } | { status: 'unavailable' };
export type WalletCredit = {
  creditName: string;
  amount: number;
  level?: string;
};
export type WalletSubjectLevelMatch =
  | { status: 'no_credits' }
  | { status: 'unavailable' }
  | { status: 'not_eligible' }
  | { status: 'eligible'; level: CatalogEntry };
export type WalletResult =
  { status: 'available'; wallet: WalletCredit[] } | { status: 'unavailable' };
export type WalletBundleSummary = {
  bundleName: string;
  credits: number;
};
export type SubjectBundleOption = {
  id?: string;
  name: string;
  price: number;
  currency?: string;
  credits: Array<{
    creditName: string;
    amount: number;
    levelName: string;
    levelId?: string;
  }>;
};
export type CourseBundleEdition = {
  id: string;
  name: string;
  sessions: number;
  totalPrice: number;
  pricePerSession: number;
  currency: 'SAR';
};
export type CourseBundleFamily = {
  id: string;
  name: string;
  deliveryMode: 'one_to_one' | 'group';
  levelId: string;
  levelName: string;
  editions: CourseBundleEdition[];
};
export type SubjectEligibilityResult =
  | {
      status: 'eligible';
      subjectId: string;
      subjectName: string;
      levelId: string;
      levelName: string;
      wallet: WalletBundleSummary[];
    }
  | { status: 'invalid_subject'; subjectName: string }
  | {
      status: 'ambiguous_subject';
      subjectName: string;
      candidates: string[];
    }
  | {
      status: 'no_credits';
      subjectName: string;
      wallet: WalletBundleSummary[];
      recommendedBundles?: SubjectBundleOption[];
    }
  | {
      status: 'not_eligible';
      subjectId: string;
      subjectName: string;
      wallet: WalletBundleSummary[];
      recommendedBundles?: SubjectBundleOption[];
    }
  | { status: 'unavailable' };

export type TutWithUsBackendOptions = {
  signal?: AbortSignal;
  id: string;
  baseUrl: string;
  lookupPath?: string;
  authLoginPath?: string;
  timeoutMs: number;
};

export async function getSubjects(
  backend: TutWithUsBackendOptions,
  logger?: Logger,
): Promise<SubjectsResult> {
  const url = new URL('/subjects/list', backend.baseUrl);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backend.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: backend.signal
        ? AbortSignal.any([controller.signal, backend.signal])
        : controller.signal,
    });
    if (!response.ok) {
      logger?.warn(
        {
          backend: backend.id,
          method: 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs subject catalog lookup failed',
      );
      return { status: 'unavailable' };
    }

    const body: unknown = await response.json();
    const subjects = parseCatalogEntries(body);
    if (!subjects) {
      logger?.warn(
        {
          backend: backend.id,
          method: 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          reason: 'invalid_subject_response',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs subject catalog lookup failed',
      );
      return { status: 'unavailable' };
    }
    logger?.info(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        upstreamStatus: response.status,
        outcome: 'available',
        count: subjects.length,
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs subject catalog lookup completed',
    );
    return { status: 'available', subjects };
  } catch (error) {
    logger?.warn(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        outcome: 'unavailable',
        reason: errorName(error),
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs subject catalog lookup failed',
    );
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeProfileText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function editDistance(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]!;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]!;
      previous[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length]!;
}

function similarWord(left: string, right: string): boolean {
  if (left === right) return true;
  const longest = Math.max(left.length, right.length);
  if (longest < 4) return false;
  const allowedDistance = longest >= 8 ? 2 : 1;
  return editDistance(left, right) <= allowedDistance;
}

function nameSoundKey(value: string): string {
  return value.replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
}

function similarNameWord(left: string, right: string): boolean {
  if (similarWord(left, right)) return true;
  const leftSound = nameSoundKey(left);
  const rightSound = nameSoundKey(right);
  return (
    leftSound.length > 0 &&
    rightSound.length > 0 &&
    (leftSound === rightSound || similarWord(leftSound, rightSound))
  );
}

const SUBJECT_CONCEPTS: ReadonlyArray<readonly string[]> = [
  [
    'coding',
    'code',
    'programming',
    'programmer',
    'developer',
    'development',
    'software',
    'computer science',
    'technology',
    'python',
    'javascript',
    'typescript',
    'java',
    'backend',
    'back end',
    'server',
    'frontend',
    'front end',
    'web',
    'app',
    'application',
    'database',
    'node',
    'react',
    'api',
  ],
  [
    'math',
    'maths',
    'mathematics',
    'algebra',
    'geometry',
    'calculus',
    'trigonometry',
    'statistics',
    'arithmetic',
  ],
  ['science', 'physics', 'chemistry', 'biology', 'environmental science'],
  [
    'business',
    'accounting',
    'finance',
    'economics',
    'marketing',
    'management',
    'entrepreneurship',
    'consumer behavior',
  ],
  ['english', 'language arts', 'literature', 'writing', 'grammar', 'reading'],
  ['arabic', 'arabic language'],
  ['french', 'french language'],
  [
    'engineering',
    'industrial engineering',
    'chemical engineering',
    'electrical engineering',
    'mechanical engineering',
    'civil engineering',
  ],
  ['design', 'graphic design', 'user experience', 'user interface', 'ui', 'ux'],
];

function textTokens(value: string): string[] {
  return normalizeProfileText(value).split(' ').filter(Boolean);
}

function conceptIds(value: string): Set<number> {
  const normalized = normalizeProfileText(value);
  const tokens = textTokens(value);
  const ids = new Set<number>();
  SUBJECT_CONCEPTS.forEach((terms, index) => {
    if (
      terms.some((term) => {
        const normalizedTerm = normalizeProfileText(term);
        return (
          normalized.includes(normalizedTerm) ||
          textTokens(normalizedTerm).some((termToken) =>
            tokens.some((token) => similarWord(token, termToken)),
          )
        );
      })
    )
      ids.add(index);
  });
  return ids;
}

function tutorNameMatches(value: string, query: string): boolean {
  if (profileMatches(value, query)) return true;
  const valueTokens = textTokens(value);
  const queryTokens = textTokens(query);
  return (
    queryTokens.length > 0 &&
    queryTokens.every((queryToken) =>
      valueTokens.some((valueToken) => similarNameWord(valueToken, queryToken)),
    )
  );
}

function subjectMatches(value: string, query: string): boolean {
  const canonicalQuery = textTokens(query)
    .map((token) => (/^(mass|message|methods)$/.test(token) ? 'math' : token))
    .join(' ');
  if (profileMatches(value, canonicalQuery)) return true;
  const valueTokens = textTokens(value);
  const queryTokens = textTokens(canonicalQuery);
  if (
    queryTokens.some((queryToken) =>
      valueTokens.some((valueToken) => similarWord(valueToken, queryToken)),
    )
  )
    return true;
  const queryConcepts = conceptIds(canonicalQuery);
  return [...conceptIds(value)].some((concept) => queryConcepts.has(concept));
}

function canonicalSubjectTitle(value: string): string {
  return normalizeProfileText(value)
    .split(' ')
    .filter(
      (token) =>
        !/^(course|courses|subject|subjects|class|classes|lesson|lessons)$/.test(
          token,
        ),
    )
    .join('')
    .trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseTutorProfiles(body: unknown): TutorProfile[] | undefined {
  if (!isRecord(body) || body.error === true || !Array.isArray(body.data)) {
    return undefined;
  }
  const profiles: TutorProfile[] = [];
  for (const value of body.data) {
    if (
      !isRecord(value) ||
      typeof value._id !== 'string' ||
      !value._id.trim() ||
      typeof value.fullName !== 'string' ||
      !value.fullName.trim() ||
      !Array.isArray(value.subjects) ||
      value.subjects.some(
        (subject) => typeof subject !== 'string' || !subject.trim(),
      ) ||
      !Array.isArray(value.curriculums)
    ) {
      return undefined;
    }
    const curriculums: TutorProfile['curriculums'] = [];
    for (const curriculum of value.curriculums) {
      if (
        !isRecord(curriculum) ||
        typeof curriculum.label !== 'string' ||
        !curriculum.label.trim() ||
        typeof curriculum.value !== 'string' ||
        !curriculum.value.trim()
      ) {
        return undefined;
      }
      curriculums.push({
        label: curriculum.label.trim(),
        value: curriculum.value.trim(),
      });
    }
    const profilePic = httpsUrl(value.profilePic);
    const degree = optionalText(value.degree);
    const school = optionalText(value.school);
    const rating =
      value.showRating === true &&
      typeof value.avgRating === 'number' &&
      Number.isFinite(value.avgRating) &&
      value.avgRating >= 0 &&
      value.avgRating <= 5
        ? value.avgRating
        : undefined;
    profiles.push({
      id: value._id.trim(),
      fullName: value.fullName.trim(),
      subjects: value.subjects.map((subject) => subject.trim()),
      curriculums,
      ...(profilePic ? { profilePic } : {}),
      ...(degree ? { degree } : {}),
      ...(school ? { school } : {}),
      ...(rating !== undefined ? { rating } : {}),
    });
  }
  return profiles;
}

function profileMatches(value: string, query: string): boolean {
  const normalizedValue = normalizeProfileText(value);
  const normalizedQuery = normalizeProfileText(query);
  return (
    normalizedValue === normalizedQuery ||
    normalizedValue.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedValue)
  );
}

export async function searchTutorProfiles(
  backend: TutWithUsBackendOptions,
  query: TutorProfileSearch,
  logger?: Logger,
): Promise<TutorProfilesResult> {
  const url = new URL('/tutors/profiles', backend.baseUrl);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backend.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: backend.signal
        ? AbortSignal.any([controller.signal, backend.signal])
        : controller.signal,
    });
    const profiles = response.ok
      ? parseTutorProfiles(await response.json())
      : undefined;
    if (!profiles) {
      logger?.warn(
        {
          backend: backend.id,
          method: 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs tutor profile lookup failed',
      );
      return { status: 'unavailable' };
    }
    // If the caller supplied an exact catalog subject title, exact title
    // matches take precedence over broad topic expansion. Broad matching is
    // reserved for category requests such as "coding" or "science".
    const exactSubjectProfiles = query.subjectName
      ? profiles.filter((profile) => {
          const requestedTitle = canonicalSubjectTitle(query.subjectName!);
          return profile.subjects.some(
            (subject) => canonicalSubjectTitle(subject) === requestedTitle,
          );
        })
      : [];
    const subjectPool = exactSubjectProfiles.length
      ? new Set(exactSubjectProfiles.map((profile) => profile.id))
      : undefined;
    const matches = profiles.filter(
      (profile) =>
        (!query.tutorName ||
          tutorNameMatches(profile.fullName, query.tutorName)) &&
        (!query.subjectName ||
          (subjectPool
            ? subjectPool.has(profile.id)
            : query.subjectMatchMode === 'related' &&
              profile.subjects.some((subject) =>
                subjectMatches(subject, query.subjectName!),
              ))) &&
        (!query.curriculum ||
          profile.curriculums.some(
            (curriculum) =>
              profileMatches(curriculum.label, query.curriculum!) ||
              profileMatches(curriculum.value, query.curriculum!),
          )),
    );
    logger?.info(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        upstreamStatus: response.status,
        outcome: 'available',
        count: matches.length,
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs tutor profile lookup completed',
    );
    return { status: 'available', profiles: matches };
  } catch (error) {
    logger?.warn(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        outcome: 'unavailable',
        reason: errorName(error),
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs tutor profile lookup failed',
    );
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLevelsForSubject(
  backend: TutWithUsBackendOptions,
  subjectId: string,
  logger?: Logger,
): Promise<SubjectsResult> {
  const url = new URL(
    `/levels/list/${encodeURIComponent(subjectId)}`,
    backend.baseUrl,
  );
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backend.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: backend.signal
        ? AbortSignal.any([controller.signal, backend.signal])
        : controller.signal,
    });
    if (!response.ok) {
      logger?.warn(
        {
          backend: backend.id,
          method: 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs subject level lookup failed',
      );
      return { status: 'unavailable' };
    }

    const body: unknown = await response.json();
    const levels = parseCatalogEntries(body);
    if (!levels) {
      logger?.warn(
        {
          backend: backend.id,
          method: 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          reason: 'invalid_level_response',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs subject level lookup failed',
      );
      return { status: 'unavailable' };
    }
    logger?.info(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        upstreamStatus: response.status,
        outcome: 'available',
        count: levels.length,
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs subject level lookup completed',
    );
    return { status: 'available', subjects: levels };
  } catch (error) {
    logger?.warn(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        outcome: 'unavailable',
        reason: errorName(error),
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs subject level lookup failed',
    );
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

export function matchWalletToSubjectLevels(
  wallet: readonly WalletCredit[],
  subjectLevels: readonly CatalogEntry[],
): WalletSubjectLevelMatch {
  const positiveCredits = wallet.filter((credit) => credit.amount > 0);
  if (positiveCredits.length === 0) {
    return { status: 'no_credits' };
  }
  if (positiveCredits.some((credit) => !credit.level?.trim())) {
    return { status: 'unavailable' };
  }
  const level = subjectLevels.find((subjectLevel) =>
    positiveCredits.some(
      (credit) =>
        credit.level &&
        normalizeLabel(credit.level) === normalizeLabel(subjectLevel.label),
    ),
  );
  return level ? { status: 'eligible', level } : { status: 'not_eligible' };
}

async function getActiveBundles(
  backend: TutWithUsBackendOptions,
  logger?: Logger,
): Promise<SubjectBundleOption[] | undefined> {
  const url = new URL('/bundles/active', backend.baseUrl);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backend.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: backend.signal
        ? AbortSignal.any([controller.signal, backend.signal])
        : controller.signal,
    });
    if (!response.ok) {
      logger?.warn(
        {
          backend: backend.id,
          method: 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs active bundle lookup failed',
      );
      return undefined;
    }

    const body: unknown = await response.json();
    if (!isRecord(body) || body.error !== false || !Array.isArray(body.data)) {
      logger?.warn(
        {
          backend: backend.id,
          method: 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          reason: 'invalid_bundle_response',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs active bundle lookup failed',
      );
      return undefined;
    }

    const bundles: SubjectBundleOption[] = [];
    for (const bundle of body.data) {
      if (!isRecord(bundle) || typeof bundle.isActive !== 'boolean') {
        logger?.warn(
          {
            backend: backend.id,
            method: 'GET',
            path: url.pathname,
            upstreamStatus: response.status,
            outcome: 'unavailable',
            reason: 'invalid_bundle_entry',
            durationMs: Date.now() - startedAt,
          },
          'TutWithUs active bundle lookup failed',
        );
        return undefined;
      }
      if (!bundle.isActive) {
        continue;
      }
      if (
        typeof bundle.name !== 'string' ||
        !bundle.name.trim() ||
        typeof bundle.price !== 'number' ||
        !Number.isFinite(bundle.price) ||
        bundle.price < 0 ||
        !Array.isArray(bundle.credits)
      ) {
        logger?.warn(
          {
            backend: backend.id,
            method: 'GET',
            path: url.pathname,
            upstreamStatus: response.status,
            outcome: 'unavailable',
            reason: 'invalid_bundle_entry',
            durationMs: Date.now() - startedAt,
          },
          'TutWithUs active bundle lookup failed',
        );
        return undefined;
      }

      const credits: SubjectBundleOption['credits'] = [];
      for (const credit of bundle.credits) {
        if (
          !isRecord(credit) ||
          typeof credit.creditName !== 'string' ||
          !credit.creditName.trim() ||
          typeof credit.amount !== 'number' ||
          !Number.isFinite(credit.amount) ||
          credit.amount < 0 ||
          typeof credit.levelName !== 'string' ||
          !credit.levelName.trim()
        ) {
          logger?.warn(
            {
              backend: backend.id,
              method: 'GET',
              path: url.pathname,
              upstreamStatus: response.status,
              outcome: 'unavailable',
              reason: 'invalid_bundle_credit',
              durationMs: Date.now() - startedAt,
            },
            'TutWithUs active bundle lookup failed',
          );
          return undefined;
        }
        credits.push({
          creditName: credit.creditName.trim(),
          amount: credit.amount,
          levelName: credit.levelName.trim(),
          ...(typeof credit.levelId === 'string'
            ? { levelId: credit.levelId.trim() }
            : {}),
        });
      }

      bundles.push({
        ...(typeof bundle._id === 'string' ? { id: bundle._id } : {}),
        name: bundle.name.trim(),
        price: bundle.price,
        ...(typeof bundle.currency === 'string' &&
        /^[A-Z]{3}$/.test(bundle.currency)
          ? { currency: bundle.currency }
          : {}),
        credits,
      });
    }
    logger?.info(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        upstreamStatus: response.status,
        outcome: 'available',
        count: bundles.length,
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs active bundle lookup completed',
    );
    return bundles;
  } catch (error) {
    logger?.warn(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        outcome: 'unavailable',
        reason: errorName(error),
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs active bundle lookup failed',
    );
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkSubjectEligibility(
  backend: TutWithUsBackendOptions,
  accessToken: string,
  requestedSubjectName: string,
  logger?: Logger,
): Promise<SubjectEligibilityResult> {
  const subjects = await getSubjects(backend, logger);
  if (subjects.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  const exactIdMatch = subjects.subjects.filter(
    (subject) => subject.value === requestedSubjectName,
  );
  const normalizedName = normalizeSubjectName(requestedSubjectName);
  if (!normalizedName && exactIdMatch.length === 0) {
    return { status: 'invalid_subject', subjectName: requestedSubjectName };
  }
  const nameMatches =
    exactIdMatch.length > 0
      ? exactIdMatch
      : subjects.subjects.filter(
          (subject) => normalizeSubjectName(subject.label) === normalizedName,
        );
  if (nameMatches.length === 0) {
    return { status: 'invalid_subject', subjectName: requestedSubjectName };
  }
  if (nameMatches.length > 1) {
    return {
      status: 'ambiguous_subject',
      subjectName: requestedSubjectName,
      candidates: nameMatches.map((subject) => subject.label),
    };
  }
  const subject = nameMatches[0]!;
  const subjectId = subject.value;

  const wallet = await getMyWallet(backend, accessToken, logger);
  if (wallet.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  const walletSummary = wallet.wallet.map(({ creditName, amount }) => ({
    bundleName: creditName,
    credits: amount,
  }));

  const levels = await getLevelsForSubject(backend, subjectId, logger);
  if (levels.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  const walletLevelMatch = matchWalletToSubjectLevels(
    wallet.wallet,
    levels.subjects,
  );
  if (walletLevelMatch.status === 'no_credits') {
    return {
      status: 'no_credits',
      subjectName: subject.label,
      wallet: walletSummary,
    };
  }
  if (walletLevelMatch.status === 'unavailable') {
    logger?.warn(
      {
        backend: backend.id,
        outcome: 'unavailable',
        reason: 'wallet_level_missing',
      },
      'TutWithUs subject eligibility check failed',
    );
    return { status: 'unavailable' };
  }

  if (walletLevelMatch.status === 'eligible') {
    return {
      status: 'eligible',
      subjectId,
      subjectName: subject.label,
      levelId: walletLevelMatch.level.value,
      levelName: walletLevelMatch.level.label,
      wallet: walletSummary,
    };
  }

  return {
    status: 'not_eligible',
    subjectId,
    subjectName: subject.label,
    wallet: walletSummary,
  };
}

const GENERIC_COURSE_WORDS = new Set([
  'class',
  'classes',
  'course',
  'courses',
  'subject',
  'subjects',
]);

function normalizeSubjectName(label: string): string {
  const words =
    label
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  while (
    words.length > 1 &&
    GENERIC_COURSE_WORDS.has(words[words.length - 1]!)
  ) {
    words.pop();
  }
  return words.join('');
}

const PROGRAMMING_CATEGORY_WORDS = new Set([
  'programming',
  'coding',
  'software',
  'technology',
  'tech',
  'computer',
  'computing',
  'programmation',
  'codage',
  'informatique',
  'logiciel',
  'technologie',
  'Ø¨Ø±Ù…Ø¬Ø©',
  'Ø§Ù„Ø¨Ø±Ù…Ø¬Ø©',
  'ØªÙ‚Ù†ÙŠØ©',
  'Ø§Ù„ØªÙ‚Ù†ÙŠØ©',
  'Ø­Ø§Ø³ÙˆØ¨',
  'Ø§Ù„Ø­Ø§Ø³ÙˆØ¨',
]);

const PROGRAMMING_SUBJECT_WORDS = new Set([
  ...PROGRAMMING_CATEGORY_WORDS,
  'python',
  'javascript',
  'java',
  'scratch',
  'web',
  'robotics',
  'robotique',
  'data',
  'artificial',
  'intelligence',
  'ai',
  'cybersecurity',
  'cyber',
  'Ø±ÙˆØ¨ÙˆØª',
  'Ø§Ù„Ø±ÙˆØ¨ÙˆØª',
  'Ø¨ÙŠØ§Ù†Ø§Øª',
  'Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª',
  'Ø°ÙƒØ§Ø¡',
  'Ø§Ù„Ø°ÙƒØ§Ø¡',
]);

function searchWords(value: string): string[] {
  return (
    value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function relatedProgrammingSubjects(
  subjects: readonly CatalogEntry[],
  requestedSubject: string,
): string[] {
  const requestedWords = searchWords(requestedSubject);
  if (!requestedWords.some((word) => PROGRAMMING_CATEGORY_WORDS.has(word))) {
    return [];
  }
  return subjects
    .filter((subject) =>
      searchWords(subject.label).some((word) =>
        PROGRAMMING_SUBJECT_WORDS.has(word),
      ),
    )
    .slice(0, 6)
    .map((subject) => subject.label);
}

export const CourseBundleResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    subjectId: z.string().min(1),
    subjectName: z.string().min(1),
    families: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        deliveryMode: z.enum(['one_to_one', 'group']),
        levelId: z.string().min(1),
        levelName: z.string().min(1),
        editions: z.array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            sessions: z.number().int().positive(),
            totalPrice: z.number().finite().nonnegative(),
            pricePerSession: z.number().finite().nonnegative(),
            currency: z.literal('SAR'),
          }),
        ),
      }),
    ),
  }),
  z.object({
    status: z.literal('ambiguous_subject'),
    candidates: z.array(z.string()),
  }),
  z.object({ status: z.enum(['invalid_subject', 'unavailable']) }),
]);
export type CourseBundleResult = z.infer<typeof CourseBundleResultSchema>;

const EDITION_SUFFIXES = new Map<number, string>([
  [5, 'start'],
  [10, 'boost'],
  [15, 'master'],
]);

function bundleFamilyName(name: string, sessions: number): string {
  const suffix = EDITION_SUFFIXES.get(sessions);
  if (!suffix) return name.trim();
  const words = name.trim().split(/\s+/u);
  if (words.length > 1 && words.at(-1)?.toLocaleLowerCase() === suffix) {
    return words.slice(0, -1).join(' ');
  }
  return name.trim();
}

function bundleDeliveryMode(
  bundleName: string,
  creditName: string,
): CourseBundleFamily['deliveryMode'] {
  return /\bgroup\b/iu.test(`${bundleName} ${creditName}`)
    ? 'group'
    : 'one_to_one';
}

function groupCourseBundleFamilies(
  bundles: readonly SubjectBundleOption[],
  levelIds: ReadonlySet<string>,
): CourseBundleFamily[] {
  const families = new Map<string, CourseBundleFamily>();
  for (const bundle of bundles) {
    if (!bundle.id) continue;
    for (const credit of bundle.credits) {
      if (
        !credit.levelId ||
        !levelIds.has(credit.levelId) ||
        !Number.isInteger(credit.amount) ||
        credit.amount <= 0
      ) {
        continue;
      }
      const name = bundleFamilyName(bundle.name, credit.amount);
      const deliveryMode = bundleDeliveryMode(bundle.name, credit.creditName);
      const key = [
        credit.levelId,
        deliveryMode,
        normalizeSubjectName(name),
      ].join(':');
      const family = families.get(key) ?? {
        id: key,
        name,
        deliveryMode,
        levelId: credit.levelId,
        levelName: credit.levelName,
        editions: [],
      };
      if (!family.editions.some((edition) => edition.id === bundle.id)) {
        family.editions.push({
          id: bundle.id,
          name: bundle.name,
          sessions: credit.amount,
          totalPrice: bundle.price,
          pricePerSession:
            Math.round((bundle.price / credit.amount) * 100) / 100,
          currency: 'SAR',
        });
      }
      families.set(key, family);
    }
  }
  return [...families.values()].map((family) => ({
    ...family,
    editions: family.editions.sort(
      (left, right) =>
        left.sessions - right.sessions ||
        left.totalPrice - right.totalPrice ||
        left.name.localeCompare(right.name),
    ),
  }));
}

// Public catalog chain. Wallet eligibility is deliberately separate.
export async function recommendCourseBundles(
  backend: TutWithUsBackendOptions,
  requestedSubject: string,
  logger?: Logger,
): Promise<CourseBundleResult> {
  const subjects = await getSubjects(backend, logger);
  if (subjects.status !== 'available') return { status: 'unavailable' };
  const exact = subjects.subjects.filter(
    (subject) => subject.value === requestedSubject,
  );
  const matches = exact.length
    ? exact
    : subjects.subjects.filter(
        (subject) =>
          normalizeSubjectName(subject.label) ===
          normalizeSubjectName(requestedSubject),
      );
  if (!matches.length) {
    const candidates = relatedProgrammingSubjects(
      subjects.subjects,
      requestedSubject,
    );
    return candidates.length
      ? { status: 'ambiguous_subject', candidates }
      : { status: 'invalid_subject' };
  }
  if (matches.length > 1)
    return {
      status: 'ambiguous_subject',
      candidates: matches.map((subject) => subject.label),
    };
  const subject = matches[0]!;
  const levels = await getLevelsForSubject(backend, subject.value, logger);
  if (levels.status !== 'available') return { status: 'unavailable' };
  const levelIds = new Set(levels.subjects.map((level) => level.value));
  const bundles = await getActiveBundles(backend, logger);
  if (
    !bundles ||
    bundles.some(
      (bundle) =>
        !bundle.id || bundle.credits.some((credit) => !credit.levelId),
    )
  )
    return { status: 'unavailable' };
  const families = groupCourseBundleFamilies(bundles, levelIds);
  const parsed = CourseBundleResultSchema.safeParse({
    status: 'available',
    subjectId: subject.value,
    subjectName: subject.label,
    families,
  });
  return parsed.success ? parsed.data : { status: 'unavailable' };
}

function parseCatalogEntries(body: unknown): CatalogEntry[] | undefined {
  if (!isRecord(body) || body.error !== false || !Array.isArray(body.data)) {
    return undefined;
  }
  const entries: CatalogEntry[] = [];
  for (const entry of body.data) {
    if (
      !isRecord(entry) ||
      typeof entry.label !== 'string' ||
      entry.label.trim().length === 0 ||
      typeof entry.value !== 'string' ||
      entry.value.trim().length === 0
    ) {
      return undefined;
    }
    entries.push({ label: entry.label.trim(), value: entry.value.trim() });
  }
  return entries;
}

function normalizeLabel(label: string): string {
  return label
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

export async function getMyBootcamps(
  backend: TutWithUsBackendOptions,
  accessToken: string,
  logger?: Logger,
): Promise<BootcampResult> {
  const url = new URL('/bootcamps/me', backend.baseUrl);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backend.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { authorization: 'Bearer ' + accessToken },
      signal: backend.signal
        ? AbortSignal.any([controller.signal, backend.signal])
        : controller.signal,
    });
    if (!response.ok) {
      logger?.warn(
        {
          backend: backend.id,
          method: 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs bootcamp lookup failed',
      );
      return { status: 'unavailable' };
    }

    const data: unknown = await response.json();
    if (!isRecord(data) || data.error === true)
      return { status: 'unavailable' };
    logger?.info(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        upstreamStatus: response.status,
        outcome: 'available',
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs bootcamp lookup completed',
    );
    return { status: 'available', data: publicToolData(data) };
  } catch (error) {
    logger?.warn(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        outcome: 'unavailable',
        reason: errorName(error),
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs bootcamp lookup failed',
    );
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMyWallet(
  backend: TutWithUsBackendOptions,
  accessToken: string,
  logger?: Logger,
): Promise<WalletResult> {
  const url = new URL('/wallet', backend.baseUrl);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backend.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      signal: backend.signal
        ? AbortSignal.any([controller.signal, backend.signal])
        : controller.signal,
    });
    if (!response.ok) {
      logger?.warn(
        {
          backend: backend.id,
          method: 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs wallet lookup failed',
      );
      return { status: 'unavailable' };
    }

    const body: unknown = await response.json();
    const data =
      typeof body === 'object' && body !== null && 'data' in body
        ? body.data
        : undefined;
    const wallet =
      typeof data === 'object' && data !== null && 'wallet' in data
        ? data.wallet
        : undefined;
    if (
      !Array.isArray(wallet) ||
      wallet.some(
        (credit) =>
          typeof credit !== 'object' ||
          credit === null ||
          !('creditName' in credit) ||
          typeof credit.creditName !== 'string' ||
          credit.creditName.trim().length === 0 ||
          !('amount' in credit) ||
          typeof credit.amount !== 'number' ||
          !Number.isFinite(credit.amount) ||
          credit.amount < 0 ||
          ('levelName' in credit &&
            typeof credit.levelName !== 'string' &&
            credit.levelName !== null) ||
          ('level' in credit &&
            typeof credit.level !== 'string' &&
            credit.level !== null),
      )
    ) {
      logger?.warn(
        {
          backend: backend.id,
          method: 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          reason: 'invalid_wallet_response',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs wallet lookup failed',
      );
      return { status: 'unavailable' };
    }

    logger?.info(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        upstreamStatus: response.status,
        outcome: 'available',
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs wallet lookup completed',
    );
    return {
      status: 'available',
      wallet: wallet.map((credit) => ({
        creditName: credit.creditName,
        amount: credit.amount,
        ...(typeof credit.levelName === 'string'
          ? { level: credit.levelName }
          : typeof credit.level === 'string'
            ? { level: credit.level }
            : {}),
      })),
    };
  } catch (error) {
    logger?.warn(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        outcome: 'unavailable',
        reason: errorName(error),
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs wallet lookup failed',
    );
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMyTutorAvailability(
  backend: TutWithUsBackendOptions,
  accessToken: string,
  logger?: Logger,
): Promise<TutorAvailabilityResult> {
  const url = new URL('/tutors/profiles/availabilty', backend.baseUrl);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backend.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { authorization: ['Bearer', accessToken].join(' ') },
      signal: backend.signal
        ? AbortSignal.any([controller.signal, backend.signal])
        : controller.signal,
    });
    if (!response.ok) {
      logger?.warn(
        {
          backend: backend.id,
          method: 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs tutor availability lookup failed',
      );
      return { status: 'unavailable' };
    }

    const data: unknown = await response.json();
    if (!isRecord(data) || data.error === true)
      return { status: 'unavailable' };
    logger?.info(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        upstreamStatus: response.status,
        outcome: 'available',
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs tutor availability lookup completed',
    );
    return { status: 'available', data: publicToolData(data) };
  } catch (error) {
    logger?.warn(
      {
        backend: backend.id,
        method: 'GET',
        path: url.pathname,
        outcome: 'unavailable',
        reason: errorName(error),
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs tutor availability lookup failed',
    );
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loginMember(
  backend: TutWithUsBackendOptions,
  query: MemberLoginQuery,
  logger?: Logger,
): Promise<MemberLoginResult> {
  if (!backend.authLoginPath) {
    logger?.warn(
      { backend: backend.id, outcome: 'unavailable', reason: 'path_missing' },
      'TutWithUs member login unavailable',
    );
    return { status: 'unavailable' };
  }
  const startedAt = Date.now();
  const url = new URL(backend.authLoginPath, backend.baseUrl);
  const phoneDigits = query.phone.replace(/\D/g, '');
  logger?.info(
    {
      backend: backend.id,
      method: 'POST',
      host: url.host,
      path: url.pathname,
      bodyFields: ['phone', 'memberId'],
      phoneMasked:
        phoneDigits.length >= 4 ? `***${phoneDigits.slice(-4)}` : '[REDACTED]',
      memberIdLength: query.memberId.length,
    },
    'Sending TutWithUs member login request',
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backend.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query),
      signal: backend.signal
        ? AbortSignal.any([controller.signal, backend.signal])
        : controller.signal,
    });
    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      logger?.info(
        {
          backend: backend.id,
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'not_verified',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs member login completed',
      );
      return { status: 'not_verified' };
    }
    if (!response.ok) {
      logger?.warn(
        {
          backend: backend.id,
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          durationMs: Date.now() - startedAt,
        },
        'TutWithUs member login failed',
      );
      return { status: 'unavailable' };
    }
    const body: unknown = await response.json();
    const parsed = z
      .object({
        data: z.object({
          token: z.string().min(1),
          role: z.string().trim().min(1),
        }),
      })
      .passthrough()
      .safeParse(body);
    const outcome = parsed.success ? 'verified' : 'unavailable';
    const responseRecord = isRecord(body) ? body : undefined;
    const dataRecord =
      responseRecord && isRecord(responseRecord.data)
        ? responseRecord.data
        : undefined;
    logger?.info(
      {
        backend: backend.id,
        path: url.pathname,
        upstreamStatus: response.status,
        outcome,
        responseFields: responseRecord ? Object.keys(responseRecord) : [],
        ...(dataRecord ? { responseDataFields: Object.keys(dataRecord) } : {}),
        ...(parsed.success ? {} : { reason: 'invalid_response' }),
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs member login completed',
    );
    return parsed.success
      ? {
          status: 'verified',
          accessToken: parsed.data.data.token,
          role: parsed.data.data.role.toLowerCase(),
        }
      : { status: 'unavailable' };
  } catch (error) {
    logger?.warn(
      {
        backend: backend.id,
        path: backend.authLoginPath,
        outcome: 'unavailable',
        reason: errorName(error),
        durationMs: Date.now() - startedAt,
      },
      'TutWithUs member login request failed',
    );
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function queryBackend(
  backend: TutWithUsBackendOptions,
  query: CustomerQuery,
): Promise<CustomerResult> {
  const path = backend.lookupPath;
  if (!path) {
    return { status: 'unavailable' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backend.timeoutMs);
  try {
    const response = await fetch(new URL(path, backend.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query),
      signal: backend.signal
        ? AbortSignal.any([controller.signal, backend.signal])
        : controller.signal,
    });
    if (!response.ok) {
      return { status: 'unavailable' };
    }
    const parsed = CustomerResultSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}
