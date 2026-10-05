import { inflateSync } from "node:zlib";

/**
 * The raw-document statement pages are a 10px doubled bitmap font.
 * Tesseract misreads it. Match the glyphs and leave unknown pages alone.
 * The letter O and the digit 0 are the same shape; digits are fixed in
 * tokens that already contain a digit.
 */
const GLYPHS: [string, number[]][] = [
  ["H", [0x303, 0x303, 0x303, 0x303, 0x3ff, 0x3ff, 0x303, 0x303, 0x303, 0x303]],
  ["E", [0x3ff, 0x3ff, 0x300, 0x300, 0x3fc, 0x3fc, 0x300, 0x300, 0x3ff, 0x3ff]],
  ["A", [0xfc, 0xfc, 0x303, 0x303, 0x3ff, 0x3ff, 0x303, 0x303, 0x303, 0x303]],
  ["R", [0x3fc, 0x3fc, 0x303, 0x303, 0x3fc, 0x3fc, 0x30c, 0x30c, 0x303, 0x303]],
  ["T", [0x3ff, 0x3ff, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30]],
  ["%", [0xcc, 0xcc, 0x333, 0x333, 0xcc, 0xcc, 0x333, 0x333, 0xcc, 0xcc]],
  ["M", [0x303, 0x303, 0x3cf, 0x3cf, 0x333, 0x333, 0x303, 0x303, 0x303, 0x303]],
  ["B", [0x3fc, 0x3fc, 0x303, 0x303, 0x3fc, 0x3fc, 0x303, 0x303, 0x3fc, 0x3fc]],
  ["L", [0x300, 0x300, 0x300, 0x300, 0x300, 0x300, 0x300, 0x300, 0x3ff, 0x3ff]],
  ["C", [0xfc, 0xfc, 0x303, 0x303, 0x300, 0x300, 0x303, 0x303, 0xfc, 0xfc]],
  ["F", [0x3ff, 0x3ff, 0x300, 0x300, 0x3fc, 0x3fc, 0x300, 0x300, 0x300, 0x300]],
  ["Y", [0x303, 0x303, 0xcc, 0xcc, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30]],
  ["P", [0x3fc, 0x3fc, 0x303, 0x303, 0x3fc, 0x3fc, 0x300, 0x300, 0x300, 0x300]],
  ["I", [0x3f, 0x3f, 0xc, 0xc, 0xc, 0xc, 0xc, 0xc, 0x3f, 0x3f]],
  ["O", [0xfc, 0xfc, 0x303, 0x303, 0x303, 0x303, 0x303, 0x303, 0xfc, 0xfc]],
  ["D", [0x3fc, 0x3fc, 0x303, 0x303, 0x303, 0x303, 0x303, 0x303, 0x3fc, 0x3fc]],
  ["N", [0x303, 0x303, 0x3c3, 0x3c3, 0x333, 0x333, 0x30f, 0x30f, 0x303, 0x303]],
  ["G", [0xfc, 0xfc, 0x300, 0x300, 0x30f, 0x30f, 0x303, 0x303, 0xfc, 0xfc]],
  ["2", [0xfc, 0xfc, 0x3, 0x3, 0xfc, 0xfc, 0x300, 0x300, 0x3ff, 0x3ff]],
  ["4", [0x30c, 0x30c, 0x30c, 0x30c, 0x3ff, 0x3ff, 0xc, 0xc, 0xc, 0xc]],
  ["-", [0x0, 0x0, 0x0, 0x0, 0x3ff, 0x3ff, 0x0, 0x0, 0x0, 0x0]],
  ["1", [0xc, 0xc, 0x3c, 0x3c, 0xc, 0xc, 0xc, 0xc, 0x3f, 0x3f]],
  ["3", [0xfc, 0xfc, 0x3, 0x3, 0x3c, 0x3c, 0x3, 0x3, 0xfc, 0xfc]],
  ["V", [0x303, 0x303, 0x303, 0x303, 0x303, 0x303, 0xcc, 0xcc, 0x30, 0x30]],
  ["U", [0x303, 0x303, 0x303, 0x303, 0x303, 0x303, 0x303, 0x303, 0xfc, 0xfc]],
  ["S", [0xfc, 0xfc, 0x300, 0x300, 0xfc, 0xfc, 0x3, 0x3, 0xfc, 0xfc]],
  ["6", [0xfc, 0xfc, 0x300, 0x300, 0x3fc, 0x3fc, 0x303, 0x303, 0xfc, 0xfc]],
  ["5", [0x3ff, 0x3ff, 0x300, 0x300, 0x3fc, 0x3fc, 0x3, 0x3, 0x3fc, 0x3fc]],
  ["X", [0x303, 0x303, 0xcc, 0xcc, 0x30, 0x30, 0xcc, 0xcc, 0x303, 0x303]],
  ["8", [0xfc, 0xfc, 0x303, 0x303, 0xfc, 0xfc, 0x303, 0x303, 0xfc, 0xfc]],
  ["7", [0x3ff, 0x3ff, 0x3, 0x3, 0xc, 0xc, 0x30, 0x30, 0x30, 0x30]],
  ["9", [0xfc, 0xfc, 0x303, 0x303, 0xff, 0xff, 0x3, 0x3, 0xfc, 0xfc]],
  ["Q", [0xfc, 0xfc, 0x303, 0x303, 0x303, 0x303, 0x30f, 0x30f, 0xff, 0xff]],
  [".", [0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x3, 0x3]],
  ["/", [0x3, 0x3, 0xc, 0xc, 0x30, 0x30, 0xc0, 0xc0, 0x300, 0x300]],
  ["K", [0x303, 0x303, 0x30c, 0x30c, 0x3f0, 0x3f0, 0x30c, 0x30c, 0x303, 0x303]],
  ["Z", [0x3ff, 0x3ff, 0xc, 0xc, 0x30, 0x30, 0xc0, 0xc0, 0x3ff, 0x3ff]],
];

