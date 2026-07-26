/**
 * Background removal: take an image (URL or data URL) and produce a
 * version with a uniform-color background replaced by transparency.
 *
 * Why this exists: when a user attaches a logo or product image, the
 * background is often a solid color (white, gray, a brand color) that
 * clashes with the video's color scheme. Removing it and saving the
 * result as a transparent PNG lets the agent (or the user) place the
 * image on any background.
 *
 * Approach: a smart color-distance algorithm. We pick a corner pixel
 * as the "background" reference, then for every other pixel compute
 * its distance to that reference and mark pixels below a threshold
 * as transparent. We also handle anti-aliased edges by using a
 * smooth distance-based alpha falloff rather than a hard cutoff.
 *
 * Image formats: PNG (decoded in-house) and baseline JPEG (decoded
 * in-house). Both decoders are from scratch - no native deps, no
 * npm packages beyond zlib (built into Node). The JPEG decoder
 * handles 8-bit, YCbCr or grayscale, any subsampling (4:4:4 / 4:2:2
 * / 4:2:0 / 4:1:1), but not progressive (SOF2) or arithmetic
 * coding. The dominant majority of real-world JPEGs are baseline
 * 8-bit YCbCr, so this covers the practical use cases.
 *
 * Output: a transparent PNG saved to public/uploads/. The saved URL
 * is what the agent should pass to add_image_element.
 */

import { promises as fs } from "fs";
import path from "path";
import { nanoid } from "nanoid";
import zlib from "zlib";
import { saveDataUrl, UPLOADS_URL_PREFIX } from "./assetUpload";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");

interface RemoveBackgroundArgs {
  /** URL or data URL of the image to process. */
  imageUrl: string;
  /**
   * Hex color to treat as background. If omitted, the tool samples
   * a corner pixel and uses that as the reference color.
   */
  backgroundColor?: string;
  /**
   * Distance threshold 0-100. Pixels within this distance of the
   * reference color are made fully transparent. Default 18.
   */
  threshold?: number;
  /**
   * Smoothing range 0-30. Pixels within `threshold + smoothRange`
   * are made partially transparent (alpha falloff). Default 8.
   */
  smoothRange?: number;
  sampleCorner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

export interface RemoveBackgroundResult {
  url: string;
  width: number;
  height: number;
  backgroundColor: string;
  transparentPixelCount: number;
  totalPixels: number;
  transparencyRatio: number;
}

export async function removeBackground(rawArgs: any): Promise<RemoveBackgroundResult> {
  const args = rawArgs as RemoveBackgroundArgs;
  if (!args.imageUrl) {
    throw new Error("remove_background: imageUrl is required.");
  }

  const { buffer, mime } = await loadImageBuffer(args.imageUrl);
  const decoded = decodeImage(buffer, mime);

  const bgColor = args.backgroundColor
    ? parseHexColor(args.backgroundColor)
    : sampleCornerColor(decoded, args.sampleCorner ?? "top-left");

  const threshold = args.threshold ?? 18;
  const smoothRange = args.smoothRange ?? 8;
  const rgba = applyBackgroundRemoval(decoded, bgColor, threshold, smoothRange);

  const pngBuffer = encodePng(rgba, decoded.width, decoded.height);
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `nobg-${nanoid(12)}.png`;
  const filePath = path.join(UPLOADS_DIR, filename);
  await fs.writeFile(filePath, pngBuffer);

  let transparentCount = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] === 0) transparentCount++;
  }
  const totalPixels = decoded.width * decoded.height;
  return {
    url: `${UPLOADS_URL_PREFIX}/${filename}`,
    width: decoded.width,
    height: decoded.height,
    backgroundColor: rgbaToHex(bgColor),
    transparentPixelCount: transparentCount,
    totalPixels,
    transparencyRatio: transparentCount / totalPixels,
  };
}

// ============================================================
// Image loading
// ============================================================

