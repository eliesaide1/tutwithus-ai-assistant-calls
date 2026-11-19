import type { KnowledgeEntry } from '@tutwithus/contracts/admin';

// Preserve numbers and words: never collapse distinct prices or negations.
export function normalizeKnowledgeQuestion(question: string): string {
  return question
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{Z}\s]+/gu, ' ')
    .trim()
    .replace(/[?!؟]+$/u, '')
    .trim();
}

export function entryText(entry: KnowledgeEntry): string {
  return [...entry.questions, entryAnswerText(entry)].join('\n');
}

export function entryAnswerText(entry: KnowledgeEntry): string {
  return [
    entry.title,
    ...(entry.topic && entry.topic !== 'Knowledge'
      ? [`Topic: ${entry.topic}`]
      : []),
    entry.answer,
    ...(entry.course
      ? [
          `Course: ${entry.course.name}; level: ${entry.course.level}; sessions: ${entry.course.sessions}`,
        ]
      : []),
    ...(entry.price
      ? [
          `Price: ${entry.price.amount} ${entry.price.currency} per ${entry.price.unit}`,
        ]
      : []),
    `Reviewed: ${entry.reviewedOn}`,
  ].join('\n');
}
