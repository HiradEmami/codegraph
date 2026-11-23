import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { countContextTokens, tokenizerVersion, type ContextEncoding } from '../context/token-budget';
import {
  decodeRequest, encodeFrame, MAX_FRAME_BYTES, PROTOCOL_VERSION, readFrames, requestId, WireError,
} from './wire';

import { readGeneration, refreshGeneration } from './generations';

interface Session {
  negotiated: boolean;
}

const ENCODINGS = ['cl100k_base', 'o200k_base'] as const;
const CAPABILITIES = ['token_count', 'index_status', 'refresh_index'] as const;

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
