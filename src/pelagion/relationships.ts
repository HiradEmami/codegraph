/** Generation-bound read-only projections of the existing Python graph. */

import { createDatabase, type SqliteDatabase } from '../db/sqlite-adapter';
import { capturePublishedGeneration, sourceRange, type SourceFile } from './generations';
import { WireError } from './wire';

export const GRAPH_OPERATIONS = ['relationships', 'impact', 'trace_contract', 'suggest_checks', 'explain_retrieval'] as const;
type GraphOperation = typeof GRAPH_OPERATIONS[number];
type Scope = 'symbol' | 'workspace' | 'cross_tool';
type Direction = 'outgoing' | 'incoming' | 'both';
interface Window { limit: number; offset: number }
interface Selector { path: string; name: string }
interface NodeRow { name: string; qualifiedName: string; kind: string; file: string; start: number; end: number }
interface EdgeRow {
  source: string;
  target: string | null;
  kind: string;
  line: number | null;
  provenance: string | null;
  ref: string | null;
}

const DIGEST = /^[0-9a-f]{64}$/;
const ROW_LIMIT = 1_000_000;
const CONTRACT_PATHS = [
  "LIKE '%/api.py'", "LIKE '%/cli.py'", "LIKE '%/external/%'", "LIKE '%/adaptors/%'", "LIKE 'tests/%'",
];

function object(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
      || Object.keys(value).length !== names.length || !names.every(name => Object.hasOwn(value, name))) {
    throw new WireError('invalid_parameters', 'Provide the declared graph query fields.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.includes('\0')) {
    throw new WireError('invalid_parameters', 'Use a bounded nonempty graph selector.');
  }
  return value;
}

function resolveCapture(params: Record<string, unknown>) {
  const generation = text(params.generation, 64);
  if (!DIGEST.test(generation)) {
    throw new WireError('invalid_parameters', 'Select an exact published generation.');
  }
  return capturePublishedGeneration(text(params.workspace, 32768), text(params.store, 32768), generation);
}

function windowOf(params: Record<string, unknown>): Window {
  const { limit, offset } = params;
  if (typeof limit !== 'number' || typeof offset !== 'number' || !Number.isSafeInteger(limit)
      || !Number.isSafeInteger(offset) || limit < 1 || limit > 100 || offset < 0 || offset > ROW_LIMIT) {
    throw new WireError('invalid_parameters', 'Select a bounded graph result window.');
  }
  return { limit, offset };
}

function nextOffset(window: Window, count: number): number | null {
  if (count <= window.limit) return null;
  const next = window.offset + window.limit;
  if (next > ROW_LIMIT) throw new WireError('graph_budget', 'The graph continuation exceeds the admitted bound.');
  return next;
}

function selectedNode(db: SqliteDatabase, selector: Selector): string | undefined {
  const sql = "SELECT id FROM nodes WHERE language = 'python' AND file_path = ? "
    + "AND (name = ? OR qualified_name = ?) ORDER BY id LIMIT 2";
  const rows = db.prepare(sql).all(selector.path, selector.name, selector.name) as { id: string }[];
  if (rows.length > 1) {
    throw new WireError('ambiguous_selector', 'The selector matches more than one indexed Python symbol.');
  }
  return rows[0]?.id;
}

