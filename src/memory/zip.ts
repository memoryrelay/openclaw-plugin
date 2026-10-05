// src/memory/zip.ts
//
// Just enough of the zip format to read an ICM release export: the API writes
// it with Python's zipfile, every entry stored or deflated, no zip64, no
// encryption. Reads the central directory, so local-header sizes written after
// the data (data descriptors) do not matter.

import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** Every regular file in the archive, as UTF-8 text keyed by its path. */
export function readZipText(data: Uint8Array): Map<string, string> {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  // The end-of-central-directory record is the last 22 bytes plus a comment of
  // at most 65535 bytes; scan back for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const entries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  const files = new Map<string, string>();
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error("corrupt zip central directory");
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;
    if (buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`corrupt zip entry ${name}`);
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compressedSize);
    if (method === 0) files.set(name, raw.toString("utf8"));
    else if (method === 8) files.set(name, inflateRawSync(raw).toString("utf8"));
    else throw new Error(`unsupported zip compression ${method} for ${name}`);
  }
  return files;
}
