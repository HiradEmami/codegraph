/** Stage index changes privately and publish one coherent, immutable generation. */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { CodeGraph } from '../index';
import { CURRENT_SCHEMA_VERSION } from '../db/migrations';
import { createDatabase, type SqliteDatabase } from '../db/sqlite-adapter';
import { EXTRACTION_VERSION } from '../extraction/extraction-version';
import { scanDirectoryAsync } from '../extraction';
import { MAX_SOURCE_FILE_SIZE_BYTES, oversizeStamp } from '../file-limits';
import { loadExcludePatterns, loadIncludeIgnoredPatterns, loadIncludePatterns } from '../project-config';
import { WireError } from './wire';

const GENERATION_SCHEMA = 1;
const RESOLVER_VERSION = 1;
const LOCATION = /^g-[0-9a-f]{32}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const CONFIG_NAMES = [
  '.gitignore', '.codegraphignore', 'codegraph.json', 'pyproject.toml', 'setup.cfg',
  'setup.py', 'package.json', 'tsconfig.json', 'jsconfig.json', 'Cargo.toml',
];
const SETTINGS = ['CODEGRAPH_KERNEL', 'CODEGRAPH_MAX_FILE_SIZE_BYTES', 'CODEGRAPH_DIR'];

interface SourceFile {
  path: string;
  sha256: string | null;
  bytes: number;
  excluded: 'oversize' | 'nonregular' | null;
}

interface SourceCapture {
  files: SourceFile[];
  textHashes: Map<string, string>;
  configuration: SourceFile[];
  ignoredExtensions: [string, number][];
  exclusions: { exclude: string[]; include: string[]; includeIgnored: string[]; settings: string };
}

interface GenerationFacts {
  schemaVersion: number;
  engineVersion: string;
  extractionVersion: number;
  resolverVersion: number;
  databaseSchema: number;
  sourceDigest: string;
  configurationDigest: string;
  graphDigest: string;
  coverage: { discovered: number; indexed: number; excluded: number; errors: number; unsupported: number };
}

export interface GenerationReceipt extends GenerationFacts {
  generation: string;
}

interface CurrentGeneration {
  location: string;
  fingerprint: string;
  receipt: GenerationReceipt;
}

