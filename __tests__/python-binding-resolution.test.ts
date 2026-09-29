import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph } from '../src';

let graph: CodeGraph | undefined;
let root: string;
afterEach(() => { graph?.destroy(); if (root) fs.rmSync(root, { recursive: true, force: true }); });
async function index(files: Record<string, string>) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-py-binding-'));
  for (const [file, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), source);
  }
  graph = CodeGraph.initSync(root, { config: { include: ['**/*.py'], exclude: [] } });
  return await graph.indexAll();
}
function targets(caller: string, file?: string): string[] {
  const node = graph!.getNodesByName(caller).find((n) => n.kind === 'function' && (!file || n.filePath === file));
  expect(node).toBeDefined();
  return graph!.getCallees(node!.id).map(({ node: target }) => `${target.filePath}:${target.name}`).sort();
}

describe('Python import bindings cannot be replaced by unrelated names', () => {
  it.each(['relative', 'absolute', 'mapped'])('resolves the original declaration in a %s layout', async (layout) => {
    const base = layout === 'mapped' ? 'src/custom-layout' : 'pkg';
    await index({
      [`${base}/__init__.py`]: '',
      [`${base}/engine.py`]: 'def original():\n    return 1\n',
      [`${base}/api.py`]: `from ${layout === 'relative' ? '.engine' : 'pkg.engine'} import original as execute\n\ndef caller():\n    return execute()\n`,
      'other.py': 'def execute():\n    return 0\n',
      'pyproject.toml': `[tool.setuptools.package-dir]\n"pkg" = "${base}"\n`,
    });
    expect(targets('caller')).toEqual([`${base}/engine.py:original`]);
  });

  it('retains multiline aliases and ignores docstring/comment pseudo imports', async () => {
    await index({
      'real.py': 'def original():\n    pass\n',
      'wrong.py': 'def execute():\n    pass\n',
      'api.py': '"""from wrong import execute"""\n# from wrong import execute\nfrom real import (\n    original as execute, # alias\n)\n\ndef caller():\n    return execute()\n',
    });
    expect(targets('caller')).toEqual(['real.py:original']);
  });

  it('resolves private classes from their module and preserves constructor ownership', async () => {
    await index({
      'one.py': 'class _Job:\n    pass\n',
      'two.py': 'class _Job:\n    pass\n',
      'api.py': 'from one import _Job\n\ndef caller():\n    return _Job()\n',
    });
    const right = graph!.getNodesByName('_Job').find((n) => n.filePath === 'one.py' && n.kind === 'class')!;
    const wrong = graph!.getNodesByName('_Job').find((n) => n.filePath === 'two.py' && n.kind === 'class')!;
    expect(graph!.getCallers(right.id).map(({ node }) => node.name)).toContain('caller');
    expect(graph!.getCallers(wrong.id).map(({ node }) => node.name)).not.toContain('caller');
  });

  it('uses each function-local import only in its own lexical scope', async () => {
    await index({
      'one.py': 'def original():\n    pass\n',
      'two.py': 'def original():\n    pass\n',
      'api.py': 'def first():\n    from one import original as execute\n    return execute()\n\ndef second():\n    from two import original as execute\n    return execute()\n',
    });
    expect(targets('first')).toEqual(['one.py:original']);
    expect(targets('second')).toEqual(['two.py:original']);
  });

  it('does not use a module import shadowed by a function parameter', async () => {
    await index({
      'real.py': 'def original():\n    pass\n',
      'api.py': 'from real import original as execute\n\ndef caller(execute):\n    return execute()\n',
    });
    expect(targets('caller')).toEqual([]);
  });

  it.each(['execute = supplied', 'execute, other = supplied', 'execute: object = supplied'])('does not follow an import shadowed by local assignment: %s', async (assignment) => {
    await index({
      'real.py': 'def original():\n    pass\n',
      'api.py': `from real import original as execute\n\ndef caller():\n    ${assignment}\n    return execute()\n`,
    });
    expect(targets('caller')).toEqual([]);
  });

  it('keeps comprehension binding uncertainty local to its line', async () => {
    await index({
      'real.py': 'def original():\n    pass\n',
      'api.py': 'from real import original as execute\n\ndef uncertain():\n    return [execute() for execute in supplied]\n\ndef caller():\n    return execute()\n',
    });
    expect(targets('uncertain')).toEqual([]);
    expect(targets('caller')).toEqual(['real.py:original']);
  });

  it('does not manufacture an unbound bare call from a same-named function elsewhere', async () => {
    await index({ 'wrong.py': 'def execute():\n    pass\n', 'api.py': 'def caller():\n    return execute()\n' });
    expect(targets('caller')).toEqual([]);
  });

  it('does not let a later imported alias overwrite a known local function', async () => {
    await index({
      'real.py': 'def original():\n    pass\n',
      'api.py': 'from real import original as execute\n\ndef caller():\n    def execute():\n        return 3\n    return execute()\n',
    });
    expect(targets('caller')).toEqual(['api.py:execute']);
  });

  it('accepts ordinary two-space indentation for function-local imports', async () => {
    await index({ 'real.py': 'def original():\n  pass\n', 'api.py': 'def caller():\n  from real import original as execute\n  return execute()\n' });
    expect(targets('caller')).toEqual(['real.py:original']);
  });

  it.each(['absent', 'external_package'])('leaves an unavailable %s binding unresolved', async (module) => {
    await index({
      'wrong.py': 'def execute():\n    pass\n',
      'api.py': `from ${module} import original as execute\n\ndef caller():\n    return execute()\n`,
    });
    expect(targets('caller')).toEqual([]);
  });

  it('does not close over a class-local import from its method', async () => {
    await index({
      'one.py': 'def original():\n    pass\n',
      'two.py': 'def original():\n    pass\n',
      'api.py': 'from one import original as execute\n\nclass Container:\n    from two import original as execute\n    def caller(self):\n        return execute()\n',
    });
    const caller = graph!.getNodesByName('caller').find((n) => n.kind === 'method')!;
    expect(graph!.getCallees(caller.id).map(({ node }) => node.filePath)).toEqual(['one.py']);
  });

  it('follows re-export aliases without selecting a same-named decoy', async () => {
    await index({
      'pkg/__init__.py': 'from .engine import original as public\n',
      'pkg/engine.py': 'def original():\n    pass\n',
      'wrong.py': 'def execute():\n    pass\n',
      'api.py': 'from pkg import public as execute\n\ndef caller():\n    return execute()\n',
    });
    expect(targets('caller')).toEqual(['pkg/engine.py:original']);
  });

  it.each(['import pkg.engine as module', 'from pkg import engine as module', 'import pkg.engine'])('resolves module members: %s', async (statement) => {
    const receiver = statement === 'import pkg.engine' ? 'pkg.engine' : 'module';
    await index({
      'pkg/__init__.py': '',
      'pkg/engine.py': 'def original():\n    pass\n',
      'wrong.py': 'def original():\n    pass\n',
      'api.py': `${statement}\n\ndef caller():\n    return ${receiver}.original()\n`,
    });
    expect(targets('caller')).toEqual(['pkg/engine.py:original']);
  });

  it('does not choose one branch of conflicting imports', async () => {
    await index({
      'one.py': 'def original():\n    pass\n',
      'two.py': 'def original():\n    pass\n',
      'api.py': 'if condition:\n    from one import original as execute\nelse:\n    from two import original as execute\n\ndef caller():\n    return execute()\n',
    });
    expect(targets('caller')).toEqual([]);
  });

  it.each(['global execute', 'nonlocal execute'])('leaves redirected scopes conservative: %s', async (redirect) => {
    await index({
      'real.py': 'def original():\n    pass\n',
      'api.py': `from real import original as execute\n\ndef outer():\n    def caller():\n        ${redirect}\n        return execute()\n    return caller()\n`,
    });
    expect(targets('caller')).toEqual([]);
  });

  it('inherits imports from enclosing functions without leaking into siblings', async () => {
    await index({
      'real.py': 'def original():\n    pass\n',
      'api.py': 'def outer():\n    from real import original as execute\n    def caller():\n        return execute()\n    return caller()\n\ndef sibling():\n    return execute()\n',
    });
    expect(targets('caller')).toEqual(['real.py:original']);
    expect(targets('sibling')).toEqual([]);
  });
  it('keeps explicit self calls on their enclosing class without inventing bare-name bindings', async () => {
    await index({ 'api.py': 'class One:\n    def run(self):\n        return 1\n    def caller(self):\n        return self.run()\n\nclass Two:\n    def run(self):\n        return 2\n' });
    const caller = graph!.getNodesByName('caller').find((n) => n.kind === 'method')!;
    expect(graph!.getCallees(caller.id).map(({ node }) => node.qualifiedName)).toEqual(['One::run']);
  });

  it('surfaces unsupported package-map diagnostics in the full indexing result', async () => {
    const result = await index({
      'pkg/engine.py': 'def original():\n    pass\n',
      'api.py': 'from pkg.engine import original as execute\n\ndef caller():\n    return execute()\n',
      'pyproject.toml': '[tool.setuptools]\npackage-dir = { pkg = "pkg" }\n',
    });
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'python_package_map_unsupported' })]));
    expect(targets('caller')).toEqual([]);
  });

  it('rebinds after configuration-only sync and avoids repeated reparsing', async () => {
    await index({
      'one/__init__.py': '', 'two/__init__.py': '',
      'one/engine.py': 'def original():\n    return 1\n',
      'two/engine.py': 'def original():\n    return 2\n',
      'api.py': 'from pkg.engine import original as execute\n\ndef caller():\n    return execute()\n',
      'pyproject.toml': '[tool.setuptools.package-dir]\n"pkg" = "one"\n',
    });
    expect(targets('caller')).toEqual(['one/engine.py:original']);
    const unchanged = await graph!.sync();
    expect(unchanged.pythonFilesReindexed).toBeUndefined();
    fs.writeFileSync(path.join(root, 'pyproject.toml'), '[tool.setuptools.package-dir]\n"pkg" = "two"\n');
    const changed = await graph!.sync({ paths: ['pyproject.toml'] });
    expect(changed.pythonFilesReindexed).toBe(5);
    expect(targets('caller')).toEqual(['two/engine.py:original']);
    fs.writeFileSync(path.join(root, 'pyproject.toml'), '[tool.setuptools]\npackage-dir = { pkg = "two" }\n');
    const invalid = await graph!.sync();
    expect(invalid.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'python_package_map_unsupported' })]));
    expect(targets('caller')).toEqual([]);
  });
});
