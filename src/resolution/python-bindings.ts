/** Python bindings are evidence, not suggestions to a global name matcher. */
import type { Node } from '../types';
import type { ImportMapping, ResolutionContext, ResolvedRef, UnresolvedRef } from './types';
import { resolvePythonModule } from './python-modules';

interface Binding {
  name: string;
  scope: string;
  line: number;
  endLine: number;
  imported?: ImportMapping;
  declaration?: Node;
  uncertain?: boolean;
  onlyLine?: boolean;
  receiverInference?: boolean;
}
interface Bindings { nodes: Node[]; scopes: Node[]; bindings: Binding[] }
const cache = new WeakMap<ResolutionContext, Map<string, Bindings>>();
const SCOPES = new Set(['function', 'method', 'class']);
const DECLARATIONS = new Set(['function', 'class', 'variable', 'constant', 'parameter']);

/** Offset-preserving lexical mask; Python strings/comments are never bindings. */
function maskLiterals(source: string): string {
  return source.replace(/(?:[rubf]{0,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*')|#[^\n]*/gi,
    (text) => text.replace(/[^\r\n]/g, ' '));
}

/** AST-extracted import signatures exclude comments/docstrings masquerading as code. */
export function parsePythonImport(statement: string): ImportMapping[] {
  const text = statement.replace(/#[^\n]*/g, '').replace(/\\\r?\n/g, ' ').replace(/[\r\n]/g, ' ').trim();
  const from = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(text);
  const bare = /^import\s+(.+)$/.exec(text);
  if (!from && !bare) return [];
  const list = (from?.[2] ?? bare![1]!).replace(/^\(\s*|\s*\)$/g, '');
  const result: ImportMapping[] = [];
  for (const part of list.split(',')) {
    const m = /^\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|\*)\s*(?:as\s+([A-Za-z_]\w*))?\s*$/.exec(part);
    if (!m) continue;
    if (from) {
      result.push({ localName: m[2] ?? m[1]!, exportedName: m[1]!, source: from[1]!, isDefault: false, isNamespace: false });
    } else {
      result.push({ localName: m[2] ?? m[1]!.split('.')[0]!, exportedName: m[2] ? '*' : m[1]!, source: m[1]!, isDefault: false, isNamespace: true });
    }
  }
  return result;
}

function contains(scope: Node, line: number, column = Number.MAX_SAFE_INTEGER): boolean {
  return (line > scope.startLine || (line === scope.startLine && column > scope.startColumn)) && line <= scope.endLine;
}
function parentScope(scopes: Node[], node: Node): string {
  return scopes.find((s) => s.id !== node.id && contains(s, node.startLine, node.startColumn) && s.endLine >= node.endLine)?.id ?? '';
}
function parameterNames(signature: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 1;
  let quote = '';
  for (let i = 0; i < signature.length; i++) {
    const ch = signature[i]!;
    if (quote) { if (ch === quote && signature[i - 1] !== '\\') quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if ((ch === ',' && depth === 1) || (ch === ')' && depth === 0)) {
      const name = /^\s*\*{0,2}([A-Za-z_]\w*)/.exec(signature.slice(start, i))?.[1];
      if (name) result.push(name);
      start = i + 1;
      if (depth === 0) break;
    }
  }
  return result;
}

function getBindings(file: string, context: ResolutionContext): Bindings {
  let files = cache.get(context);
  if (!files) { files = new Map(); cache.set(context, files); }
  const previous = files.get(file);
  if (previous) return previous;
  const nodes = context.getNodesInFile(file).filter((n) => n.language === 'python');
  const scopes = nodes.filter((n) => SCOPES.has(n.kind)).sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine) || b.startColumn - a.startColumn);
  const bindings: Binding[] = [];
  const result = { nodes, scopes, bindings };
  files.set(file, result);
  const seenImports = new Set<string>();
  const lines = maskLiterals(context.readFile(file) ?? '').split('\n');
  for (const node of nodes) {
    const scope = parentScope(scopes, node);
    if (node.kind === 'import' && node.signature) {
      const key = `${node.startLine}:${node.startColumn}:${node.signature}`;
      if (seenImports.has(key)) continue;
      seenImports.add(key);
      for (const imported of parsePythonImport(node.signature)) {
        const owner = scopes.find((n) => n.id === scope);
        // Imports nested in a conditional block do not establish unconditional bindings.
        const bodyIndents = owner ? lines.slice(owner.startLine, owner.endLine)
          .filter((line) => line.trim()).map((line) => line.match(/^\s*/)?.[0].length ?? 0) : [];
        const bodyIndent = bodyIndents.length ? Math.min(...bodyIndents) : 0;
        const uncertain = node.startColumn > (owner ? bodyIndent : 0);
        bindings.push({ name: imported.localName, scope, line: node.startLine, endLine: node.endLine, imported, uncertain });
      }
    } else if (DECLARATIONS.has(node.kind)) {
      bindings.push({ name: node.name, scope, line: node.startLine, endLine: node.endLine, declaration: node });
    }
    if (node.kind === 'function' || node.kind === 'method') {
      for (const name of parameterNames(node.signature ?? '')) bindings.push({ name, scope: node.id, line: node.startLine, endLine: node.startLine });
    }
  }
  // The graph intentionally omits local variable nodes. Retain just binding
  // blockers here so assignments cannot silently inherit an imported name.
  // Unknown values remain unresolved rather than being executed/inferred.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const scope = scopes.find((s) => contains(s, i + 1, line.search(/\S/)))?.id;
    if (!scope) continue;
    const localNames = new Set<string>();
    const assignment = /^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?\s*(?:=(?!=)|\+=|-=|\*=|\/=)/.exec(line);
    if (assignment) localNames.add(assignment[1]!);
    const unpacking = /^\s*([\w\s,()[\]*]+)\s*=(?!=)/.exec(line);
    if (unpacking?.[1]?.includes(',')) for (const name of unpacking[1].matchAll(/[A-Za-z_]\w*/g)) localNames.add(name[0]);
    const loop = /^\s*(?:async\s+)?for\s+([A-Za-z_]\w*)\s+in\b/.exec(line);
    if (loop) localNames.add(loop[1]!);
    const redirect = /^\s*(?:global|nonlocal|del)\s+([A-Za-z_]\w*)/.exec(line);
    if (redirect) localNames.add(redirect[1]!);
    for (const match of line.matchAll(/\bas\s+([A-Za-z_]\w*)|\b([A-Za-z_]\w*)\s*:=/g)) {
      if (!/^\s*(?:from|import)\b/.test(line)) localNames.add(match[1] ?? match[2]!);
    }
    for (const name of localNames) bindings.push({ name, scope, line: i + 1, endLine: i + 1, uncertain: true,
      receiverInference: !!assignment && /^\s*\w+\s*(?::[^=]+)?=\s*[A-Z]\w*\s*\(/.test(line) });
    // Comprehension/lambda bindings do not leak into their surrounding scope.
    for (const match of line.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\b|\blambda\s+([A-Za-z_]\w*)\s*:/g)) {
      bindings.push({ name: match[1] ?? match[2]!, scope, line: i + 1, endLine: i + 1, uncertain: true, onlyLine: true });
    }
  }
  return result;
}

