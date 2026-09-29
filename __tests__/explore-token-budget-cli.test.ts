import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Worker } from 'worker_threads';
import CodeGraph from '../src/index';
import { QueryPool } from '../src/mcp/query-pool';
import { ToolHandler } from '../src/mcp/tools';
import { ExploreSessionState } from '../src/mcp/explore-session-state';
import { countContextTokens, type BoundedContextPacket } from '../src/context/token-budget';

describe('built explore CLI token budget', () => {
  let root: string;
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-budget-cli-'));
    fs.writeFileSync(path.join(root, 'hello.ts'), 'export function hello() { return "こんにちは 🌍"; }\n');
    const cg = CodeGraph.initSync(root, { config: { include: ['**/*.ts'], exclude: [] } });
    try { await cg.indexAll(); } finally { cg.destroy(); }
  }, 30000);
  afterAll(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });
  function run(...args: string[]) {
    return spawnSync(process.execPath, [
      '--liftoff-only', '--disable-warning=ExperimentalWarning',
      path.resolve(__dirname, '../dist/bin/codegraph.js'), 'explore', 'hello', '--path', root, ...args,
    ], {
      encoding: 'utf8', timeout: 20000, windowsHide: true,
      env: { ...process.env, DO_NOT_TRACK: '1', CODEGRAPH_TELEMETRY: '0', CODEGRAPH_NO_UPDATE_CHECK: '1', CODEGRAPH_WASM_RELAUNCHED: '1' },
    });
  }
  it('delivers exactly the measured JSON text, without an extra stdout newline', () => {
    const result = run('--max-tokens', '700', '--tokenizer', 'o200k_base');
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const packet = JSON.parse(result.stdout) as BoundedContextPacket;
    expect(result.stdout.endsWith('\n')).toBe(false);
    expect(countContextTokens(result.stdout, 'o200k_base')).toBeLessThanOrEqual(700);
    expect(packet.evidence.some((e) => e.kind === 'source')).toBe(true);
  });
  it.each([
    ['--max-tokens', '700'], ['--tokenizer', 'o200k_base'],
    ['--max-tokens', '700junk', '--tokenizer', 'o200k_base'],
    ['--max-tokens', '700', '--tokenizer', 'unknown'],
  ])('rejects incomplete or malformed options %j', (...args) => {
    const result = run(...args);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe('invalid_token_budget');
  });
  it('keeps the existing Markdown CLI when no budget is supplied', () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('**Exploration: hello**');
  });
  it('enforces the cap and session inventory on the real worker-pool path', async () => {
    const reader = CodeGraph.openSync(root);
    const handler = new ToolHandler(reader);
    const pool = new QueryPool({
      root, size: 1, softTimeoutMs: 5000,
      createWorker: () => new Worker(path.resolve(__dirname, '../dist/mcp/query-worker.js'), {
        workerData: { root }, execArgv: [],
      }),
    });
    try {
      await pool.run('codegraph_search', { query: 'hello' });
      expect(pool.ready).toBe(true);
      handler.setQueryPool(pool);
      const state = new ExploreSessionState();
      const result = await handler.execute('codegraph_explore', {
        query: 'hello', tokenBudget: { maxTokens: 650, encoding: 'o200k_base' },
      }, state);
      expect(result.isError).not.toBe(true);
      expect(countContextTokens(result.content[0]!.text, 'o200k_base')).toBeLessThanOrEqual(650);
      expect(result).not.toHaveProperty('_cgExploreEmission');
      expect(state.view().projects[0]!.calls[0]!.files).toHaveLength(1);
    } finally { handler.setQueryPool(null); await pool.destroy(); reader.destroy(); }
  }, 20000);
});
