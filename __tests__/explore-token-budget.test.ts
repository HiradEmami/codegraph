import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getEncoding } from 'js-tiktoken';
import CodeGraph from '../src/index';
import { ToolHandler } from '../src/mcp/tools';
import { ExploreSessionState } from '../src/mcp/explore-session-state';
import {
  buildBoundedContextPacket, countContextTokens, parseContextTokenBudget,
  type BoundedContextPacket, type ContextEncoding, type SourceEvidence,
} from '../src/context/token-budget';

function source(text: string, file = 'src/example.py', start = 1): SourceEvidence {
  return { kind: 'source', path: file, text, startLine: start, endLine: start + text.split('\n').length - 1 };
}

describe('exact context packet budgets', () => {
  for (const encoding of ['o200k_base', 'cl100k_base'] as ContextEncoding[]) {
    it(`measures the whole serialized packet with ${encoding}, including multilingual source and metadata`, () => {
      const evidence = Array.from({ length: 80 }, (_, i) => source(`value_${i} = "سلام 世界 👩🏽‍💻 <|endoftext|> ${i}"`, 'unicode.py', i + 1));
      const result = buildBoundedContextPacket({ evidence }, { maxTokens: 600, encoding });
      const actual = getEncoding(encoding).encode(result.text, [], []).length;
      expect(actual).toBe(result.tokenCount);
      expect(actual).toBeLessThanOrEqual(600);
      expect(result.packet.truncated).toBe(true);
      expect(result.packet.omitted.sourceLines).toBeGreaterThan(0);
      expect(result.packet.evidence.some((e) => e.kind === 'source')).toBe(true);
      expect(JSON.parse(result.text)).toEqual(result.packet);
      expect(result.packet.tokenizer.model).toBeNull();
      expect(result.packet.tokenizer.implementationVersion).toBe('1.0.21');
    });
  }

  it('deduplicates overlapping source locations but retains identical code at other locations', () => {
    const result = buildBoundedContextPacket({ evidence: [
      source('a\nb\nc'), source('b\nc\nd', 'src/example.py', 2),
      source('a\nb\nc', 'other.py'), source('a', 'src/example.py', 9),
      { kind: 'context', text: 'relation A -> B' }, { kind: 'context', text: 'relation A -> B' },
    ] }, { maxTokens: 5000, encoding: 'o200k_base' });
    expect(result.packet.deduplicated).toEqual({ sourceLines: 2, contextItems: 1 });
    const lines = result.packet.evidence.filter((e) => e.kind === 'source')
      .flatMap((e) => e.text.split('\n').map((text, i) => `${e.path}:${e.startLine + i}:${text}`));
    expect(lines).toHaveLength(8);
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines).toContain('other.py:1:a');
    expect(lines).toContain('src/example.py:9:a');
    expect(result.packet.truncated).toBe(false);
  });

  it('keeps different source versions distinct and is deterministic without mutating inputs', () => {
    const input = { evidence: [
      { ...source('a'), fingerprint: 'old' }, { ...source('b'), fingerprint: 'new' },
    ], notices: ['Index is stale', 'Index is stale'] };
    const snapshot = JSON.stringify(input);
    const a = buildBoundedContextPacket(input, { maxTokens: 1000, encoding: 'cl100k_base' });
    const b = buildBoundedContextPacket(input, { maxTokens: 1000, encoding: 'cl100k_base' });
    expect(a.text).toBe(b.text);
    expect(a.packet.evidence).toHaveLength(2);
    expect(a.packet.notices).toEqual(['Index is stale']);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('includes required warnings in the measured envelope and refuses budgets that cannot hold them', () => {
    const notices = ['⚠ Index belongs to another working tree. '.repeat(40)];
    expect(() => buildBoundedContextPacket({ evidence: [], notices }, { maxTokens: 200, encoding: 'o200k_base' }))
      .toThrow(/metadata and required notices/);
    const result = buildBoundedContextPacket({ evidence: [], notices }, { maxTokens: 2000, encoding: 'o200k_base' });
    expect(result.packet.notices).toEqual(notices);
    expect(countContextTokens(result.text, 'o200k_base')).toBeLessThanOrEqual(2000);
  });

  it('cuts only at whole source lines, with exact omitted-line accounting', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `line_${i} = "${'xyz '.repeat(20)}"`);
    const result = buildBoundedContextPacket({ evidence: [source(lines.join('\n'))] }, { maxTokens: 450, encoding: 'o200k_base' });
    const delivered = result.packet.evidence.filter((e) => e.kind === 'source');
    expect(delivered.length).toBeGreaterThan(0);
    for (const e of delivered) {
      expect(e.text).toBe(lines.slice(e.startLine - 1, e.endLine).join('\n'));
    }
    const count = delivered.reduce((n, e) => n + e.endLine - e.startLine + 1, 0);
    expect(count + result.packet.omitted.sourceLines).toBe(120);
  });

  it('does not output a partial single oversized source line', () => {
    const result = buildBoundedContextPacket({ evidence: [source('A ! '.repeat(3000))] }, { maxTokens: 400, encoding: 'o200k_base' });
    expect(result.packet.evidence).toEqual([]);
    expect(result.packet.omitted.sourceLines).toBe(1);
  });

  it.each([
    null, [], {}, { maxTokens: 500 }, { maxTokens: 0, encoding: 'o200k_base' },
    { maxTokens: 1.5, encoding: 'o200k_base' }, { maxTokens: '200', encoding: 'o200k_base' },
    { maxTokens: Infinity, encoding: 'o200k_base' }, { maxTokens: 1000001, encoding: 'o200k_base' },
    { maxTokens: 500, encoding: 'gpt-6' }, { maxTokens: 500, encoding: 'o200k_base', model: 'codex' },
  ])('rejects invalid or inferred tokenizer request %j', (value) => {
    expect(() => parseContextTokenBudget(value)).toThrow();
  });

  it('rejects inconsistent source attribution rather than inventing line numbers', () => {
    expect(() => buildBoundedContextPacket({ evidence: [{ ...source('one'), endLine: 2 }] }, { maxTokens: 500, encoding: 'o200k_base' }))
      .toThrow(/inclusive range/);
  });

  it('rejects an envelope-only budget explicitly', () => {
    expect(() => buildBoundedContextPacket({ evidence: [] }, { maxTokens: 1, encoding: 'o200k_base' }))
      .toThrow(/metadata/);
  });
});