const GLYPH_INDEX = new Map<string, string>(
  GLYPHS.map(([char, rows]) => [rows.join(","), char]),
);

export function readPixelFont(bytes: Buffer): string {
  const image = decodePng(bytes);
  if (!image) return "";
  const lines = textLines(image);
  if (lines.length === 0 || lines.some((line) => line.includes("?"))) return "";
  return lines
    .map((line) =>
      line
        .split(" ")
        .map((token) =>
          /[0-9]/.test(token) && /^[O0-9.,/-]+$/.test(token)
            ? token.replaceAll("O", "0")
            : token,
        )
        .join(" "),
    )
    .join("\n");
}

function textLines(image: { width: number; height: number; ink: (x: number, y: number) => boolean }): string[] {
  const bands: [number, number][] = [];
  let start = -1;
  for (let y = 0; y < image.height; y += 1) {
    let ink = 0;
    for (let x = 0; x < image.width; x += 1) if (image.ink(x, y)) ink += 1;
    if (ink > 5 && start < 0) start = y;
    else if (ink <= 5 && start >= 0) {
      bands.push([start, y - 1]);
      start = -1;
    }
  }
  if (start >= 0) bands.push([start, image.height - 1]);
  const lines: string[] = [];
  for (const [y0, y1] of bands) {
    if (y1 - y0 + 1 !== 10) return [];
    lines.push(readBand(image, y0, y1));
  }
  return lines;
}

function readBand(
  image: { width: number; ink: (x: number, y: number) => boolean },
  y0: number,
  y1: number,
): string {
  const segs: [number, number][] = [];
  let open = -1;
  for (let x = 0; x < image.width; x += 1) {
    let ink = 0;
    for (let y = y0; y <= y1; y += 1) if (image.ink(x, y)) ink += 1;
    if (ink > 0 && open < 0) open = x;
    else if (ink === 0 && open >= 0) {
      segs.push([open, x - 1]);
      open = -1;
    }
  }
  if (open >= 0) segs.push([open, image.width - 1]);
  let text = "";
  let prev = 0;
  for (const [left, right] of segs) {
    if (left - prev >= 6) text += " ";
    const rows: number[] = [];
    for (let y = y0; y <= y1; y += 1) {
      let bits = 0;
      for (let x = left; x <= right; x += 1) {
        bits = (bits << 1) | (image.ink(x, y) ? 1 : 0);
      }
      rows.push(bits);
    }
    text += GLYPH_INDEX.get(rows.join(",")) ?? "?";
    prev = right + 1;
  }
  return text.trim();
}

function decodePng(
  bytes: Buffer,
): { width: number; height: number; ink: (x: number, y: number) => boolean } | undefined {
  if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) return undefined;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) return undefined;
      colorType = 2;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (colorType !== 2 || width < 1 || height < 1) return undefined;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return undefined;
  }
  const stride = width * 3;
  const rgb = Buffer.alloc(width * height * 3);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = Buffer.from(raw.subarray(src, src + stride));
    src += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 3 ? row[i - 3]! : 0;
      const up = prev[i]!;
      const upLeft = i >= 3 ? prev[i - 3]! : 0;
      if (filter === 1) row[i] = (row[i]! + left) & 255;
      else if (filter === 2) row[i] = (row[i]! + up) & 255;
      else if (filter === 3) row[i] = (row[i]! + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[i] = (row[i]! + paeth(left, up, upLeft)) & 255;
    }
    row.copy(rgb, y * stride);
    prev = row;
  }
  return {
    width,
    height,
    ink: (x, y) => {
      const i = (y * width + x) * 3;
      return (rgb[i]! + rgb[i + 1]! + rgb[i + 2]!) / 3 < 128;
    },
  };
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dul) return left;
  if (du <= dul) return up;
  return upLeft;
}
