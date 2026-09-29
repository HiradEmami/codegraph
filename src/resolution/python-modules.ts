/** Static Python module identity. Never imports project code or executes setup.py. */
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import type { ResolutionContext } from './types';

export interface PythonModuleMap {
  modules: Map<string, string[]>;
  namesByFile: Map<string, string[]>;
  diagnostics: string[];
}

const caches = new WeakMap<ResolutionContext, PythonModuleMap>();
const MODULE = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
const STRING = /^(?:"(?:[^"\\]|\\["\\])*"|'[^']*')$/;

/** Configuration bytes are cheap to compare and are not part of source-file sync. */
export function pythonConfigurationFingerprint(projectRoot: string): string {
  let bytes: Buffer;
  try { bytes = fs.readFileSync(path.join(projectRoot, 'pyproject.toml')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') bytes = Buffer.alloc(0);
    else throw error;
  }
  return createHash('sha256').update(bytes).digest('hex');
}

function stringValue(raw: string): string | null {
  const value = raw.trim();
  if (!STRING.test(value)) return null;
  return value[0] === '"' ? JSON.parse(value) as string : value.slice(1, -1);
}

/** Narrow, fail-closed TOML subset: the explicit package-dir string table. */
export function readPythonPackageDirs(content: string): { entries: Map<string, string>; diagnostics: string[] } {
  const entries = new Map<string, string>();
  const diagnostics: string[] = [];
  let inTable = false;
  let table = '';
  let seen = false;
  for (const original of content.split(/\r?\n/)) {
    // Strip comments only outside quoted strings.
    let quote = '';
    let escaped = false;
    let line = '';
    for (const ch of original) {
      if (!quote && ch === '#') break;
      line += ch;
      if (escaped) { escaped = false; continue; }
      if (quote === '"' && ch === '\\') { escaped = true; continue; }
      if (quote && ch === quote) quote = '';
      else if (!quote && (ch === '"' || ch === "'")) quote = ch;
    }
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('[')) {
      table = /^\[\s*([^\]]+)\s*\]$/.exec(line)?.[1]?.trim() ?? '';
      inTable = /^\[\s*tool\.setuptools\.package-dir\s*\]$/.test(line);
      if (!inTable && /setuptools.*package-dir/.test(line)) diagnostics.push('Unsupported or malformed setuptools package-dir table header.');
      if (inTable && seen) diagnostics.push('Duplicate setuptools package-dir table.');
      if (inTable) seen = true;
      continue;
    }
    if (!inTable) {
      if (table === 'tool.setuptools' && /^(?:package-dir|"package-dir"|'package-dir')\s*=/.test(line)) {
        diagnostics.push('Inline package-dir tables are not supported; use [tool.setuptools.package-dir].');
      }
      continue;
    }
    const match = /^("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z_][\w-]*)\s*=\s*(.*)$/.exec(line);
    const key = match ? (stringValue(match[1]!) ?? (/^[A-Za-z_]\w*$/.test(match[1]!) ? match[1]! : null)) : null;
    const value = match ? stringValue(match[2]!) : null;
    if (key === null || (key !== '' && !MODULE.test(key)) || value === null || entries.has(key)) {
      diagnostics.push('Invalid, duplicate, or unsupported setuptools package-dir entry.');
      continue;
    }
    const normalized = value.replace(/\\/g, '/');
    if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..') || normalized.includes('\0')) {
      diagnostics.push(`Package directory for ${key || '<root>'} must stay inside the project.`);
      continue;
    }
    entries.set(key, path.posix.normalize(normalized || '.').replace(/\/$/, ''));
  }
  return { entries, diagnostics };
}

export function clearPythonModuleMap(context: ResolutionContext): void { caches.delete(context); }

