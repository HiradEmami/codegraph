import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { countContextTokens, tokenizerVersion, type ContextEncoding } from '../context/token-budget';
import {
  decodeRequest, encodeFrame, MAX_FRAME_BYTES, PROTOCOL_VERSION, readFrames, requestId, WireError,
} from './wire';

import { readGeneration, readPublishedSource, refreshGeneration, searchPublishedSymbols } from './generations';

import { comparePublishedSnapshots, GRAPH_OPERATIONS, readRelationships } from './relationships';

interface Session {
  negotiated: boolean;
}

const ENCODINGS = ['cl100k_base', 'o200k_base'] as const;
const CAPABILITIES = [
  'token_count', 'index_status', 'refresh_index', 'search_symbols', 'read_source',
  ...GRAPH_OPERATIONS, 'compare_snapshots',
] as const;
const DIGEST = /^[0-9a-f]{64}$/;

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value);
}

function validRange(value: unknown): value is Parameters<typeof readPublishedSource>[3] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 4
    && typeof row.path === 'string' && row.path.length > 0 && row.path.length <= 4096
    && validDigest(row.sha256)
    && typeof row.start_line === 'number' && typeof row.end_line === 'number'
    && Number.isSafeInteger(row.start_line) && Number.isSafeInteger(row.end_line)
    && row.start_line >= 1 && row.end_line >= row.start_line;
}

async function evaluate(session: Session, method: string, params: Record<string, unknown>): Promise<object> {
  if (method === 'hello') {
    const versions = params.versions;
    if (Object.keys(params).length !== 1 || !Array.isArray(versions)
        || !versions.length || versions.length > 16 || !versions.every(Number.isSafeInteger)) {
      throw new WireError('invalid_parameters', 'Provide a list of supported protocol versions.');
    }
    if (!versions.includes(PROTOCOL_VERSION)) {
      throw new WireError('unsupported_version', 'The client and engine have no common protocol version.');
    }
    session.negotiated = true;
    return { version: PROTOCOL_VERSION, maxFrameBytes: MAX_FRAME_BYTES, capabilities: CAPABILITIES, encodings: ENCODINGS };
  }
  if (!session.negotiated) {
    throw new WireError('not_negotiated', 'Send hello before requesting an operation.');
  }
  if (method === 'index_status' || method === 'refresh_index') {
    const { workspace, store, rebuild } = params;
    if (typeof workspace !== 'string' || typeof store !== 'string'
        || Object.keys(params).some(key => !['workspace', 'store', 'rebuild'].includes(key))
        || (method === 'index_status' && rebuild !== undefined)
        || (rebuild !== undefined && typeof rebuild !== 'boolean')) {
      throw new WireError('invalid_parameters', 'Provide an explicit workspace and generation store.');
    }
    if (method === 'index_status') return { generation: readGeneration(workspace, store) };
    const packageData = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
    const suffix = packageData.pelagionArtifactCommit ? '+pelagion.' + packageData.pelagionArtifactCommit : '';
    return { generation: await refreshGeneration(workspace, store, packageData.version + suffix, { rebuild }) };
  }
  if (method === 'search_symbols' || method === 'read_source') {
    const { workspace, store, generation } = params;
    if (typeof workspace !== 'string' || typeof store !== 'string' || !validDigest(generation)) {
      throw new WireError('invalid_parameters', 'Select a workspace, store and generation.');
    }
    if (method === 'read_source') {
      if (Object.keys(params).length !== 4 || !validRange(params.source)) {
        throw new WireError('invalid_parameters', 'Select a source range and digest.');
      }
      return readPublishedSource(workspace, store, generation, params.source);
    }
    const { query, limit } = params;
    if (Object.keys(params).length !== 5 || typeof query !== 'string'
        || query.length < 1 || query.length > 256 || typeof limit !== 'number'
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new WireError('invalid_parameters', 'Select a bounded symbol query.');
    }
    return await searchPublishedSymbols(workspace, store, generation, query, limit);
  }
  if (method === 'compare_snapshots') return comparePublishedSnapshots(params);
  const graphOperation = GRAPH_OPERATIONS.find(operation => operation === method);
  if (graphOperation !== undefined) return readRelationships(graphOperation, params);
  if (method !== 'token_count') {
    throw new WireError('unsupported_operation', 'The requested operation is unavailable.');
  }
  const { text, encoding } = params;
  if (Object.keys(params).length !== 2 || typeof text !== 'string' || /\p{Surrogate}/u.test(text)
      || typeof encoding !== 'string' || !ENCODINGS.includes(encoding as ContextEncoding)) {
    throw new WireError('invalid_parameters', 'Provide valid UTF-8 text and a negotiated encoding.');
  }
  return {
    encoding,
    implementation: 'js-tiktoken',
    implementationVersion: tokenizerVersion(),
    count: countContextTokens(text, encoding as ContextEncoding),
  };
}

function errorResponse(id: string | null, error: unknown): object {
  const { code, message } = error instanceof WireError
    ? error
    : { code: 'internal_error', message: 'The engine could not complete the operation.' };
  return { version: PROTOCOL_VERSION, id, error: { code, message } };
}

/** One connection handles requests in order. A framing error ends the connection. */
export async function serveStdio(input: Readable, output: Writable): Promise<void> {
  const session: Session = { negotiated: false };
  const send = async (value: object): Promise<void> => {
    if (!output.write(encodeFrame(value))) await once(output, 'drain');
  };
  try {
    for await (const data of readFrames(input)) {
      let response: object;
      try {
        const request = decodeRequest(data);
        response = {
          version: PROTOCOL_VERSION,
          id: request.id,
          result: await evaluate(session, request.method, request.params),
        };
      } catch (error) {
        response = errorResponse(requestId(data), error);
      }
      await send(response);
    }
  } catch (error) {
    if (!(error instanceof WireError)) throw error;
    await send(errorResponse(null, error));
  }
}
