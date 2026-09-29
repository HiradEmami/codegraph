/** Exact, opt-in budgets for the serialized context packet, not model billing. */
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import type { Tiktoken, TiktokenBPE } from 'js-tiktoken/lite';

export type ContextEncoding = 'o200k_base' | 'cl100k_base';
export interface ContextTokenBudget {
  maxTokens: number;
  encoding: ContextEncoding;
}
export interface SourceEvidence {
  kind: 'source';
  path: string;
  startLine: number;
  endLine: number;
  /** Complete source lines, without display line-number prefixes. */
  text: string;
  fingerprint?: string;
}
export interface TextEvidence { kind: 'context'; text: string }
export type ContextEvidence = SourceEvidence | TextEvidence;
export type PacketEvidence = ContextEvidence & { id: string };
export interface BoundedContextPacket {
  schemaVersion: 1;
  scope: 'selected-explore-evidence';
  projectRoot?: string;
  query?: string;
  tokenizer: {
    encoding: ContextEncoding;
    implementation: 'js-tiktoken';
    implementationVersion: string;
    measurement: 'exact-encoding';
    model: null;
    countScope: 'serialized-packet-text';
    excludes: 'MCP-envelope,host-framing,other-prompt-content';
  };
  maxTokens: number;
  notices: string[];
  evidence: PacketEvidence[];
  omitted: { evidenceItems: number; sourceLines: number };
  deduplicated: { contextItems: number; sourceLines: number };
  truncated: boolean;
}
export class ContextBudgetError extends Error {
  constructor(public readonly code: 'invalid_token_budget' | 'budget_too_small' | 'invalid_evidence', message: string) {
    super(message);
    this.name = 'ContextBudgetError';
  }
}

/** Validate runtime callers too; JSON Schema is not an execution-time guard. */
export function parseContextTokenBudget(value: unknown): ContextTokenBudget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContextBudgetError('invalid_token_budget', 'tokenBudget must be an object with maxTokens and encoding.');
  }
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => key !== 'maxTokens' && key !== 'encoding')
    || !Number.isSafeInteger(v.maxTokens) || (v.maxTokens as number) < 1 || (v.maxTokens as number) > 1_000_000) {
    throw new ContextBudgetError('invalid_token_budget', 'maxTokens must be an integer from 1 to 1000000; only maxTokens and encoding are supported.');
  }
  if (v.encoding !== 'o200k_base' && v.encoding !== 'cl100k_base') {
    throw new ContextBudgetError('invalid_token_budget', 'encoding must be o200k_base or cl100k_base. Model names and unknown tokenizers are not inferred.');
  }
  return { maxTokens: v.maxTokens as number, encoding: v.encoding };
}