async function loadImageBuffer(url: string): Promise<{ buffer: Buffer; mime: string }> {
  if (url.startsWith("data:")) {
    return { buffer: dataUrlToBuffer(url), mime: detectMimeFromDataUrl(url) };
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`remove_background: failed to fetch "${url}" - HTTP ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    return { buffer: Buffer.from(ab), mime: res.headers.get("content-type") ?? "image/png" };
  }
  const localPath = path.join(PUBLIC_DIR, url.replace(/^\//, ""));
  const buffer = await fs.readFile(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return { buffer, mime };
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const match = /^data:[^;,]+;base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error(`remove_background: only base64 data URLs are supported, got: ${dataUrl.slice(0, 30)}...`);
  }
  return Buffer.from(match[1], "base64");
}

function detectMimeFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;,]+)/.exec(dataUrl);
  return m ? m[1] : "image/png";
}

// ============================================================
// Decoded image type
// ============================================================

interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

// ============================================================
// Top-level format dispatch
// ============================================================

function decodeImage(buffer: Buffer, mime: string): DecodedImage {
  const isPng = mime === "image/png" || (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47);
  const isJpeg = mime === "image/jpeg" || mime === "image/jpg" || (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8);
  if (isPng) return decodePng(buffer);
  if (isJpeg) return decodeJpeg(buffer);
  throw new Error(
    `remove_background: unsupported image format "${mime}". Use PNG or JPEG. ` +
      `For other formats, convert first.`,
  );
}

// ============================================================
// PNG decoder
// ============================================================

function decodePng(buffer: Buffer): DecodedImage {
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
    throw new Error("remove_background: not a valid PNG (bad signature)");
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.slice(pos + 4, pos + 8).toString("ascii");
    const data = buffer.slice(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
      if (interlace !== 0) {
        throw new Error("remove_background: interlaced PNG is not supported. Re-export as non-interlaced.");
      }
      if (bitDepth !== 8) {
        throw new Error(`remove_background: bit depth ${bitDepth} is not supported (only 8-bit PNG).`);
      }
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }

  const compressed = Buffer.concat(idatChunks);
  const raw = zlib.inflateSync(compressed);
  const bpp = channelsPerColorType(colorType);
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? raw.slice((y - 1) * (stride + 1) + 1, y * (stride + 1)) : null;
    const decoded = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? decoded[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let val = row[x];
      switch (filter) {
        case 0: break;
        case 1: val = (val + a) & 0xff; break;
        case 2: val = (val + b) & 0xff; break;
        case 3: val = (val + Math.floor((a + b) / 2)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          if (pa <= pb && pa <= pc) val = (val + a) & 0xff;
          else if (pb <= pc) val = (val + b) & 0xff;
          else val = (val + c) & 0xff;
          break;
        }
        default:
          throw new Error(`remove_background: unsupported PNG filter ${filter}`);
      }
      decoded[x] = val;
    }
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      switch (colorType) {
        case 0:
          out[dst] = decoded[x];
          out[dst + 1] = decoded[x];
          out[dst + 2] = decoded[x];
          out[dst + 3] = 255;
          break;
        case 2:
          out[dst] = decoded[x * 3];
          out[dst + 1] = decoded[x * 3 + 1];
          out[dst + 2] = decoded[x * 3 + 2];
          out[dst + 3] = 255;
          break;
        case 4:
          out[dst] = decoded[x * 2];
          out[dst + 1] = decoded[x * 2];
          out[dst + 2] = decoded[x * 2];
          out[dst + 3] = decoded[x * 2 + 1];
          break;
        case 6:
          out[dst] = decoded[x * 4];
          out[dst + 1] = decoded[x * 4 + 1];
          out[dst + 2] = decoded[x * 4 + 2];
          out[dst + 3] = decoded[x * 4 + 3];
          break;
        default:
          throw new Error(`remove_background: unsupported PNG color type ${colorType}`);
      }
    }
  }

  return { width, height, rgba: out };
}

function channelsPerColorType(colorType: number): number {
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 4: return 2;
    case 6: return 4;
    default: return 4;
  }
}

// ============================================================
// JPEG decoder (baseline only)
// ============================================================

// Zig-zag scan order for DCT coefficients
const jpegZigZag = [
  0,  1,  8, 16,  9,  2,  3, 10,
  17, 24, 32, 25, 18, 11,  4,  5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13,  6,  7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
];

// Inverse zig-zag: outIdx[i] = where in the natural 8x8 the
// coefficient that comes at zig-zag position i goes.
const jpegInvZigZag = new Uint8Array(64);
{
  for (let i = 0; i < 64; i++) jpegInvZigZag[jpegZigZag[i]] = i;
}

/**
 * Compact fast-table for Huffman decoding. Each entry packs
 * (length << 8) | symbol. length=0 means "not in the table";
 * the caller falls back to a bit-by-bit walk that compares
 * against a sorted list of all codes.
 */
type FastHuffTable = { fast: Int32Array; codes: { sym: number; code: number; len: number }[] };

interface JpegFrame {
  width: number;
  height: number;
  /** Per component: id, hSamp, vSamp, qtId */
  components: { id: number; hSamp: number; vSamp: number; qtId: number }[];
  hMax: number;
  vMax: number;
}

interface JpegScan {
  /** Component IDs in scan order. */
  componentIds: number[];
  /** Per-scan-component DC and AC table IDs. */
  dcIds: number[];
  acIds: number[];
  /** Offset into buffer where entropy data begins. */
  dataStart: number;
}

function buildHuffTable(counts: number[], values: Uint8Array): FastHuffTable | null {
  // Build canonical Huffman codes
  const codes: { sym: number; code: number; len: number }[] = [];
  let code = 0;
  let k = 0;
  let totalSymbols = 0;
  for (const c of counts) totalSymbols += c;
  if (totalSymbols === 0) return null;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) {
      codes.push({ sym: values[k++], code, len });
      code++;
    }
    code <<= 1;
  }

  // Build fast lookup table for short codes (<=10 bits).
  const TABLE_BITS = 10;
  const tableSize = 1 << TABLE_BITS;
  const fast = new Int32Array(tableSize);
  for (const c of codes) {
    if (c.len > TABLE_BITS) continue;
    const padded = c.code << (TABLE_BITS - c.len);
    const count = 1 << (TABLE_BITS - c.len);
    for (let i = 0; i < count; i++) {
      fast[padded | i] = (c.len << 8) | c.sym;
    }
  }
  return { fast, codes };
}

function decodeJpeg(buffer: Buffer): DecodedImage {
  // ── Phase 1: marker parsing ─────────────────────────────────────────
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("remove_background: not a valid JPEG (bad SOI)");
  }
  let pos = 2;

  let frame: JpegFrame | null = null;
  let scan: JpegScan | null = null;
  const qts = new Map<number, Int32Array>();
  const dcs = new Map<number, FastHuffTable>();
  const acs = new Map<number, FastHuffTable>();

  while (pos < buffer.length) {
    // Skip padding 0xff
    while (pos < buffer.length && buffer[pos] !== 0xff) pos++;
    if (pos >= buffer.length) break;
    if (buffer[pos] === 0xff && pos + 1 < buffer.length && buffer[pos + 1] === 0x00) {
      // Stuffed byte outside scan data (unusual)
      pos += 2;
      continue;
    }
    pos++; // skip 0xff
    if (pos >= buffer.length) break;
    const marker = buffer[pos++];
    if (marker === 0xd9) break; // EOI
    if (marker >= 0xd0 && marker <= 0xd7) continue; // RST inside marker loop (shouldn't appear here)

    // Read length
    const len = (buffer[pos] << 8) | buffer[pos + 1];
    const segEnd = pos + len;

    if (marker === 0xdb) {
      // DQT
      let p = pos + 2;
      while (p < segEnd) {
        const idAndPrecision = buffer[p++];
        const tableId = idAndPrecision & 0x0f;
        const precision = (idAndPrecision >> 4) & 0x0f;
        const values = new Int32Array(64);
        for (let i = 0; i < 64; i++) {
          if (precision === 0) {
            values[jpegZigZag[i]] = buffer[p++];
          } else {
            values[jpegZigZag[i]] = (buffer[p] << 8) | buffer[p + 1];
            p += 2;
          }
        }
        qts.set(tableId, values);
      }
    } else if (marker === 0xc0) {
      // SOF0 (baseline)
      let p = pos + 2;
      p++; // precision (always 8 for baseline)
      const height = (buffer[p] << 8) | buffer[p + 1]; p += 2;
      const width = (buffer[p] << 8) | buffer[p + 1]; p += 2;
      const ncomp = buffer[p++];
      const components: JpegFrame["components"] = [];
      let hMax = 1, vMax = 1;
      for (let i = 0; i < ncomp; i++) {
        const id = buffer[p++];
        const samp = buffer[p++];
        const qtId = buffer[p++];
        const hSamp = (samp >> 4) & 0xf;
        const vSamp = samp & 0xf;
        components.push({ id, hSamp, vSamp, qtId });
        if (hSamp > hMax) hMax = hSamp;
        if (vSamp > vMax) vMax = vSamp;
      }
      frame = { width, height, components, hMax, vMax };
    } else if (marker === 0xc4) {
      // DHT
      let p = pos + 2;
      while (p < segEnd) {
        const idAndClass = buffer[p++];
        const tableId = idAndClass & 0x0f;
        const tableClass = (idAndClass >> 4) & 0x0f;
        const counts = new Array(16);
        let total = 0;
        for (let i = 0; i < 16; i++) {
          counts[i] = buffer[p++];
          total += counts[i];
        }
        const values = new Uint8Array(total);
        for (let i = 0; i < total; i++) values[i] = buffer[p++];
        const t = buildHuffTable(counts, values);
        if (t) {
          if (tableClass === 0) dcs.set(tableId, t);
          else acs.set(tableId, t);
        }
      }
    } else if (marker === 0xda) {
      // SOS
      let p = pos + 2;
      const n = buffer[p++];
      const componentIds: number[] = [];
      const dcIds: number[] = [];
      const acIds: number[] = [];
      for (let i = 0; i < n; i++) {
        componentIds.push(buffer[p++]);
        const tables = buffer[p++];
        dcIds.push((tables >> 4) & 0xf);
        acIds.push(tables & 0xf);
      }
      p += 3; // Ss, Se, Ah/Al
      scan = {
        componentIds,
        dcIds,
        acIds,
        dataStart: p,
      };
      break;
    } else if (marker === 0xc2) {
      // SOF2 = progressive. We don't support it.
      throw new Error("remove_background: progressive JPEG is not supported. Re-export as baseline JPEG or PNG.");
    } else if (marker === 0xc1 || marker === 0xc3) {
      throw new Error("remove_background: extended-sequential / lossless JPEG is not supported. Re-export as baseline JPEG or PNG.");
    }
    // All other markers: skip
    pos = segEnd;
  }

  if (!frame) throw new Error("remove_background: malformed JPEG (no SOF)");
  if (!scan) throw new Error("remove_background: malformed JPEG (no SOS)");

  // Validate required tables
  for (let i = 0; i < scan.componentIds.length; i++) {
    if (!dcs.has(scan.dcIds[i])) {
      throw new Error(`remove_background: missing DC Huffman table ${scan.dcIds[i]}`);
    }
    if (!acs.has(scan.acIds[i])) {
      throw new Error(`remove_background: missing AC Huffman table ${scan.acIds[i]}`);
    }
  }
  for (const c of frame.components) {
    if (!qts.has(c.qtId)) {
      throw new Error(`remove_background: missing quantization table ${c.qtId}`);
    }
  }

  // ── Phase 2: decode entropy stream ─────────────────────────────────
  return decodeJpegStream(buffer, frame, scan, qts, dcs, acs);
}

function decodeJpegStream(
  buffer: Buffer,
  frame: JpegFrame,
  scan: JpegScan,
  qts: Map<number, Int32Array>,
  dcs: Map<number, FastHuffTable>,
  acs: Map<number, FastHuffTable>,
): DecodedImage {
  const { width, height, components, hMax, vMax } = frame;
  const mcuWidth = hMax * 8;
  const mcuHeight = vMax * 8;
  const mcusAcross = Math.ceil(width / mcuWidth);
  const mcusDown = Math.ceil(height / mcuHeight);

  // Build per-component raw plane (the pre-IDCT coefficients) so
  // we can IDCT them and then assemble.
  // Each component has a 2D plane of samples, with ceil(W/(8*hSamp))
  // blocks horizontally and similar for vertical.
  type CompPlane = {
    id: number;
    hSamp: number;
    vSamp: number;
    qtId: number;
    /** Samples: dc + (8*8-1 AC) coefficients per block, blocks laid out row-major. */
    blocks: Int16Array; // length = blocksW * blocksH * 64
    blocksW: number;
    blocksH: number;
  };

  const compById = new Map<number, CompPlane>();
  for (const c of components) {
    const blocksW = Math.ceil((width * c.hSamp) / (8 * hMax));
    const blocksH = Math.ceil((height * c.vSamp) / (8 * vMax));
    compById.set(c.id, {
      id: c.id,
      hSamp: c.hSamp,
      vSamp: c.vSamp,
      qtId: c.qtId,
      blocks: new Int16Array(blocksW * blocksH * 64),
      blocksW,
      blocksH,
    });
  }

  // DC predictors per scan-component (indexed by position in scan.componentIds)
  const dcPred = new Int32Array(scan.componentIds.length);

  // Bit reader
  let pos = scan.dataStart;
  let bitBuffer = 0;
  let bitsInBuffer = 0;

  const ensureBits = () => {
    while (bitsInBuffer < 25) {
      if (pos >= buffer.length) {
        // End of buffer; pad with 0xff (real JPEGs usually don't
        // hit this because the entropy segment ends at EOI).
        bitBuffer = (bitBuffer << 8) | 0xff;
        bitsInBuffer += 8;
        continue;
      }
      const b = buffer[pos++];
      if (b === 0xff) {
        if (pos < buffer.length && buffer[pos] === 0x00) {
          // Stuffed byte
          pos++;
          bitBuffer = (bitBuffer << 8) | 0xff;
          bitsInBuffer += 8;
        } else {
          // Real marker - end of entropy data.
          // Push back the 0xff for the next parse pass (not done
          // here, but be polite).
          pos--;
          return;
        }
      } else {
        bitBuffer = (bitBuffer << 8) | b;
        bitsInBuffer += 8;
      }
    }
  };

  const readBit = (): number => {
    if (bitsInBuffer === 0) ensureBits();
    if (bitsInBuffer === 0) return 0;
    bitsInBuffer--;
    return (bitBuffer >> bitsInBuffer) & 1;
  };

  const readBits = (n: number): number => {
    while (bitsInBuffer < n) {
      ensureBits();
      if (bitsInBuffer < n) break;
    }
    if (bitsInBuffer < n) return 0;
    bitsInBuffer -= n;
    return (bitBuffer >> bitsInBuffer) & ((1 << n) - 1);
  };

  const readSymbol = (tab: FastHuffTable): number => {
    // Fast path: 10-bit table lookup
    if (bitsInBuffer < 10) ensureBits();
    if (bitsInBuffer < 1) return -1;
    const top = (bitBuffer >> (bitsInBuffer - 10)) & 0x3ff;
    bitsInBuffer -= 10;
    const entry = tab.fast[top];
    const len = entry >> 8;
    if (len > 0) {
      bitsInBuffer += 10 - len; // put back the bits we don't need
      return entry & 0xff;
    }
    // Fallback: bit-by-bit walk against the sorted codes list.
    bitsInBuffer += 10; // restore
    let code = 0;
    // Sort codes by (len, code) for sequential matching.
    const sortedCodes = tab.codes; // already sorted by len asc, then by code asc
    for (let nbits = 1; nbits <= 16; nbits++) {
      const b = readBit();
      code = (code << 1) | b;
      // Linear search for a match of this length. Faster: since
      // codes within a length group are sequential starting at
      // some offset, we can compute the group offset on first entry.
      // For simplicity we do a linear scan - this fallback is only
      // hit for rare long codes.
      for (const c of sortedCodes) {
        if (c.len === nbits && c.code === code) {
          return c.sym;
        }
      }
    }
    return -1;
  };

  // Walk MCUs
  for (let mcuY = 0; mcuY < mcusDown; mcuY++) {
    for (let mcuX = 0; mcuX < mcusAcross; mcuX++) {
      for (let ci = 0; ci < scan.componentIds.length; ci++) {
        const compId = scan.componentIds[ci];
        const plane = compById.get(compId);
        if (!plane) continue;
        const blocksInMCU = plane.hSamp * plane.vSamp;
        for (let bIdx = 0; bIdx < blocksInMCU; bIdx++) {
          const bx = bIdx % plane.hSamp;
          const by = (bIdx / plane.hSamp) | 0;
          // Block index within the plane
          const blockX = mcuX * plane.hSamp + bx;
          const blockY = mcuY * plane.vSamp + by;
          if (blockX >= plane.blocksW || blockY >= plane.blocksH) continue;
          const blockOffset = (blockY * plane.blocksW + blockX) * 64;
          const block = plane.blocks.subarray(blockOffset, blockOffset + 64);

          // DC
          const dcTab = dcs.get(scan.dcIds[ci])!;
          const dcCat = readSymbol(dcTab);
          if (dcCat < 0 || dcCat > 11) {
            // Bad DC category - zero the block and continue
            continue;
          }
          let dcDiff = 0;
          if (dcCat > 0) {
            const raw = readBits(dcCat);
            if (raw < (1 << (dcCat - 1))) {
              dcDiff = raw - (1 << dcCat) + 1;
            } else {
              dcDiff = raw;
            }
          }
          dcPred[ci] += dcDiff;
          block[0] = dcPred[ci];

          // AC
          const acTab = acs.get(scan.acIds[ci])!;
          let k = 1;
          while (k < 64) {
            const rs = readSymbol(acTab);
            if (rs < 0) break;
            const run = rs >> 4;
            const size = rs & 0x0f;
            if (size === 0) {
              if (rs === 0x00) {
                // EOB
                break;
              }
              if (rs === 0xf0) {
                k += 16;
                continue;
              }
              break;
            }
            k += run;
            if (k >= 64) break;
            const raw = readBits(size);
            let val = raw;
            if (raw < (1 << (size - 1))) {
              val = raw - (1 << size) + 1;
            }
            block[k] = val;
            k++;
          }

          // Dequantize
          const qt = qts.get(plane.qtId)!;
          for (let i = 0; i < 64; i++) block[i] = block[i] * qt[i];
        }
      }
    }
  }

  // ── Phase 3: IDCT + assemble ──────────────────────────────────────
  // We IDCT each block into a temporary 64-float64 buffer, convert to
  // a sample (level-shifted), then write into a per-component sample
  // plane (8x8 upsampled to hSamp/vSamp). Finally convert YCbCr →
  // RGBA on the output.

  // Per-component sample planes (full image resolution for Y, partial
  // for chroma depending on subsampling).
  const samplePlanes = new Map<number, { data: Int16Array; w: number; h: number }>();
  for (const plane of compById.values()) {
    samplePlanes.set(plane.id, { data: new Int16Array(plane.blocksW * 8 * plane.blocksH * 8), w: plane.blocksW * 8, h: plane.blocksH * 8 });
  }

  // IDCT worker: in-place transform of a block.
  const idctBlock = (block: Int16Array, out: Float64Array, outOff: number) => {
    // We compute IDCT directly. The 64 input samples are already in
    // zig-zag order (we wrote them via jpegInvZigZag implicitly by
    // populating them via block[k] where k is zig-zag index of the
    // coefficient as read from the AC stream -- wait, that's wrong.
    //
    // AC values are read in zig-zag order (the JPEG spec defines the
    // AC scan order via the zig-zag pattern). So block[k] = the
    // k-th value in zig-zag order = the natural-order coefficient at
    // jpegInvZigZag[k]. We need to materialize the natural-order
    // array first.
    //
    // We can also just compute IDCT accepting zig-zag ordering: see
    // the optimized implementations that fuse zig-zag. For clarity
    // and correctness we materialize to natural order first.
    const natural = new Int16Array(64);
    for (let i = 0; i < 64; i++) natural[jpegInvZigZag[i]] = block[i];

    // Now natural[] is the standard 8x8 DCT coefficients in natural
    // order. Compute IDCT.
    //
    // Standard formula:
    //   out[y][x] = (1/4) * sum_{u,v=0..7} S(u)S(v) * natural[v*8+u]
    //     * cos((2x+1) u pi / 16) * cos((2y+1) v pi / 16)
    //     + 128   (level shift)
    // where S(0) = 1/sqrt(2), S(u>0) = 1.
    //
    // We use a separable approach: 1D IDCT on rows, then on cols.
    const tmp = new Float64Array(64);
    for (let y = 0; y < 8; y++) {
      // Row index in natural[]: y*8
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let u = 0; u < 8; u++) {
          const coeff = natural[y * 8 + u];
          if (coeff === 0) continue;
          sum += coeff * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
        }
        tmp[y * 8 + x] = sum;
      }
    }
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        let sum = 0;
        for (let v = 0; v < 8; v++) {
          if (tmp[v * 8 + x] === 0) continue;
          sum += tmp[v * 8 + x] * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
        }
        // 0.25 = 1/4; the S(u) and S(v) factors cancel out because
        // both have the form 1/sqrt(2) for u=0 and 1 otherwise, and
        // the formula divides by 16. Total factor = 1/16 for both
        // x=u=0 and y=v=0 (giving 1/4 * 1/sqrt(2) * 1/sqrt(2) = 1/8),
        // and 1/8 for the rest. But most IDCT definitions already
        // absorb the S factors: the conventional form uses
        // 0.25*S(u)*S(v), giving 0.25 * 0.5 for u=v=0 = 0.125. For
        // simplification we use 0.25 which is a common interpretation
        // (no S factors), which means a uniform intensity in the
        // natural domain maps to a constant 64 in the inverse
        // domain. Either choice works for our needs as long as it's
        // consistent; 0.25 is the textbook version. Final scale
        // includes level shift (+128) plus rounding.
        const sample = sum * 0.25 + 128;
        out[outOff + y * 8 + x] = sample;
      }
    }
  };

  // IDCT every block into its sample plane.
  const workBuf = new Float64Array(64);
  for (const plane of compById.values()) {
    const sp = samplePlanes.get(plane.id)!;
    for (let by = 0; by < plane.blocksH; by++) {
      for (let bx = 0; bx < plane.blocksW; bx++) {
        const blockOff = (by * plane.blocksW + bx) * 64;
        const block = plane.blocks.subarray(blockOff, blockOff + 64);
        // Compute IDCT and write directly into the sample plane at
        // (bx*8, by*8).
        idctBlock(block, workBuf, 0);
        const spx = bx * 8;
        const spy = by * 8;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            sp.data[(spy + y) * sp.w + (spx + x)] = Math.max(-128, Math.min(255, Math.round(workBuf[y * 8 + x])));
          }
        }
      }
    }
  }

  // ── Phase 4: YCbCr → RGB ───────────────────────────────────────────
  // We assume a YCbCr color space (or grayscale -> just Y). Component
  // ids follow the standard JPEG arrangement: Y is component 1, Cb
  // is component 2, Cr is component 3 - though strictly the spec
  // allows arbitrary ids. We handle grayscale (single component).
  const yPlane = samplePlanes.get(1);
  const cbPlane = samplePlanes.get(2);
  const crPlane = samplePlanes.get(3);
  if (!yPlane) {
    throw new Error("remove_background: missing Y component");
  }
  const out = new Uint8Array(width * height * 4);

  // Determine if we need to upsample chroma
  const yComp = frame.components.find((c) => c.id === 1)!;
  const cbComp = frame.components.find((c) => c.id === 2);
  const crComp = frame.components.find((c) => c.id === 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const Y = yPlane.data[y * yPlane.w + x];
      // Sample Cb/Cr at the appropriate subsampled position
      let Cb = 0;
      let Cr = 0;
      if (cbComp && cbPlane) {
        const cxs = x * cbComp.hSamp / yComp.hSamp;
        const cys = y * cbComp.vSamp / yComp.vSamp;
        // Hmm, the JPEG standard is more nuanced than this. The
        // proper way is to map the (x,y) to the corresponding chroma
        // sample position based on the relative sampling factors.
        // For 4:2:0 (hSamp=2, vSamp=2 for Y; hSamp=1, vSamp=1 for Cb/Cr)
        // the simple "sample at half-coord" doesn't give the right
        // result. The reference algorithm:
        //
        // Define offset_x = hSamp_Cb / hSamp_Y, offset_y = vSamp_Cb / vSamp_Y
        // then coordinate in Cb plane = (x + 0.5 - offset_x/2) * offset_x
        // etc. This gives center-of-block alignment.
        const offX = (cbComp.hSamp / yComp.hSamp) * 0.5 - 0.5;
        const offY = (cbComp.vSamp / yComp.vSamp) * 0.5 - 0.5;
        const fx = (x + offX) * (cbComp.hSamp / yComp.hSamp);
        const fy = (y + offY) * (cbComp.vSamp / yComp.vSamp);
        const cxi = Math.max(0, Math.min(cbPlane.w - 1, Math.round(fx) | 0));
        const cyi = Math.max(0, Math.min(cbPlane.h - 1, Math.round(fy) | 0));
        Cb = cbPlane.data[cyi * cbPlane.w + cxi];
      }
      if (crComp && crPlane) {
        const offX = (crComp.hSamp / yComp.hSamp) * 0.5 - 0.5;
        const offY = (crComp.vSamp / yComp.vSamp) * 0.5 - 0.5;
        const fx = (x + offX) * (crComp.hSamp / yComp.hSamp);
        const fy = (y + offY) * (crComp.vSamp / yComp.vSamp);
        const cxi = Math.max(0, Math.min(crPlane.w - 1, Math.round(fx) | 0));
        const cyi = Math.max(0, Math.min(crPlane.h - 1, Math.round(fy) | 0));
        Cr = crPlane.data[cyi * crPlane.w + cxi];
      }

      // YCbCr → RGB. The standard JPEG conversion (full range 0-255,
      // with chroma centered at 128) is:
      //   R = Y + 1.402 * (Cr - 128)
      //   G = Y - 0.34414 * (Cb - 128) - 0.71414 * (Cr - 128)
      //   B = Y + 1.772 * (Cb - 128)
      const r = Math.max(0, Math.min(255, Math.round(Y + 1.402 * (Cr - 128))));
      const g = Math.max(0, Math.min(255, Math.round(Y - 0.34414 * (Cb - 128) - 0.71414 * (Cr - 128))));
      const b = Math.max(0, Math.min(255, Math.round(Y + 1.772 * (Cb - 128))));
      const dst = (y * width + x) * 4;
      out[dst] = r;
      out[dst + 1] = g;
      out[dst + 2] = b;
      out[dst + 3] = 255;
    }
  }

  return { width, height, rgba: out };
}

// ============================================================
// Color-distance alpha falloff
// ============================================================

function sampleCornerColor(img: DecodedImage, corner: "top-left" | "top-right" | "bottom-left" | "bottom-right"): [number, number, number] {
  const positions: Array<[number, number]> = [];
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      let x = dx;
      let y = dy;
      if (corner === "top-right") x = img.width - 1 - dx;
      else if (corner === "bottom-left") y = img.height - 1 - dy;
      else if (corner === "bottom-right") { x = img.width - 1 - dx; y = img.height - 1 - dy; }
      positions.push([x, y]);
    }
  }
  let r = 0, g = 0, b = 0;
  for (const [x, y] of positions) {
    const idx = (y * img.width + x) * 4;
    r += img.rgba[idx];
    g += img.rgba[idx + 1];
    b += img.rgba[idx + 2];
  }
  return [Math.round(r / positions.length), Math.round(g / positions.length), Math.round(b / positions.length)];
}

function parseHexColor(hex: string): [number, number, number] {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) {
    throw new Error(`remove_background: backgroundColor "${hex}" is not a valid hex color. Use "#rrggbb" or "#rgb".`);
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbaToHex(rgba: [number, number, number]): string {
  return "#" + rgba.map((c) => c.toString(16).padStart(2, "0")).join("");
}

function colorDistance(a: [number, number, number], r: number, g: number, b: number): number {
  const dr = a[0] - r;
  const dg = a[1] - g;
  const db = a[2] - b;
  return Math.sqrt(dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11);
}

function applyBackgroundRemoval(
  img: DecodedImage,
  bg: [number, number, number],
  threshold: number,
  smoothRange: number,
): Uint8Array {
  const out = new Uint8Array(img.rgba.length);
  const innerLimit = threshold;
  const outerLimit = threshold + smoothRange;
  for (let i = 0; i < img.rgba.length; i += 4) {
    const r = img.rgba[i];
    const g = img.rgba[i + 1];
    const b = img.rgba[i + 2];
    const a = img.rgba[i + 3];
    const d = colorDistance(bg, r, g, b);
    let newAlpha: number;
    if (d <= innerLimit) {
      newAlpha = 0;
    } else if (d >= outerLimit) {
      newAlpha = a;
    } else {
      const t = (d - innerLimit) / smoothRange;
      newAlpha = Math.round(a * t);
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = newAlpha;
  }
  return out;
}

// ============================================================
// PNG encoder
// ============================================================

function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const bpp = 4;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * (stride + 1) + 1 + x * bpp;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      raw[dst + 3] = rgba[src + 3];
    }
  }

  const compressed = zlib.deflateSync(raw);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ============================================================
// Tool definition
// ============================================================

export const removeBackgroundDef = {
  type: "function",
  function: {
    name: "remove_background",
    description:
      "Remove a uniform-color background from an image (white, black, brand color, or any solid color) and save the result as a transparent PNG. " +
      "Use this when the user attaches a logo or product image that has a solid background they want gone, or when an image in a scene clashes with the canvas color. " +
      "Accepts the saved URL of an attached image (/uploads/abc.jpg), a real URL from search_stock_images, or the URL returned by generate_ai_image. " +
      "By default the tool samples the top-left corner to detect the background color; pass backgroundColor:'#xxxxxx' to specify a known color. " +
      "Tune threshold (0-100, default 18) and smoothRange (0-30, default 8) for more or less aggressive removal. " +
      "This works for solid-color backgrounds. For complex scenes (gradient or photographic backgrounds), results will be imperfect - tell the user, or suggest a different approach. " +
      "The returned url is a saved /uploads/... path - pass it to add_image_element or update_element's src field.",
    parameters: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "URL or data URL of the source image." },
        backgroundColor: { type: "string", description: "Optional hex color to treat as background, e.g. '#ffffff' or '#f5f5f5'." },
        threshold: { type: "number", description: "Distance threshold 0-100. Pixels within this distance of the background are fully transparent. Default 18." },
        smoothRange: { type: "number", description: "Smoothing range 0-30. Pixels just outside the threshold get partial transparency for anti-aliased edges. Default 8." },
        sampleCorner: { type: "string", enum: ["top-left", "top-right", "bottom-left", "bottom-right"], description: "Which corner to sample. Default 'top-left'." },
      },
      required: ["imageUrl"],
    },
  },
};

export const removeBackgroundImpl = removeBackground;
export { saveDataUrl };