describe('explore tokenBudget execution', () => {
  let root: string;
  let cg: CodeGraph;
  let handler: ToolHandler;
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-token-budget-'));
    fs.writeFileSync(path.join(root, 'source.ts'), Array.from({ length: 45 }, (_, i) =>
      `export function function${i}() { return "${'detail '.repeat(12)}${i}"; }`).join('\n'));
    fs.writeFileSync(path.join(root, 'caller.ts'), 'import { function0 } from "./source";\nexport function entry() { return function0(); }\n');
    fs.writeFileSync(path.join(root, 'windows.ts'), 'export function windowsLine() {\r\n  return "CRLF";\r\n}\r\n');
    cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    handler = new ToolHandler(cg);
  }, 30000);
  afterAll(() => { cg?.destroy(); if (root) fs.rmSync(root, { recursive: true, force: true }); });
  const textOf = async (budget?: unknown, state?: ExploreSessionState) => handler.execute('codegraph_explore', {
    query: 'source.ts entry function0', ...(budget === undefined ? {} : { tokenBudget: budget }),
  }, state);

  it('advertises nested budget validation without changing the default format', async () => {
    const schema = handler.getTools().find((t) => t.name === 'codegraph_explore')!.inputSchema.properties.tokenBudget!;
    expect(schema.required).toEqual(['maxTokens', 'encoding']);
    expect(schema.additionalProperties).toBe(false);
    const normal = await textOf();
    expect(normal.content[0]!.text).toContain('**Exploration:');
    expect(normal.content[0]!.text).not.toContain('"schemaVersion"');
  });

  it('returns a bounded packet with source ranges matching real source bytes', async () => {
    const response = await textOf({ maxTokens: 650, encoding: 'o200k_base' });
    expect(response.isError).not.toBe(true);
    const text = response.content[0]!.text;
    expect(getEncoding('o200k_base').encode(text, [], []).length).toBeLessThanOrEqual(650);
    const packet = JSON.parse(text) as BoundedContextPacket;
    expect(packet.projectRoot).toBe(root);
    expect(packet.query).toBe('source.ts entry function0');
    expect(packet.truncated).toBe(true);
    expect(packet.evidence.some((e) => e.kind === 'source')).toBe(true);
    for (const item of packet.evidence) {
      if (item.kind !== 'source') continue;
      const actual = fs.readFileSync(path.join(root, item.path), 'utf8').split('\n');
      expect(item.text).toBe(actual.slice(item.startLine - 1, item.endLine).join('\n'));
    }
  });

  it('counts staleness notices inside the cap and never drops them to fit source', async () => {
    const spy = vi.spyOn(cg, 'isWatcherDegraded').mockReturnValue(true);
    try {
      const response = await textOf({ maxTokens: 650, encoding: 'cl100k_base' });
      const text = response.content[0]!.text;
      expect(response.isError).not.toBe(true);
      expect(getEncoding('cl100k_base').encode(text, [], []).length).toBeLessThanOrEqual(650);
      expect((JSON.parse(text) as BoundedContextPacket).notices.join('\n')).toContain('auto-sync is DISABLED');
    } finally { spy.mockRestore(); }
  });
  it('preserves CRLF source bytes and attribution', async () => {
    const response = await handler.execute('codegraph_explore', {
      query: 'windows.ts', tokenBudget: { maxTokens: 700, encoding: 'o200k_base' },
    });
    expect(response.isError).not.toBe(true);
    const packet = JSON.parse(response.content[0]!.text) as BoundedContextPacket;
    const evidence = packet.evidence.filter((e) => e.kind === 'source' && e.path === 'windows.ts');
    expect(evidence.length).toBeGreaterThan(0);
    const actual = fs.readFileSync(path.join(root, 'windows.ts'), 'utf8').split('\n');
    for (const e of evidence) expect(e.text).toBe(actual.slice(e.startLine - 1, e.endLine).join('\n'));
    expect(evidence[0]!.text).toContain('\r');
  });

  it('records only delivered ranges and remains self-contained with cross-call dedup enabled', async () => {
    const before = process.env.CODEGRAPH_EXPLORE_DEDUP;
    const beforeNumbers = process.env.CODEGRAPH_EXPLORE_LINENUMS;
    process.env.CODEGRAPH_EXPLORE_DEDUP = '1';
    process.env.CODEGRAPH_EXPLORE_LINENUMS = '0';
    try {
      const state = new ExploreSessionState();
      const first = await textOf({ maxTokens: 550, encoding: 'o200k_base' }, state);
      const next = await textOf({ maxTokens: 550, encoding: 'o200k_base' }, state);
      expect(first.content[0]!.text).toBe(next.content[0]!.text);
      expect(next.content[0]!.text).not.toContain('Already sent earlier');
      expect(next).not.toHaveProperty('_cgExploreEmission');
      const packet = JSON.parse(next.content[0]!.text) as BoundedContextPacket;
      const record = state.view().projects[0]!.calls.at(-1)!;
      const delivered = packet.evidence.filter((e) => e.kind === 'source');
      for (const file of record.files) for (const range of file.ranges) {
        expect(delivered.some((e) => e.path === file.path && e.startLine === range.start && e.endLine === range.end)).toBe(true);
      }
    } finally {
      if (before === undefined) delete process.env.CODEGRAPH_EXPLORE_DEDUP; else process.env.CODEGRAPH_EXPLORE_DEDUP = before;
      if (beforeNumbers === undefined) delete process.env.CODEGRAPH_EXPLORE_LINENUMS; else process.env.CODEGRAPH_EXPLORE_LINENUMS = beforeNumbers;
    }
  });

  it('returns actionable validation errors, without internal-error retry advice', async () => {
    const invalid = await textOf({ maxTokens: 500, encoding: 'future-codex-model' });
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0]!.text).toContain('invalid_token_budget');
    expect(invalid.content[0]!.text).not.toContain('internal codegraph error');
    const tiny = await textOf({ maxTokens: 1, encoding: 'o200k_base' });
    expect(tiny.content[0]!.text).toContain('budget_too_small');
    expect(JSON.parse(tiny.content[0]!.text).error.code).toBe('budget_too_small');
    expect(tiny.content[0]!.text.length).toBeLessThan(400);
  });

  it('budgets a no-match response too, without inventing source evidence', async () => {
    const result = await handler.execute('codegraph_explore', {
      query: 'nonexistentXYZRareSymbol', tokenBudget: { maxTokens: 600, encoding: 'o200k_base' },
    });
    expect(result.isError).not.toBe(true);
    const text = result.content[0]!.text;
    expect(countContextTokens(text, 'o200k_base')).toBeLessThanOrEqual(600);
    expect((JSON.parse(text) as BoundedContextPacket).evidence.some((e) => e.kind === 'source')).toBe(false);
  });
  it('budgets unindexed-project guidance, including the session-view exception path', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-unindexed-budget-'));
    try {
      const result = await handler.execute('codegraph_explore', {
        projectPath: empty, query: 'hello', tokenBudget: { maxTokens: 500, encoding: 'o200k_base' },
      }, new ExploreSessionState());
      expect(result.isError).not.toBe(true);
      const text = result.content[0]!.text;
      expect(countContextTokens(text, 'o200k_base')).toBeLessThanOrEqual(500);
      const packet = JSON.parse(text) as BoundedContextPacket;
      expect(packet.evidence.some((e) => /index/i.test(e.text))).toBe(true);
      const legacy = await handler.execute('codegraph_explore', { projectPath: empty, query: 'hello' }, new ExploreSessionState());
      expect(legacy.content[0]!.text).not.toContain('"schemaVersion"');
      const tiny = await handler.execute('codegraph_explore', {
        projectPath: empty, query: 'hello', tokenBudget: { maxTokens: 1, encoding: 'o200k_base' },
      }, new ExploreSessionState());
      expect(JSON.parse(tiny.content[0]!.text).error.code).toBe('budget_too_small');
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  });
});
