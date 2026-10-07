// ============================================================
// BACKEND: src/services/zipStreamService.js — NEW FILE
// ------------------------------------------------------------
// Minimal, dependency-free ZIP writer that streams straight into
// an HTTP response. No npm package needed (nothing to install on
// the server).
//
// Entries are STORED (not compressed): invoice attachments are
// PDFs / JPGs / PNGs, which are already compressed, so deflating
// them again costs CPU for ~0% size gain.
//
// Limits: classic ZIP (no ZIP64) — max 65,535 entries and 4 GB
// total. Attachments are capped at a few MB each, so a bulk
// download is nowhere near either limit; both are still checked.
// ============================================================

// ── CRC-32 (IEEE) — table built once ───────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf) => {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// MS-DOS date/time, in IST so the times shown by Windows Explorer
// match the clock in the clinic.
const dosDateTime = (date = new Date()) => {
  const ist = new Date(date.getTime() + 330 * 60 * 1000);
  const time =
    (ist.getUTCHours() << 11) |
    (ist.getUTCMinutes() << 5) |
    Math.floor(ist.getUTCSeconds() / 2);
  const day =
    ((ist.getUTCFullYear() - 1980) << 9) |
    ((ist.getUTCMonth() + 1) << 5) |
    ist.getUTCDate();
  return { time, day };
};

const MAX_ENTRIES = 65535;
const MAX_BYTES = 0xffffffff;
const UTF8_FLAG = 0x0800; // names are UTF-8 (branch names can have any script)

// Write to a stream and respect back-pressure.
const writeChunk = (stream, chunk) =>
  new Promise((resolve, reject) => {
    if (stream.destroyed) return reject(new Error("Stream closed"));
    if (stream.write(chunk)) return resolve();
    const onDrain = () => {
      stream.off("error", onError);
      resolve();
    };
    const onError = (err) => {
      stream.off("drain", onDrain);
      reject(err);
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });

/**
 * Create a ZIP writer bound to a writable stream (e.g. Express `res`).
 *
 *   const zip = createZipStream(res);
 *   await zip.addDirectory("PMS_Attachments_2026-10-07/");
 *   await zip.addFile("PMS_Attachments_2026-10-07/a.pdf", buffer);
 *   await zip.finalize();
 */
const createZipStream = (output) => {
  const central = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  const addEntry = async (name, data) => {
    if (central.length >= MAX_ENTRIES)
      throw new Error("ZIP entry limit reached");
    const nameBuf = Buffer.from(name, "utf8");
    const size = data.length;
    const crc = size ? crc32(data) : 0;
    if (offset + 30 + nameBuf.length + size > MAX_BYTES)
      throw new Error("ZIP size limit (4 GB) reached");

    // Local file header
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    central.push({ nameBuf, crc, size, offset, isDir: name.endsWith("/") });

    await writeChunk(output, local);
    await writeChunk(output, nameBuf);
    if (size) await writeChunk(output, data);
    offset += 30 + nameBuf.length + size;
  };

  const addDirectory = (name) =>
    addEntry(name.endsWith("/") ? name : `${name}/`, Buffer.alloc(0));

  const addFile = (name, data) => addEntry(name, data);

  const finalize = async () => {
    const cdStart = offset;
    let cdSize = 0;

    for (const e of central) {
      const rec = Buffer.alloc(46);
      rec.writeUInt32LE(0x02014b50, 0);
      rec.writeUInt16LE(20, 4); // version made by
      rec.writeUInt16LE(20, 6); // version needed
      rec.writeUInt16LE(UTF8_FLAG, 8);
      rec.writeUInt16LE(0, 10); // stored
      rec.writeUInt16LE(time, 12);
      rec.writeUInt16LE(day, 14);
      rec.writeUInt32LE(e.crc, 16);
      rec.writeUInt32LE(e.size, 20);
      rec.writeUInt32LE(e.size, 24);
      rec.writeUInt16LE(e.nameBuf.length, 28);
      rec.writeUInt16LE(0, 30); // extra
      rec.writeUInt16LE(0, 32); // comment
      rec.writeUInt16LE(0, 34); // disk
      rec.writeUInt16LE(0, 36); // internal attrs
      rec.writeUInt32LE(e.isDir ? 0x10 : 0, 38); // external attrs (dir bit)
      rec.writeUInt32LE(e.offset, 42);
      await writeChunk(output, rec);
      await writeChunk(output, e.nameBuf);
      cdSize += 46 + e.nameBuf.length;
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    end.writeUInt16LE(0, 20);
    await writeChunk(output, end);
    output.end();
  };

  return { addDirectory, addFile, finalize };
};

module.exports = { createZipStream, crc32 };
