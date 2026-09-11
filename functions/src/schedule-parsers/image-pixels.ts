import * as jpeg from "jpeg-js";
import {PNG} from "pngjs";

/**
 * The scan's pixels, shrunk for cheap analysis.
 *
 * Vision reports words, not shapes. A calendar-style timetable encodes when a
 * class starts and ends in the edges of a coloured block, and no word box
 * touches those edges, so they are measured from the image itself. Every
 * position this module returns is in Vision's coordinate space (the full-size
 * image), so the two can be compared directly.
 */
export type ScanPixels = {
  /** RGB, row-major, at the shrunk size. */
  data: Uint8Array;
  height: number;
  /** Shrunk pixels per source (Vision) pixel. */
  scale: number;
  sourceHeight: number;
  sourceWidth: number;
  width: number;
};
export type PixelBox = {bottom: number; left: number; right: number; top: number};

/**
 * Decodes a PNG or JPEG scan, or null when it cannot be read or does not line
 * up with Vision's page. Pure JavaScript, so nothing native ships with the
 * function.
 */
export function decodeScanImage(dataUrl: string | undefined, sourceWidth = 0, sourceHeight = 0, maxSide = 1400): ScanPixels | null {
  const match = dataUrl?.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) return null;
  let width = 0;
  let height = 0;
  let rgba: Uint8Array;
  try {
    const bytes = Buffer.from(match[2], "base64");
    if (/png/i.test(match[1])) {
      const png = PNG.sync.read(bytes);
      width = png.width;
      height = png.height;
      rgba = png.data;
    } else if (/jpe?g/i.test(match[1])) {
      const image = jpeg.decode(bytes, {maxMemoryUsageInMB: 320, maxResolutionInMP: 50, useTArray: true});
      width = image.width;
      height = image.height;
      rgba = image.data;
    } else {
      return null;
    }
  } catch (error) {
    console.warn("[Schedule pixels] Could not decode the scan; reading words only.", error instanceof Error ? error.message : String(error));
    return null;
  }
  if (!width || !height) return null;
  const srcW = sourceWidth || width;
  const srcH = sourceHeight || height;
  // Vision measures the image as it is displayed. A photo whose EXIF turns it
  // a quarter-turn decodes the other way round here, and its pixels would not
  // line up with a single word box -- better to measure nothing.
  if (Math.abs(width / height - srcW / srcH) > 0.02) return null;

  const factor = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * factor));
  const h = Math.max(1, Math.round(height * factor));
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.min(height - 1, Math.floor(y / factor));
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor((y + 1) / factor)));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.min(width - 1, Math.floor(x / factor));
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor((x + 1) / factor)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      // Averaged, not sampled, so a one-pixel ruled line survives shrinking
      // as a fainter line instead of vanishing.
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * width + sx) * 4;
          const alpha = rgba[i + 3] / 255;
          r += rgba[i] * alpha + 255 * (1 - alpha);
          g += rgba[i + 1] * alpha + 255 * (1 - alpha);
          b += rgba[i + 2] * alpha + 255 * (1 - alpha);
          n += 1;
        }
      }
      const o = (y * w + x) * 3;
      data[o] = r / n;
      data[o + 1] = g / n;
      data[o + 2] = b / n;
    }
  }
  return {data, height: h, scale: w / srcW, sourceHeight: srcH, sourceWidth: srcW, width: w};
}

/** The page colour: the most common colour, so a warm-lit photo's paper counts as background too. */
function background(pixels: ScanPixels) {
  const counts = new Uint32Array(4096);
  const sums = new Float64Array(4096 * 3);
  for (let i = 0; i < pixels.width * pixels.height; i += 1) {
    const r = pixels.data[i * 3];
    const g = pixels.data[i * 3 + 1];
    const b = pixels.data[i * 3 + 2];
    const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    counts[bin] += 1;
    sums[bin * 3] += r;
    sums[bin * 3 + 1] += g;
    sums[bin * 3 + 2] += b;
  }
  let best = 0;
  for (let bin = 1; bin < 4096; bin += 1) if (counts[bin] > counts[best]) best = bin;
  const n = counts[best] || 1;
  return [sums[best * 3] / n, sums[best * 3 + 1] / n, sums[best * 3 + 2] / n];
}

