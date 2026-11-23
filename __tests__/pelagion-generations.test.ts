import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  openPublishedGraph, readGeneration, readPublishedSource, refreshGeneration, searchPublishedSymbols,
} from '../src/pelagion/generations';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pelagion-generation-'));
  const workspace = path.join(root, 'workspace');
  const store = path.join(root, 'store');
  const clean = path.join(root, 'clean');
  fs.mkdirSync(workspace);
  fs.mkdirSync(store);
  fs.mkdirSync(clean);
  return { root, workspace, store, clean };
}

function cleanup(root: string): void {
  const selected = fs.realpathSync(root);
  if (path.dirname(selected) !== fs.realpathSync(os.tmpdir()) || !path.basename(selected).startsWith('pelagion-generation-')) {
    throw new Error('Temporary test root changed.');
  }
  fs.rmSync(selected, { recursive: true, force: true });
}

function source(root: string, file: string, content: string) {
  const selected = path.join(root, file);
  fs.mkdirSync(path.dirname(selected), { recursive: true });
  fs.writeFileSync(selected, content);
}

describe('Pelagion generation publication', () => {
  it('converges with a clean index after 32 edits including deletion, rename and package mapping', async () => {
    const { root, workspace, store, clean } = fixture();
    try {
      source(workspace, 'pyproject.toml', '[tool.setuptools.package-dir]\n"" = "src"\n');
      for (let index = 0; index < 16; index++) {
        source(workspace, 'src/p/module' + index + '.py', 'def fixture_' + index + '():\n    return 1\n');
      }
      source(workspace, 'src/p/__init__.py', '');
      source(workspace, 'src/caller.py', 'from p.module15 import fixture_15\n\ndef call():\n    return fixture_15()\n');
      const initial = await refreshGeneration(workspace, store, 'test-engine');
      expect(readGeneration(workspace, store)).toEqual(initial);
      let edits = 0;
      for (let index = 0; index < 16; index++) {
        source(workspace, 'src/p/module' + index + '.py', 'def fixture_' + index + '():\n    return ' + (index + 2) + '\n');
        edits++;
      }
      for (let index = 0; index < 8; index++) {
        source(workspace, 'src/addition' + index + '.py', 'def added_' + index + '():\n    return 2\n');
        edits++;
      }
      for (let index = 0; index < 5; index++) {
        fs.unlinkSync(path.join(workspace, 'src/p/module' + index + '.py'));
        edits++;
      }
      fs.renameSync(path.join(workspace, 'src/p/module15.py'), path.join(workspace, 'src/p/renamed.py'));
      edits++;
      source(workspace, 'src/caller.py', 'from p.renamed import fixture_15\n\ndef call():\n    return fixture_15()\n');
      edits++;
      source(workspace, 'pyproject.toml', '[tool.setuptools.package-dir]\np = "src/p"\n');
      edits++;
      expect(edits).toBe(32);
      const incremental = await refreshGeneration(workspace, store, 'test-engine');
      const rebuilt = await refreshGeneration(workspace, clean, 'test-engine', { rebuild: true });
      expect(incremental.configurationDigest).not.toBe(initial.configurationDigest);
      expect(incremental.sourceDigest).not.toBe(initial.sourceDigest);
      expect(incremental).toEqual(rebuilt);
    } finally {
      cleanup(root);
    }
  }, 60_000);

  it('binds typed symbol and source ranges to their published generation and bytes', async () => {
    const { root, workspace, store } = fixture();
    try {
      const content = 'def pelagion_unique_fixture_symbol():\n    return 1\n';
      source(workspace, 'nested/demo.py', content);
      const initial = await refreshGeneration(workspace, store, 'test-engine');
      const known = await searchPublishedSymbols(workspace, store, initial.generation, 'pelagion_unique_fixture_symbol', 5);
      const range = {
        path: 'nested/demo.py',
        sha256: createHash('sha256').update(content).digest('hex'),
        start_line: 1,
        end_line: 2,
      };
      expect(known).toMatchObject({
        generation: initial.generation,
        symbols: [{ name: 'pelagion_unique_fixture_symbol', source: range }],
        omitted: 0,
        partial: false,
      });
      expect(readPublishedSource(workspace, store, initial.generation, range))
        .toEqual({ generation: initial.generation, source: range });
      expect(await searchPublishedSymbols(workspace, store, initial.generation, 'absent_zz10980', 5))
        .toMatchObject({ symbols: [], partial: false });
      source(workspace, 'nested/demo.py', content.replace('1', '2'));
      const next = await refreshGeneration(workspace, store, 'test-engine');
      expect(next.generation).not.toBe(initial.generation);
      expect(() => readPublishedSource(workspace, store, initial.generation, range))
        .toThrow(expect.objectContaining({ code: 'stale_generation' }));
    } finally {
      cleanup(root);
    }
  }, 60_000);

  it('keeps a previous reader usable through a killed staging process and converges on retry', async () => {
    const { root, workspace, store, clean } = fixture();
    try {
      source(workspace, 'initial.py', 'def first():\n    return 1\n');
      const initial = await refreshGeneration(workspace, store, 'test-engine');
      const oldReader = await openPublishedGraph(workspace, store);
      try {
        source(workspace, 'added.py', 'def second():\n    return 2\n');
        const engine = path.resolve(__dirname, '../dist/pelagion/generations.js');
        const marker = path.join(root, 'candidate-ready');
        const program = [
          'const fs = require("node:fs");',
          'const [engine, workspace, store, marker] = process.argv.slice(1);',
          'const { refreshGeneration } = require(engine);',
          'refreshGeneration(workspace, store, "test-engine", { beforePublish: () => {',
          '  fs.writeFileSync(marker, "candidate sealed");',
          '  return new Promise(() => setInterval(() => {}, 100));',
          '} }).catch(() => { process.exitCode = 1; });',
        ].join('\n');
        const child = spawn(process.execPath, ['-e', program, engine, workspace, store, marker], { stdio: 'ignore' });
        const exited = once(child, 'exit');
        const deadline = Date.now() + 20_000;
        try {
          while (!fs.existsSync(marker) && child.exitCode === null && Date.now() < deadline) {
            await new Promise<void>(resolve => setTimeout(resolve, 10));
          }
          expect(fs.existsSync(marker)).toBe(true);
          expect(readGeneration(workspace, store)).toEqual(initial);
          expect(oldReader.getFile('initial.py')).not.toBeNull();
          expect(oldReader.getFile('added.py')).toBeNull();
        } finally {
          child.kill();
          await exited;
        }
        expect(readGeneration(workspace, store)).toEqual(initial);
        const recovered = await refreshGeneration(workspace, store, 'test-engine');
        expect(recovered).toEqual(await refreshGeneration(workspace, clean, 'test-engine', { rebuild: true }));
        expect(recovered.generation).not.toBe(initial.generation);
      } finally {
        oldReader.close();
      }
    } finally {
      cleanup(root);
    }
  }, 60_000);
});