export function clearPythonBindings(context: ResolutionContext): void { cache.delete(context); }

/** Actual lexical scope chain. A method does not close over its class namespace. */
function scopeChain(data: Bindings, ref: UnresolvedRef): string[] {
  const containing = data.scopes.filter((s) => contains(s, ref.line, ref.column));
  const chain: string[] = [];
  let insideFunction = false;
  for (const s of containing) {
    if (s.kind === 'class' && insideFunction) continue;
    chain.push(s.id);
    if (s.kind !== 'class') insideFunction = true;
  }
  chain.push('');
  return chain;
}

function bindingFor(data: Bindings, ref: UnresolvedRef, name: string): Binding[] {
  // An import dependency describes THAT statement, even when the binding is later replaced.
  if (ref.referenceKind === 'imports') {
    const exact = data.bindings.filter((b) => b.imported && ref.line >= b.line && ref.line <= b.endLine &&
      (b.name === name || b.imported.source === ref.referenceName));
    if (exact.length) return exact;
  }
  for (const scope of scopeChain(data, ref)) {
    const matches = data.bindings.filter((b) => b.scope === scope && b.name === name && (!b.onlyLine || b.line === ref.line));
    if (matches.length) return matches;
    if (data.bindings.some((b) => b.scope === scope && b.name === '*')) return [{ name, scope, line: ref.line, endLine: ref.line, uncertain: true }];
  }
  return [];
}

/** Follow module-level declarations/re-exports, with explicit ambiguity and cycle stops. */
function symbol(file: string, name: string, context: ResolutionContext, seen: Set<string>): Node | null {
  const key = `${file}:${name}`;
  if (seen.has(key) || seen.size >= 32) return null;
  seen.add(key);
  const data = getBindings(file, context);
  const matches = data.bindings.filter((b) => b.scope === '' && b.name === name);
  if (matches.length !== 1 || matches[0]!.uncertain) return null;
  const binding = matches[0]!;
  if (binding.declaration) return binding.declaration;
  if (!binding.imported || binding.imported.isNamespace) return null;
  const target = resolvePythonModule(binding.imported.source, file, context);
  return target ? symbol(target, binding.imported.exportedName, context, seen) : null;
}

