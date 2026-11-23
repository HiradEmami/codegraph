import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { serveStdio } from '../src/pelagion/stdio';
import { encodeFrame, MAX_FRAME_BYTES, readFrames } from '../src/pelagion/wire';
import fixture from './fixtures/pelagion-wire-v1.json';

async function collected(chunks: Buffer[]): Promise<unknown[]> {
  const decoded: unknown[] = [];
  for await (const record of readFrames(Readable.from(chunks))) decoded.push(record);
  return decoded;
}

async function exchange(messages: object[]): Promise<unknown[]> {
  const chunks: Buffer[] = [];
  const bytes = Buffer.concat(messages.map(encodeFrame));
  const input = Readable.from(Array.from(bytes, value => Buffer.from([value])));
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  await serveStdio(input, output);
  return collected(chunks);
}

describe('Pelagion stdio v1', () => {
  it('reads UTF-8 JSON across arbitrary stream chunks and preserves records in order', async () => {
    const message = { text: 'café 東京 😀\n' };
    const frame = encodeFrame(message);
    expect(frame.readUInt32BE(0)).toEqual(frame.length - 4);
    expect(await collected([frame.subarray(0, 2), Buffer.concat([frame.subarray(2), frame])])).toEqual([message, message]);
  });

  it('rejects invalid, oversized and truncated frames without treating them as EOF', async () => {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(MAX_FRAME_BYTES + 1);
    await expect(collected([size])).rejects.toMatchObject({ code: 'frame_size' });
    await expect(collected([Buffer.from([0, 0, 0, 1, 0xff])])).rejects.toMatchObject({ code: 'invalid_json' });
    await expect(collected([Buffer.from([0, 0, 0, 2, 0x7b])])).rejects.toMatchObject({ code: 'truncated_frame' });
  });

  it('uses the common fixture for version, negotiation, known encoding and exact count', async () => {
    expect(await exchange(fixture.exchanges.map(({ request }) => request)))
      .toEqual(fixture.exchanges.map(({ response }) => response));
  });
});