// Lazy to leave MCP discovery and ordinary, unbudgeted reads unchanged. At most
// the two explicitly supported encoders are retained; queries never download ranks.
const encoders = new Map<ContextEncoding, Tiktoken>();
let implementationVersion: string | undefined;
function tokenizerVersion(): string {
  if (!implementationVersion) {
    const metadata = require(join(dirname(require.resolve('js-tiktoken/lite')), '..', 'package.json')) as { name?: string; version?: string };
    if (metadata.name !== 'js-tiktoken' || typeof metadata.version !== 'string') {
      throw new Error('Cannot establish the installed tokenizer version.');
    }
    implementationVersion = metadata.version;
  }
  return implementationVersion;
}
export function countContextTokens(text: string, encoding: ContextEncoding): number {
  parseContextTokenBudget({ maxTokens: 1, encoding });
  let encoder = encoders.get(encoding);
  if (!encoder) {
    const { Tiktoken: Encoder } = require('js-tiktoken/lite') as typeof import('js-tiktoken/lite');
    const ranks = require(`js-tiktoken/ranks/${encoding}`) as TiktokenBPE;
    encoder = new Encoder(ranks);
    encoders.set(encoding, encoder);
  }
  // Treat strings such as <|endoftext|> as ordinary source, not control tokens.
  return encoder.encode(text, [], []).length;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function identified(e: ContextEvidence): PacketEvidence {
  return { id: digest(e), ...e };
}
function sourcePart(e: SourceEvidence, lines: string[], offset: number): SourceEvidence {
  return { ...e, startLine: e.startLine + offset, endLine: e.startLine + offset + lines.length - 1, text: lines.join('\n') };
}

/**
 * Preserve input priority, deduplicate source by path + line + version/content,
 * and fit complete source lines. Identical text at different locations is NOT a
 * duplicate. Context paragraphs use a content identity. No cross-call memory.
 */
export function buildBoundedContextPacket(
  input: { evidence: readonly ContextEvidence[]; notices?: readonly string[]; projectRoot?: string; query?: string },
  budgetValue: ContextTokenBudget,
): { packet: BoundedContextPacket; text: string; tokenCount: number } {
  const budget = parseContextTokenBudget(budgetValue);
  const notices = [...new Set(input.notices ?? [])];
  const charCount = input.evidence.reduce((n, e) => n + e.text.length, 0)
    + notices.join('').length + (input.projectRoot?.length ?? 0) + (input.query?.length ?? 0);
  if (input.evidence.length > 10_000 || charCount > 512_000) {
    throw new ContextBudgetError('invalid_evidence', 'Packet candidates exceed 10000 items or 512000 characters.');
  }
  const deduplicated = { contextItems: 0, sourceLines: 0 };
  const candidates: ContextEvidence[] = [];
  const seen = new Set<string>();
  for (const e of input.evidence) {
    if (e.kind === 'context') {
      const key = `context:${digest(e.text)}`;
      if (seen.has(key)) { deduplicated.contextItems++; continue; }
      seen.add(key);
      candidates.push({ ...e });
      continue;
    }
    const lines = e.text.split('\n');
    if (!e.path || !Number.isSafeInteger(e.startLine) || e.startLine < 1
      || !Number.isSafeInteger(e.endLine) || e.endLine - e.startLine + 1 !== lines.length) {
      throw new ContextBudgetError('invalid_evidence', 'Source evidence must have a path and a valid inclusive range matching its complete lines.');
    }
    let run: string[] = [];
    let offset = 0;
    const flush = (): void => {
      if (run.length) candidates.push(sourcePart(e, run, offset));
      run = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const key = digest([e.path, e.startLine + i, e.fingerprint ?? null, line]);
      if (seen.has(key)) { flush(); deduplicated.sourceLines++; continue; }
      seen.add(key);
      if (!run.length) offset = i;
      run.push(line);
      // Bounded granularity keeps a large first file from being indivisible.
      if (run.length >= 40 || run.join('\n').length >= 3000) flush();
    }
    flush();
  }
  const totalLines = candidates.reduce((n, e) => n + (e.kind === 'source' ? e.endLine - e.startLine + 1 : 0), 0);
  const packet: BoundedContextPacket = {
    schemaVersion: 1,
    scope: 'selected-explore-evidence',
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
    ...(input.query ? { query: input.query } : {}),
    tokenizer: {
      encoding: budget.encoding, implementation: 'js-tiktoken', implementationVersion: tokenizerVersion(), measurement: 'exact-encoding', model: null,
      countScope: 'serialized-packet-text', excludes: 'MCP-envelope,host-framing,other-prompt-content',
    },
    maxTokens: budget.maxTokens, notices, evidence: [],
    omitted: { evidenceItems: candidates.length, sourceLines: totalLines }, deduplicated,
    truncated: candidates.length > 0,
  };
  const serialize = (): string => JSON.stringify(packet);
  const fits = (): boolean => countContextTokens(serialize(), budget.encoding) <= budget.maxTokens;
  if (!fits()) {
    throw new ContextBudgetError('budget_too_small', 'The token budget cannot fit packet metadata and required notices; increase maxTokens.');
  }
  for (const candidate of candidates) {
    const allLines = candidate.kind === 'source' ? candidate.text.split('\n') : [];
    const priorOmitted = { ...packet.omitted };
    const priorTruncated = packet.truncated;
    const trial = (item: ContextEvidence, full: boolean): boolean => {
      packet.omitted = {
        evidenceItems: priorOmitted.evidenceItems - (full ? 1 : 0),
        sourceLines: priorOmitted.sourceLines - (item.kind === 'source' ? item.endLine - item.startLine + 1 : 0),
      };
      packet.truncated = packet.omitted.evidenceItems > 0;
      packet.evidence.push(identified(item));
      if (fits()) return true;
      packet.evidence.pop();
      packet.omitted = { ...priorOmitted };
      packet.truncated = priorTruncated;
      return false;
    };
    if (trial(candidate, true)) continue;
    if (candidate.kind !== 'source' || allLines.length < 2) continue;
    // Seek a fitting prefix; every accepted candidate is measured as a complete
    // serialized packet, so BPE's non-monotonic token counts cannot breach the cap.
    let low = 1, high = allLines.length - 1, best = 0;
    while (low <= high) {
      const take = Math.floor((low + high) / 2);
      if (trial(sourcePart(candidate, allLines.slice(0, take), 0), false)) {
        best = take;
        packet.evidence.pop();
        packet.omitted = { ...priorOmitted };
        packet.truncated = priorTruncated;
        low = take + 1;
      } else high = take - 1;
    }
    if (best) trial(sourcePart(candidate, allLines.slice(0, best), 0), false);
  }
  const text = serialize();
  const tokenCount = countContextTokens(text, budget.encoding);
  if (tokenCount > budget.maxTokens) throw new Error('Context packet budget invariant failed.');
  return { packet, text, tokenCount };
}