/**
 * Filled, coloured rectangles -- the class blocks of a calendar view.
 *
 * A pixel counts when it has real colour (not white, grey or black) and is
 * unlike the page colour; touching pixels are joined into regions, and a
 * region is kept when it is block-shaped: big enough to hold a label, mostly
 * filled (the text inside leaves holes), and not so big that it is really a
 * tinted page.
 */
export function colouredBlocks(pixels: ScanPixels): PixelBox[] {
  const {data, height: h, width: w} = pixels;
  const bg = background(pixels);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    const max = Math.max(r, g, b);
    const chroma = max - Math.min(r, g, b);
    const distance = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
    if (chroma >= 16 && max >= 70 && distance >= 36) mask[i] = 1;
  }
  const queue = new Int32Array(w * h);
  const boxes: PixelBox[] = [];
  for (let start = 0; start < w * h; start += 1) {
    if (mask[start] !== 1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    mask[start] = 2;
    let left = w;
    let right = 0;
    let top = h;
    let bottom = 0;
    let area = 0;
    while (head < tail) {
      const at = queue[head++];
      const x = at % w;
      const y = (at - x) / w;
      area += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x > 0 && mask[at - 1] === 1) { mask[at - 1] = 2; queue[tail++] = at - 1; }
      if (x < w - 1 && mask[at + 1] === 1) { mask[at + 1] = 2; queue[tail++] = at + 1; }
      if (y > 0 && mask[at - w] === 1) { mask[at - w] = 2; queue[tail++] = at - w; }
      if (y < h - 1 && mask[at + w] === 1) { mask[at + w] = 2; queue[tail++] = at + w; }
    }
    const bw = right - left + 1;
    const bh = bottom - top + 1;
    if (bw < Math.max(6, w * 0.015) || bh < Math.max(6, h * 0.01)) continue;
    if (area < bw * bh * 0.45 || bw * bh > w * h * 0.3) continue;
    boxes.push({
      bottom: (bottom + 1) / pixels.scale,
      left: left / pixels.scale,
      right: (right + 1) / pixels.scale,
      top: top / pixels.scale,
    });
  }
  return boxes;
}

/**
 * Where thin ruled lines cross the given band: the hour lines of a calendar
 * (direction "horizontal") or the column lines of a timetable ("vertical").
 * `span` is the band across the lines and `range` the stretch searched along
 * them, both in source coordinates; returned positions are too.
 *
 * A row of pixels is a line when most of its uncoloured pixels are a little
 * darker than the page -- measured over uncoloured pixels only, since class
 * blocks cover part of every line.
 */
export function ruledLines(
  pixels: ScanPixels,
  direction: "horizontal" | "vertical",
  span: {from: number; to: number},
  range: {from: number; to: number},
): number[] {
  const bg = background(pixels);
  const bgLuma = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
  const s = pixels.scale;
  const across = direction === "horizontal" ? pixels.width : pixels.height;
  const along = direction === "horizontal" ? pixels.height : pixels.width;
  const spanFrom = Math.max(0, Math.floor(span.from * s));
  const spanTo = Math.min(across - 1, Math.ceil(span.to * s));
  const rangeFrom = Math.max(0, Math.floor(range.from * s));
  const rangeTo = Math.min(along - 1, Math.ceil(range.to * s));
  if (spanTo - spanFrom < 10 || rangeTo <= rangeFrom) return [];
  const hits: number[] = [];
  for (let line = rangeFrom; line <= rangeTo; line += 1) {
    let plain = 0;
    let dark = 0;
    for (let t = spanFrom; t <= spanTo; t += 1) {
      const x = direction === "horizontal" ? t : line;
      const y = direction === "horizontal" ? line : t;
      const i = (y * pixels.width + x) * 3;
      const r = pixels.data[i];
      const g = pixels.data[i + 1];
      const b = pixels.data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) >= 24) continue;
      plain += 1;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma <= bgLuma - 8 && luma >= bgLuma - 130) dark += 1;
    }
    if (plain >= (spanTo - spanFrom) * 0.2 && dark >= plain * 0.6) hits.push(line);
  }
  const lines: number[] = [];
  let run: number[] = [];
  for (const hit of hits) {
    if (run.length && hit - run[run.length - 1] > 1) {
      lines.push((run[0] + run[run.length - 1]) / 2);
      run = [];
    }
    run.push(hit);
  }
  if (run.length) lines.push((run[0] + run[run.length - 1]) / 2);
  return lines.map((line) => (line + 0.5) / s);
}