interface StagingOptions {
  rebuild?: boolean;
  /** A test-only observation of a written candidate before publication. */
  beforePublish?: () => Promise<void> | void;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sortNames(names: Iterable<string>): string[] {
  return Array.from(new Set(names)).sort();
}

function plainDirectory(location: string): string {
  if (!path.isAbsolute(location)) {
    throw new WireError('invalid_parameters', 'Workspace and store directories must be absolute.');
  }
  const selected = path.resolve(location);
  const canonical = fs.realpathSync(selected);
  if (!fs.lstatSync(selected).isDirectory() || path.relative(selected, canonical) !== '') {
    throw new WireError('invalid_parameters', 'Select an existing ordinary directory.');
  }
  return canonical;
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

function verifyFile(file: string, allowMissing = false): boolean {
  try {
    if (!fs.lstatSync(file).isFile() || path.relative(file, fs.realpathSync(file)) !== '') {
      throw new WireError('invalid_generation', 'The generation file is outside the admitted store layout.');
    }
    return true;
  } catch (error) {
    if (allowMissing && typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function captureFile(root: string, relative: string, limit: number): { evidence: SourceFile; textHash?: string } {
  const selected = path.resolve(root, relative);
  if (!contains(root, selected) || selected === root) {
    throw new WireError('invalid_source', 'A source path is outside the explicit workspace.');
  }
  const before = fs.lstatSync(selected);
  if (!before.isFile() || path.relative(selected, fs.realpathSync(selected)) !== '') {
    return { evidence: { path: relative, sha256: null, bytes: before.size, excluded: 'nonregular' } };
  }
  if (before.size > limit) {
    return {
      evidence: { path: relative, sha256: null, bytes: before.size, excluded: 'oversize' },
      textHash: sha256(oversizeStamp(before.size)),
    };
  }
  const handle = fs.openSync(selected, 'r');
  try {
    // Read at most the admitted size plus one byte to detect a growing file.
    const data = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < data.length) {
      const count = fs.readSync(handle, data, length, data.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const after = fs.fstatSync(handle);
    const end = fs.lstatSync(selected);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || before.ino !== end.ino || after.ino !== end.ino || after.dev !== end.dev
        || end.mtimeMs !== after.mtimeMs || !end.isFile()) {
      throw new WireError('source_changed', 'The workspace changed during index refresh.');
    }
    const body = data.subarray(0, length);
    return {
      evidence: { path: relative, sha256: sha256(body), bytes: length, excluded: null },
      textHash: sha256(body.toString('utf8')),
    };
  } finally {
    fs.closeSync(handle);
  }
}

async function observe(root: string): Promise<SourceCapture> {
  const scan = { unsupportedByExtension: new Map<string, number>() };
  const names = sortNames(await scanDirectoryAsync(root, undefined, scan));
  const files: SourceFile[] = [];
  const textHashes = new Map<string, string>();
  const directories = new Set<string>(['.']);
  for (const relative of names) {
    const item = captureFile(root, relative, MAX_SOURCE_FILE_SIZE_BYTES);
    files.push(item.evidence);
    if (item.textHash !== undefined) textHashes.set(relative, item.textHash);
    let directory = path.posix.dirname(relative);
    while (directory !== '.' && !directories.has(directory)) {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  const configuration: SourceFile[] = [];
  for (const directory of sortNames(directories)) {
    for (const name of CONFIG_NAMES) {
      const relative = path.posix.join(directory, name);
      const selected = path.resolve(root, relative);
      if (!fs.existsSync(selected)) continue;
      const captured = captureFile(root, relative, 1_048_576).evidence;
      if (captured.excluded !== null) {
        throw new WireError('configuration_unavailable', 'A configuration file is outside the admitted profile.');
      }
      configuration.push(captured);
    }
  }
  return {
    files,
    textHashes,
    configuration,
    ignoredExtensions: [...scan.unsupportedByExtension.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    exclusions: {
      exclude: loadExcludePatterns(root),
      include: loadIncludePatterns(root),
      includeIgnored: loadIncludeIgnoredPatterns(root),
      settings: sha256(JSON.stringify(SETTINGS.map(name => [name, process.env[name] ?? null]))),
    },
  };
}

function evidence(source: SourceCapture): Pick<GenerationFacts, 'sourceDigest' | 'configurationDigest'> {
  return {
    sourceDigest: sha256(JSON.stringify([source.files, source.ignoredExtensions])),
    configurationDigest: sha256(JSON.stringify([source.configuration, source.exclusions])),
  };
}

function graphDigest(databasePath: string): string {
  const { db } = createDatabase(databasePath, { readOnly: true });
  const digest = createHash('sha256');
  const tables = [
    ['nodes', 'id, kind, name, qualified_name, file_path, language, start_line, end_line, start_column, end_column, docstring, signature, visibility, is_exported, is_async, is_static, is_abstract, decorators, type_parameters, return_type'],
    ['edges', 'source, target, kind, line, col, provenance, metadata'],
    ['unresolved_refs', 'from_node_id, reference_name, reference_kind, line, col, candidates, file_path, language, status, name_tail'],
  ] as const;
  try {
    for (const [table, fields] of tables) {
      digest.update(table + '\n');
      for (const row of db.prepare('SELECT ' + fields + ' FROM ' + table + ' ORDER BY ' + fields).iterate()) {
        digest.update(JSON.stringify(row) + '\n');
      }
    }
    return digest.digest('hex');
  } finally {
    db.close();
  }
}

function current(db: SqliteDatabase, workspace: string): CurrentGeneration | null {
  const row = db.prepare('SELECT workspace, manifest FROM current_generation WHERE slot = 1').get() as
    { workspace: string; manifest: string } | undefined;
  if (row === undefined) return null;
  if (row.workspace !== workspace) {
    throw new WireError('workspace_mismatch', 'The selected store belongs to a different workspace.');
  }
  try {
    const result = JSON.parse(row.manifest) as CurrentGeneration;
    const { generation, ...facts } = result.receipt;
    if (LOCATION.test(result.location) && DIGEST.test(result.fingerprint) && sha256(JSON.stringify(facts)) === generation) {
      return result;
    }
  } catch {
    // Raw parser errors can include workspace or metadata content.
  }
  throw new WireError('invalid_generation', 'The published generation metadata is invalid.');
}

function publisher(store: string): SqliteDatabase {
  const metadata = path.join(store, 'generations.sqlite3');
  verifyFile(metadata, true);
  const { db } = createDatabase(metadata);
  try {
    db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    db.exec('CREATE TABLE IF NOT EXISTS current_generation (slot INTEGER PRIMARY KEY, workspace TEXT NOT NULL, manifest TEXT NOT NULL)');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function readGeneration(workspaceInput: string, storeInput: string): GenerationReceipt | null {
  const workspace = plainDirectory(workspaceInput);
  const store = plainDirectory(storeInput);
  const metadata = path.join(store, 'generations.sqlite3');
  if (!verifyFile(metadata, true)) return null;
  const { db } = createDatabase(metadata, { readOnly: true });
  try {
    return current(db, workspace)?.receipt ?? null;
  } finally {
    db.close();
  }
}

export async function openPublishedGraph(workspaceInput: string, storeInput: string): Promise<CodeGraph> {
  const workspace = plainDirectory(workspaceInput);
  const store = plainDirectory(storeInput);
  const metadata = path.join(store, 'generations.sqlite3');
  if (!verifyFile(metadata, true)) throw new WireError('index_missing', 'No generation has been published.');
  const { db } = createDatabase(metadata, { readOnly: true });
  try {
    const published = current(db, workspace);
    if (!published) throw new WireError('index_missing', 'No generation has been published.');
    const directory = plainDirectory(path.join(store, published.location));
    if (path.dirname(directory) !== store) throw new WireError('invalid_generation', 'The published generation is invalid.');
    const databasePath = path.join(directory, 'graph.sqlite3');
    verifyFile(databasePath);
    return await CodeGraph.openGeneration(workspace, databasePath, 'read');
  } finally {
    db.close();
  }
}

export async function refreshGeneration(
  workspaceInput: string,
  storeInput: string,
  engineVersion: string,
  options: StagingOptions = {},
): Promise<GenerationReceipt> {
  const workspace = plainDirectory(workspaceInput);
  const store = plainDirectory(storeInput);
  if (contains(workspace, store) || contains(store, workspace)) {
    throw new WireError('invalid_parameters', 'Keep the generation store separate from the workspace.');
  }
  const db = publisher(store);
  let graph: CodeGraph | undefined;
  try {
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch {
      throw new WireError('index_busy', 'Another refresh owns the generation store.');
    }
    const previous = current(db, workspace);
    const before = await observe(workspace);
    const observed = evidence(before);
    const fingerprint = sha256(JSON.stringify([
      GENERATION_SCHEMA, engineVersion, EXTRACTION_VERSION, RESOLVER_VERSION, CURRENT_SCHEMA_VERSION,
    ]));
    const canIncrement = !options.rebuild && previous !== null && previous.fingerprint === fingerprint;
    const location = 'g-' + randomUUID().replaceAll('-', '');
    const directory = path.join(store, location);
    fs.mkdirSync(directory);
    const databasePath = path.join(directory, 'graph.sqlite3');
    if (canIncrement) {
      const old = plainDirectory(path.join(store, previous.location));
      if (path.dirname(old) !== store) throw new WireError('invalid_generation', 'The published generation is invalid.');
      const previousDatabase = path.join(old, 'graph.sqlite3');
      verifyFile(previousDatabase);
      fs.copyFileSync(previousDatabase, databasePath, fs.constants.COPYFILE_EXCL);
    }
    graph = await CodeGraph.openGeneration(workspace, databasePath, canIncrement ? 'update' : 'create');
    if (canIncrement) {
      const sync = await graph.sync();
      if (sync.failedFilePaths?.length) throw new WireError('index_incomplete', 'One or more changed files could not be indexed.');
    } else {
      const indexed = await graph.indexAll();
      if (!indexed.success) throw new WireError('index_incomplete', 'The source index did not complete.');
    }
    if (graph.getIndexState() !== 'complete') throw new WireError('index_incomplete', 'The source index did not complete.');
    const after = await observe(workspace);
    const verified = evidence(after);
    if (observed.sourceDigest !== verified.sourceDigest || observed.configurationDigest !== verified.configurationDigest) {
      throw new WireError('source_changed', 'The workspace changed during index refresh.');
    }
    const records = graph.getFiles();
    const discovered = new Map(after.files.map(file => [file.path, file]));
    const tracked = new Set(records.map(file => file.path));
    for (const file of records) {
      if (!discovered.has(file.path) || after.textHashes.get(file.path) !== file.contentHash) {
        throw new WireError('index_incomplete', 'Indexed content does not match the observed workspace.');
      }
    }
    if (after.files.some(file => file.excluded === null && !tracked.has(file.path))) {
      throw new WireError('index_incomplete', 'The index omitted an admitted source file.');
    }
    graph.sealGeneration();
    graph = undefined;
    const facts: GenerationFacts = {
      schemaVersion: GENERATION_SCHEMA,
      engineVersion,
      extractionVersion: EXTRACTION_VERSION,
      resolverVersion: RESOLVER_VERSION,
      databaseSchema: CURRENT_SCHEMA_VERSION,
      ...verified,
      graphDigest: graphDigest(databasePath),
      coverage: {
        discovered: after.files.length,
        indexed: records.filter(row => discovered.get(row.path)?.excluded === null
          && !row.errors?.some(error => error.severity === 'error')).length,
        excluded: after.files.filter(file => file.excluded !== null).length,
        errors: records.reduce((sum, row) => sum + (row.errors?.length ?? 0), 0),
        unsupported: after.ignoredExtensions.reduce((sum, [, count]) => sum + count, 0),
      },
    };
    const receipt = { ...facts, generation: sha256(JSON.stringify(facts)) };
    const payload = {
      receipt, files: after.files, configuration: after.configuration,
      exclusions: after.exclusions, ignoredExtensions: after.ignoredExtensions,
    };
    const manifest = fs.openSync(path.join(directory, 'manifest.json'), 'wx');
    try {
      fs.writeFileSync(manifest, JSON.stringify(payload) + '\n');
      fs.fsyncSync(manifest);
    } finally {
      fs.closeSync(manifest);
    }
    const handle = fs.openSync(databasePath, 'r+');
    try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }

    await options.beforePublish?.();
    const published: CurrentGeneration = { location, fingerprint, receipt };
    db.prepare('INSERT OR REPLACE INTO current_generation(slot, workspace, manifest) VALUES (1, ?, ?)')
      .run(workspace, JSON.stringify(published));
    db.exec('COMMIT');
    return receipt;
  } finally {
    graph?.close();
    db.close(); // An uncommitted publisher leaves the old row readable.
  }
}