function edgeRows(
  db: SqliteDatabase, operation: GraphOperation, scope: Scope, direction: Direction,
  id: string | undefined, window: Window,
): EdgeRow[] {
  if (scope === 'symbol' && id === undefined) return [];
  const args: string[] = [];
  const conditions = ["s.language = 'python'", "t.language = 'python'"];
  if (scope === 'symbol' && id !== undefined) {
    if (direction === 'both') {
      conditions.push('(e.source = ? OR e.target = ?)');
      args.push(id, id);
    } else {
      conditions.push(direction === 'incoming' ? 'e.target = ?' : 'e.source = ?');
      args.push(id);
    }
  } else if (scope === 'cross_tool') {
    conditions.push("s.file_path LIKE 'src/tools/%' AND t.file_path LIKE 'src/tools/%'");
    const owner = (field: string) =>
      'substr(' + field + ".file_path, 11, instr(substr(" + field + ".file_path, 11), '/') - 1)";
    conditions.push(owner('s') + ' <> ' + owner('t'));
  }
  if (operation === 'trace_contract') {
    const tests = ['s', 't'].flatMap(role => CONTRACT_PATHS.map(test => role + '.file_path ' + test));
    conditions.push('(' + tests.join(' OR ') + ')');
  }
  if (operation === 'suggest_checks') {
    conditions.push("(s.file_path LIKE 'tests/%' OR t.file_path LIKE 'tests/%')");
  }
  const resolved = [
    'SELECT 0 AS bucket, e.id AS rowid, e.source, e.target, e.kind, e.line, e.provenance, NULL AS ref',
    'FROM edges e JOIN nodes s ON e.source = s.id JOIN nodes t ON e.target = t.id',
    'WHERE ' + conditions.join(' AND '),
  ].join(' ');
  let unresolved = '';
  const include = scope === 'workspace' || (scope === 'symbol' && direction !== 'incoming');
  if (include && (operation === 'relationships' || operation === 'explain_retrieval')) {
    unresolved = [
      'UNION ALL SELECT 1 AS bucket, u.id AS rowid, u.from_node_id AS source, NULL AS target,',
      'u.reference_kind AS kind, u.line, NULL AS provenance, u.reference_name AS ref',
      'FROM unresolved_refs u JOIN nodes n ON n.id = u.from_node_id',
      "WHERE n.language = 'python'" + (id === undefined ? '' : ' AND u.from_node_id = ?'),
    ].join(' ');
    if (id !== undefined) args.push(id);
  }
  return db.prepare(resolved + ' ' + unresolved + ' ORDER BY bucket, rowid LIMIT ? OFFSET ?')
    .all(...args, window.limit + 1, window.offset) as EdgeRow[];
}

function nodeEvidence(db: SqliteDatabase, files: Map<string, SourceFile>, id: string) {
  const sql = 'SELECT name, qualified_name AS qualifiedName, kind, file_path AS file, '
    + 'start_line AS start, end_line AS end FROM nodes WHERE id = ?';
  const row = db.prepare(sql).get(id) as NodeRow | undefined;
  if (row === undefined) throw new WireError('incomplete_graph', 'A relationship endpoint is unavailable.');
  return { name: row.name, qualified_name: row.qualifiedName, kind: row.kind,
    source: sourceRange(files, row.file, row.start, row.kind === "file" ? 1 : row.end) };
}

