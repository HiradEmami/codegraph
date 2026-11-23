import { TextDecoder } from 'node:util';

export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 1024 * 1024;

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export class WireError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** Bounded, streaming four-byte big-endian UTF-8 JSON framing. */
export async function* readFrames(input: AsyncIterable<Buffer>): AsyncGenerator<unknown> {
  const header = Buffer.alloc(4);
  let headerBytes = 0;
  let body: Buffer | undefined;
  let bodyBytes = 0;
  for await (const chunk of input) {
    let offset = 0;
    while (offset < chunk.length) {
      if (!body) {
        const headerEnd = Math.min(chunk.length, offset + header.length - headerBytes);
        headerBytes += chunk.copy(header, headerBytes, offset, headerEnd);
        offset = headerEnd;
        if (headerBytes < header.length) continue;
        const size = header.readUInt32BE(0);
        if (!size || size > MAX_FRAME_BYTES) {
          throw new WireError('frame_size', 'Invalid protocol frame size.');
        }
        body = Buffer.alloc(size);
        bodyBytes = 0;
      }
      const bodyEnd = Math.min(chunk.length, offset + body.length - bodyBytes);
      bodyBytes += chunk.copy(body, bodyBytes, offset, bodyEnd);
      offset = bodyEnd;
      if (bodyBytes === body.length) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(decoder.decode(body));
        } catch {
          throw new WireError('invalid_json', 'Expected a UTF-8 JSON payload.');
        }
        body = undefined;
        headerBytes = 0;
        yield parsed;
      }
    }
  }
  if (headerBytes) throw new WireError('truncated_frame', 'Input ended inside a protocol frame.');
}

export function encodeFrame(value: object): Buffer {
  const text = Buffer.from(JSON.stringify(value), 'utf-8');
  if (!text.length || text.length > MAX_FRAME_BYTES) {
    throw new WireError('frame_size', 'Invalid protocol frame size.');
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(text.length);
  return Buffer.concat([header, text], header.length + text.length);
}

export function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export interface OperationRequest {
  version: typeof PROTOCOL_VERSION;
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export function requestId(data: unknown): string | null {
  const id = asObject(data)?.id;
  return typeof id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(id) ? id : null;
}

export function decodeRequest(data: unknown): OperationRequest {
  const record = asObject(data);
  const id = requestId(record);
  if (!record || id === null || typeof record.method !== 'string'
      || !asObject(record.params) || !Number.isSafeInteger(record.version)
      || Object.keys(record).length !== 4) {
    throw new WireError('invalid_request', 'Expected a version, request ID, method and parameter object.');
  }
  if (record.version !== PROTOCOL_VERSION) {
    throw new WireError('unsupported_version', 'Requested protocol version is unavailable.');
  }
  return { version: PROTOCOL_VERSION, id, method: record.method, params: record.params as Record<string, unknown> };
}