function moduleMember(file: string, members: string[], context: ResolutionContext, seen: Set<string>): Node | null {
  if (!members.length) return context.getNodesInFile(file).find((n) => n.kind === 'file') ?? null;
  const target = symbol(file, members[0]!, context, seen);
  if (!target) return null;
  if (members.length === 1) return target;
  if (target.kind !== 'class' || members.length !== 2) return null;
  const membersInClass = context.getNodesInFile(target.filePath).filter((n) =>
    n.qualifiedName === `${target.qualifiedName}::${members[1]}` && contains(target, n.startLine, n.startColumn));
  return membersInClass.length === 1 ? membersInClass[0]! : null;
}

/** undefined means this resolver has no binding evidence; null is a confirmed stop. */
export function resolvePythonBinding(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null | undefined {
  if (ref.language !== 'python') return undefined;
  if (ref.referenceKind === 'imports' && ref.referenceName.startsWith('.')) {
    const file = resolvePythonModule(ref.referenceName, ref.filePath, context);
    const target = file && context.getNodesInFile(file).find((n) => n.kind === 'file');
    return target ? { original: ref, targetNodeId: target.id, confidence: 1, resolvedBy: 'import' } : null;
  }
  const parts = ref.referenceName.split('.');
  if (!parts.every((p) => /^[A-Za-z_]\w*$/.test(p))) return undefined;
  const data = getBindings(ref.filePath, context);
  if (parts.length === 2 && (parts[0] === 'self' || parts[0] === 'cls')) {
    const method = data.scopes.find((s) => s.kind === 'method' && contains(s, ref.line, ref.column));
    const owner = method && data.scopes.find((s) => s.kind === 'class' && contains(s, method.startLine, method.startColumn));
    const targets = owner ? data.nodes.filter((n) => n.kind === 'method' && n.qualifiedName === `${owner.qualifiedName}::${parts[1]}`) : [];
    if (targets.length !== 1) return null;
    return { original: ref, targetNodeId: targets[0]!.id, confidence: 1, resolvedBy: 'exact-match', metadata: { bindingEvidence: 'python-enclosing-class' } };
  }
  const bindings = bindingFor(data, ref, parts[0]!);
  if (!bindings.length) {
    // Module dependency refs (`from .engine import ...`) name the source itself.
    if (ref.referenceKind === 'imports') {
      const file = resolvePythonModule(ref.referenceName, ref.filePath, context);
      const target = file && context.getNodesInFile(file).find((n) => n.kind === 'file');
      return target ? { original: ref, targetNodeId: target.id, confidence: 1, resolvedBy: 'import' } : null;
    }
    return parts.length === 1 && (ref.referenceKind === 'calls' || ref.referenceKind === 'instantiates') ? null : undefined;
  }
  if (bindings.length !== 1) return null;
  const binding = bindings[0]!;
  if (binding.uncertain && ref.referenceKind !== 'imports') return parts.length > 1 && binding.receiverInference ? undefined : null;
  let target: Node | null = null;
  const imp = binding.imported;
  if (!imp) {
    if (binding.declaration && parts.length === 1) target = binding.declaration;
    // A parameter/local value requires receiver type inference, not an import.
    if (parts.length > 1 && binding.declaration?.kind !== 'function' && binding.declaration?.kind !== 'class') return undefined;
  } else if (imp.isNamespace) {
    const importedFile = resolvePythonModule(imp.source, ref.filePath, context);
    if (ref.referenceKind === 'imports') {
      target = importedFile ? moduleMember(importedFile, [], context, new Set()) : null;
    } else {
      const prefix = imp.exportedName === '*' ? imp.localName : imp.source;
      if (ref.referenceName.startsWith(prefix + '.') && importedFile) {
        target = moduleMember(importedFile, ref.referenceName.slice(prefix.length + 1).split('.'), context, new Set());
      }
    }
  } else {
    const file = resolvePythonModule(imp.source, ref.filePath, context);
    if (file) target = moduleMember(file, [imp.exportedName, ...parts.slice(1)], context, new Set());
    if (!target) {
      const submodule = resolvePythonModule(imp.source + (imp.source.endsWith('.') ? '' : '.') + imp.exportedName, ref.filePath, context);
      if (submodule) target = moduleMember(submodule, parts.slice(1), context, new Set());
    }
  }
  if (!target) return null;
  if (ref.referenceKind === 'calls' && !['function', 'method', 'class'].includes(target.kind)) return null;
  return { original: ref, targetNodeId: target.id, confidence: 1, resolvedBy: imp ? 'import' : 'exact-match', metadata: { bindingEvidence: imp ? 'python-import' : 'python-lexical' } };
}
