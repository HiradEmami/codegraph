import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getPythonModuleMap, readPythonPackageDirs, resolvePythonModule, clearPythonModuleMap } from '../src/resolution/python-modules';
import type { ResolutionContext } from '../src/resolution/types';

function context(files: string[], config = ''): ResolutionContext {
  return {
    getAllFiles: () => files,
    fileExists: (file: string) => files.includes(file),
    readFile: (file: string) => file === 'pyproject.toml' ? config : null,
  } as ResolutionContext;
}

describe('validated static Python module maps', () => {
  it('uses the longest explicit package prefix including relocated child packages', () => {
    const c = context(['layout/root/__init__.py', 'elsewhere/child/__init__.py', 'elsewhere/child/impl.py', 'layout/root/child/impl.py'],
      '[tool.setuptools.package-dir]\n"pkg" = "layout/root"\n"pkg.child" = "elsewhere/child"\n');
    expect(resolvePythonModule('pkg.child.impl', 'caller.py', c)).toBe('elsewhere/child/impl.py');
    expect(resolvePythonModule('..', 'elsewhere/child/impl.py', c)).toBe('layout/root/__init__.py');
  });
  it('ignores similarly named configuration owned by unrelated tools', () => {
    const c = context(['pkg/engine.py'], '[tool.other]\npackage-dir = { strange = "elsewhere" }\n');
    expect(getPythonModuleMap(c).diagnostics).toEqual([]);
    expect(resolvePythonModule('pkg.engine', 'caller.py', c)).toBe('pkg/engine.py');
  });
  it('supports a default src mapping and quoted keys/values with comments', () => {
    const c = context(['src/pkg/__init__.py', 'src/pkg/engine.py'], "[tool.setuptools.package-dir]\n'' = 'src' # comment\n");
    expect(resolvePythonModule('pkg.engine', 'src/pkg/__init__.py', c)).toBe('src/pkg/engine.py');
  });
  it.each(['../outside', '/outside', 'C:/outside', '\\\\server\\share'])('rejects an escaping or absolute directory: %s', (directory) => {
    const result = readPythonPackageDirs(`[tool.setuptools.package-dir]\n'pkg' = '${directory}'\n`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
  it.each([
    '[tool.setuptools.package-dir]\n"pkg" = 42',
    '[tool.setuptools.package-dir]\n"pkg" = "one"\n"pkg" = "two"',
    '[tool.setuptools.package-dir]\n"pkg.bad-name" = "one"',
    '[tool.setuptools]\npackage-dir = { pkg = "one" }',
    '[tool.setuptools.package-dir]\n"pkg" = "unterminated',
  ])('fails closed on unsupported/malformed mappings: %s', (config) => {
    const c = context(['pkg/engine.py'], config);
    expect(getPythonModuleMap(c).diagnostics.length).toBeGreaterThan(0);
    expect(resolvePythonModule('pkg.engine', 'caller.py', c)).toBeNull();
  });
  it('does not fall back to an unrelated physical tree when an explicit target is missing', () => {
    const c = context(['pkg/engine.py'], '[tool.setuptools.package-dir]\n"pkg" = "missing"');
    expect(resolvePythonModule('pkg.engine', 'caller.py', c)).toBeNull();
  });
  it('preserves ambiguous conventional package roots instead of picking file order', () => {
    const files = ['one/pkg/__init__.py', 'one/pkg/engine.py', 'two/pkg/__init__.py', 'two/pkg/engine.py'];
    for (const ordering of [files, [...files].reverse()]) {
      expect(resolvePythonModule('pkg.engine', 'caller.py', context(ordering))).toBeNull();
    }
  });
  it('rejects relative imports beyond the canonical package boundary', () => {
    const c = context(['pkg/__init__.py', 'pkg/engine.py', 'other.py']);
    expect(resolvePythonModule('..other', 'pkg/engine.py', c)).toBeNull();
  });
  it('invalidates the module map together with resolver caches', () => {
    const files = ['pkg/old.py'];
    const c = context(files);
    expect(resolvePythonModule('pkg.old', 'caller.py', c)).toBe('pkg/old.py');
    files.splice(0, 1, 'pkg/new.py');
    clearPythonModuleMap(c);
    expect(resolvePythonModule('pkg.old', 'caller.py', c)).toBeNull();
    expect(resolvePythonModule('pkg.new', 'caller.py', c)).toBe('pkg/new.py');
  });
  it('refuses a mapped directory whose real target escapes through a symlink/junction', () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-py-map-link-'));
    const root = path.join(sandbox, 'root');
    const outside = path.join(sandbox, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'engine.py'), 'def run(): pass\n');
    const link = path.join(root, 'linked');
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      const c = context(['linked/engine.py'], '[tool.setuptools.package-dir]\n"pkg" = "linked"');
      c.getProjectRoot = () => root;
      expect(getPythonModuleMap(c).diagnostics).toContain('Package directory for pkg resolves outside the project.');
      expect(resolvePythonModule('pkg.engine', 'caller.py', c)).toBeNull();
    } finally {
      if (fs.existsSync(link)) fs.unlinkSync(link);
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
