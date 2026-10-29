import { z } from 'zod';
import type { DocumentIndex } from './index.js';

export const casesSchema = z.array(z.object({
  id: z.string().min(1), query: z.string().min(1),
  relevant: z.array(z.object({ path: z.string(), startLine: z.number().int().positive(), endLine: z.number().int().positive() })).min(1),
})).min(1);
export function evaluate(index: DocumentIndex, input: unknown, k = 5) {
  const cases = casesSchema.parse(input);
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Evaluation case IDs must be unique');
  const results = cases.map(c => {
    for (const relevant of c.relevant) index.read(relevant.path, relevant.startLine, relevant.endLine);
    const passages = index.search(c.query, k).passages;
    const ranks = c.relevant.map(r => passages.findIndex(p => p.path === r.path && p.startLine <= r.endLine && p.endLine >= r.startLine) + 1);
    const found = ranks.filter(r => r > 0);
    return { id: c.id, query: c.query, recall: found.length / ranks.length, reciprocalRank: found.length ? 1 / Math.min(...found) : 0, retrieved: passages.map(p => p.citation) };
  });
  return { dataset: 'Local, hand-written retrieval cases; not a general benchmark or answer-quality score.', revision: index.status().revision, k, cases: results.length,
    recallAtK: results.reduce((a, r) => a + r.recall, 0) / results.length,
    mrrAtK: results.reduce((a, r) => a + r.reciprocalRank, 0) / results.length, results };
}