export function readRelationships(operation: GraphOperation, input: Record<string, unknown>): object {
  const params = object(input, ['workspace', 'store', 'generation', 'scope', 'selector', 'direction', 'limit', 'offset']);
  const window = windowOf(params);
  const { scope, direction } = params;
  if ((scope !== 'symbol' && scope !== 'workspace' && scope !== 'cross_tool')
      || (direction !== 'outgoing' && direction !== 'incoming' && direction !== 'both')
      || (scope !== 'symbol' && (params.selector !== null || direction !== 'outgoing'))) {
    throw new WireError('invalid_parameters', 'Select a supported relationship scope and direction.');
  }
  const selector = scope === 'symbol' ? object(params.selector, ['path', 'name']) : null;
  const capture = resolveCapture(params);
  const { db } = createDatabase(capture.database, { readOnly: true });
  try {
    const id = selector === null ? undefined : selectedNode(db, {
      path: text(selector.path, 4096), name: text(selector.name, 256),
    });
    const rows = edgeRows(db, operation, scope, direction, id, window);
    const cache = new Map<string, ReturnType<typeof nodeEvidence>>();
    const node = (id: string) => {
      const existing = cache.get(id);
      if (existing) return existing;
      const observed = nodeEvidence(db, capture.files, id);
      cache.set(id, observed);
      return observed;
    };
    const uncertainty: string[] = [];
    if (selector !== null && id === undefined) uncertainty.push('symbol_not_in_index');
    if (scope === 'cross_tool') uncertainty.push('ownership_candidates_need_review');
    if (operation === 'impact') uncertainty.push('direct_relationships_only');
    return {
      generation: capture.receipt, next_offset: nextOffset(window, rows.length), uncertainty,
      edges: rows.slice(0, window.limit).map(row => {
        const source = node(row.source);
        const target = row.target === null ? null : node(row.target);
        const explicit = row.kind === 'contains' || row.provenance === 'scip';
        return {
          source, target, kind: row.kind,
          state: target === null ? 'unresolved' : explicit ? 'confirmed' : 'inferred',
          rule: row.ref !== null ? 'unresolved_index_reference' : row.provenance ?? 'indexed_static_candidate',
          reference: row.ref === null ? null : row.ref.slice(0, 256),
          occurrence: row.line === null || row.line < 1 ? null :
            sourceRange(capture.files, source.source.path, row.line, row.line),
        };
      }),
    };
  } finally {
    db.close();
  }
}

function snapshotSymbol(capture: ReturnType<typeof resolveCapture>, selector: Selector | null) {
  if (selector === null) return null;
  const { db } = createDatabase(capture.database, { readOnly: true });
  try {
    const id = selectedNode(db, selector);
    if (id === undefined) return null;
    const row = db.prepare('SELECT signature FROM nodes WHERE id = ?').get(id) as { signature: string | null };
    return { symbol: nodeEvidence(db, capture.files, id), signature: row.signature?.slice(0, 4096) ?? null,
      signature_truncated: (row.signature?.length ?? 0) > 4096 };
  } finally {
    db.close();
  }
}

export function comparePublishedSnapshots(input: Record<string, unknown>): object {
  const params = object(input, ['before', 'after', 'selector', 'limit', 'offset']);
  const selected = params.selector === null ? null : object(params.selector, ['path', 'name']);
  const selector = selected === null ? null : { path: text(selected.path, 4096), name: text(selected.name, 256) };
  const window = windowOf(params);
  const before = resolveCapture(object(params.before, ['workspace', 'store', 'generation']));
  const after = resolveCapture(object(params.after, ['workspace', 'store', 'generation']));
  const touched = [...new Set([...before.files.keys(), ...after.files.keys()])].sort();
  let seen = 0;
  let unavailable = false;
  const files = [];
  for (const path of touched) {
    const left = before.files.get(path);
    const right = after.files.get(path);
    if ((left && (left.excluded !== null || left.sha256 === null))
        || (right && (right.excluded !== null || right.sha256 === null))) {
      unavailable = true;
      continue;
    }
    const before_sha256 = left?.sha256 ?? null;
    const after_sha256 = right?.sha256 ?? null;
    if (before_sha256 === after_sha256) continue;
    if (seen++ < window.offset) continue;
    files.push({ path, before_sha256, after_sha256 });
    if (files.length > window.limit) break;
  }
  const partial = [before, after].some(({ receipt }) =>
    receipt.coverage.errors || receipt.coverage.excluded || receipt.coverage.unsupported);
  const symbol_before = snapshotSymbol(before, selector);
  const symbol_after = snapshotSymbol(after, selector);
  const uncertainty = unavailable || partial ? ['partial_snapshot_coverage'] : [];
  if (symbol_before?.signature_truncated || symbol_after?.signature_truncated) uncertainty.push('truncated_signature');
  return { before: before.receipt, after: after.receipt, files: files.slice(0, window.limit),
    symbol_before, symbol_after,
    next_offset: nextOffset(window, files.length),
    uncertainty };
}