export function getPythonModuleMap(context: ResolutionContext): PythonModuleMap {
  const cached = caches.get(context);
  if (cached) return cached;
  const parsed = readPythonPackageDirs(context.readFile('pyproject.toml') ?? '');
  const result: PythonModuleMap = { modules: new Map(), namesByFile: new Map(), diagnostics: parsed.diagnostics };
  caches.set(context, result);
  const root = context.getProjectRoot?.();
  const realRoot = root ? fs.realpathSync(root) : null;
  if (root) {
    for (const [name, directory] of parsed.entries) {
      const absolute = path.resolve(root, directory);
      if (!fs.existsSync(absolute)) continue;
      const relative = path.relative(realRoot!, fs.realpathSync(absolute));
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        result.diagnostics.push(`Package directory for ${name || '<root>'} resolves outside the project.`);
      }
    }
  }
  // A broken declared map must not silently become a guessed physical layout.
  if (parsed.diagnostics.length) return result;
  const files = context.getAllFiles().map((f) => f.replace(/\\/g, '/')).filter((f) => f.endsWith('.py'));
  const indexed = new Set(files);
  const add = (name: string, file: string) => {
    if (!MODULE.test(name) || !context.fileExists(file)) return;
    if (root && realRoot) {
      const relative = path.relative(realRoot, fs.realpathSync(path.join(root, file)));
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        const message = `Python module ${name} resolves outside the project; no binding was created.`;
        if (!result.diagnostics.includes(message)) result.diagnostics.push(message);
        return;
      }
    }
    const paths = result.modules.get(name) ?? [];
    if (!paths.includes(file)) paths.push(file);
    result.modules.set(name, paths);
    const names = result.namesByFile.get(file) ?? [];
    if (!names.includes(name)) names.push(name);
    result.namesByFile.set(file, names);
  };
  const moduleSuffix = (file: string): string => file.replace(/(?:\/__init__)?\.py$/, '').replace(/\//g, '.');
  const mappings = [...parsed.entries];
  const mapped = (name: string): string | null => {
    const candidates = mappings.filter(([key]) => key === '' || name === key || name.startsWith(key + '.'));
    candidates.sort((a, b) => b[0].length - a[0].length);
    const mapping = candidates[0];
    if (!mapping) return null;
    const [key, dir] = mapping;
    const rest = key ? name.slice(key.length).replace(/^\./, '') : name;
    return path.posix.join(dir, rest.replace(/\./g, '/'));
  };
  for (const file of files) {
    for (const [key, dir] of mappings) {
      const prefix = dir === '.' ? '' : dir + '/';
      if (!file.startsWith(prefix)) continue;
      const suffix = moduleSuffix(file.slice(prefix.length));
      const name = [key, suffix === '__init__' ? '' : suffix].filter(Boolean).join('.');
      const base = mapped(name);
      if (base && (file === base + '.py' || file === base + '/__init__.py')) add(name, file);
    }
    // Explicit physical roots cannot acquire accidental alternate identities.
    if (mappings.some(([, dir]) => dir === '.' || file.startsWith(dir + '/'))) continue;
    let relative = file.startsWith('src/') ? file.slice(4) : file;
    // A nested conventional package starts at its highest __init__.py ancestor.
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (indexed.has(parts.slice(0, i).join('/') + '/__init__.py')) {
        relative = parts.slice(i - 1).join('/');
        break;
      }
    }
    const name = moduleSuffix(relative);
    // A declared canonical prefix owns its name even if its target is missing.
    if (!mapped(name)) add(name, file);
  }
  return result;
}

export function resolvePythonModule(importPath: string, fromFile: string, context: ResolutionContext): string | null {
  const map = getPythonModuleMap(context);
  let name = importPath;
  if (name.startsWith('.')) {
    const names = map.namesByFile.get(fromFile.replace(/\\/g, '/')) ?? [];
    if (names.length !== 1) return null;
    const dots = name.match(/^\.+/)![0].length;
    const parent = names[0]!.split('.');
    if (!fromFile.replace(/\\/g, '/').endsWith('/__init__.py')) parent.pop();
    // A checkout can itself be the package root, whose outside name is not
    // indexed. One leading dot still names an in-root sibling module.
    if (dots === 1 && parent.length === 0 && !fromFile.includes('/')) {
      const siblings = map.modules.get(name.slice(1)) ?? [];
      return siblings.length === 1 ? siblings[0]! : null;
    }
    if (dots > parent.length) return null;
    parent.splice(parent.length - dots + 1);
    name = [...parent, name.slice(dots)].filter(Boolean).join('.');
  }
  const matches = map.modules.get(name) ?? [];
  return matches.length === 1 ? matches[0]! : null;
}
