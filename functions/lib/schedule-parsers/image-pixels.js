"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeScanImage = decodeScanImage;
exports.colouredBlocks = colouredBlocks;
exports.ruledLines = ruledLines;
const jpeg = require("jpeg-js");
const pngjs_1 = require("pngjs");
/**
 * Decodes a PNG or JPEG scan, or null when it cannot be read or does not line
 * up with Vision's page. Pure JavaScript, so nothing native ships with the
 * function.
 */
function decodeScanImage(dataUrl, sourceWidth = 0, sourceHeight = 0, maxSide = 1400) {
    const match = dataUrl?.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    if (!match)
        return null;
    let width = 0;
    let height = 0;
    let rgba;
    try {
        const bytes = Buffer.from(match[2], "base64");
        if (/png/i.test(match[1])) {
            const png = pngjs_1.PNG.sync.read(bytes);
            width = png.width;
            height = png.height;
            rgba = png.data;
        }
        else if (/jpe?g/i.test(match[1])) {
            const image = jpeg.decode(bytes, { maxMemoryUsageInMB: 320, maxResolutionInMP: 50, useTArray: true });
            width = image.width;
            height = image.height;
            rgba = image.data;
        }
        else {
            return null;
        }
    }
    catch (error) {
        console.warn("[Schedule pixels] Could not decode the scan; reading words only.", error instanceof Error ? error.message : String(error));
        return null;
    }
    if (!width || !height)
        return null;
    const srcW = sourceWidth || width;
    const srcH = sourceHeight || height;
    // Vision measures the image as it is displayed. A photo whose EXIF turns it
    // a quarter-turn decodes the other way round here, and its pixels would not
    // line up with a single word box -- better to measure nothing.
    if (Math.abs(width / height - srcW / srcH) > 0.02)
        return null;
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
    return { data, height: h, scale: w / srcW, sourceHeight: srcH, sourceWidth: srcW, width: w };
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
function colouredBlocks(pixels) {
    const { data, height: h, width: w } = pixels;
    // The background is taken row by row (the median colour of the row), not
    // once for the page: the real portal fades its grid from white to peach,
    // and against a single page colour the lower half of the grid counted as
    // "coloured" and swallowed a pale peach class block, moving its top edge.
    const step = Math.max(1, Math.floor(w / 200));
    const rowBackground = Array.from({ length: h }, (_, y) => {
        const channels = [[], [], []];
        for (let x = 0; x < w; x += step) {
            const i = (y * w + x) * 3;
            channels[0].push(data[i]);
            channels[1].push(data[i + 1]);
            channels[2].push(data[i + 2]);
        }
        return channels.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
    });
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i += 1) {
        const r = data[i * 3];
        const g = data[i * 3 + 1];
        const b = data[i * 3 + 2];
        const bg = rowBackground[Math.floor(i / w)];
        const max = Math.max(r, g, b);
        const chroma = max - Math.min(r, g, b);
        const distance = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
        if (chroma >= 16 && max >= 70 && distance >= 36)
            mask[i] = 1;
    }
    // Thin coloured lines are not blocks. A portal that rules its grid in
    // orange joined every block to every line, and the one grid-sized region
    // that made was discarded as a tinted page -- so the real scan found no
    // blocks at all. An opening (erode, then grow back) removes anything
    // thinner than the kernel and leaves filled blocks their shape.
    const radius = Math.max(2, Math.round(Math.min(w, h) * 0.004));
    const eroded = new Uint8Array(w * h);
    for (let y = radius; y < h - radius; y += 1) {
        for (let x = radius; x < w - radius; x += 1) {
            let keep = 1;
            for (let dy = -radius; dy <= radius && keep; dy += 1) {
                const row = (y + dy) * w;
                if (!mask[row + x - radius] || !mask[row + x + radius] || !mask[row + x])
                    keep = 0;
            }
            for (let dx = -radius; dx <= radius && keep; dx += 1) {
                if (!mask[y * w + x + dx])
                    keep = 0;
            }
            eroded[y * w + x] = keep;
        }
    }
    mask.fill(0);
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            if (!eroded[y * w + x])
                continue;
            for (let dy = -radius; dy <= radius; dy += 1) {
                const yy = y + dy;
                if (yy < 0 || yy >= h)
                    continue;
                for (let dx = -radius; dx <= radius; dx += 1) {
                    const xx = x + dx;
                    if (xx >= 0 && xx < w)
                        mask[yy * w + xx] = 1;
                }
            }
        }
    }
    const queue = new Int32Array(w * h);
    const boxes = [];
    for (let start = 0; start < w * h; start += 1) {
        if (mask[start] !== 1)
            continue;
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
            if (x < left)
                left = x;
            if (x > right)
                right = x;
            if (y < top)
                top = y;
            if (y > bottom)
                bottom = y;
            if (x > 0 && mask[at - 1] === 1) {
                mask[at - 1] = 2;
                queue[tail++] = at - 1;
            }
            if (x < w - 1 && mask[at + 1] === 1) {
                mask[at + 1] = 2;
                queue[tail++] = at + 1;
            }
            if (y > 0 && mask[at - w] === 1) {
                mask[at - w] = 2;
                queue[tail++] = at - w;
            }
            if (y < h - 1 && mask[at + w] === 1) {
                mask[at + w] = 2;
                queue[tail++] = at + w;
            }
        }
        const bw = right - left + 1;
        const bh = bottom - top + 1;
        if (bw < Math.max(6, w * 0.015) || bh < Math.max(6, h * 0.01))
            continue;
        if (area < bw * bh * 0.45 || bw * bh > w * h * 0.3)
            continue;
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
 * A line is a thin band whose typical colour -- the median across the span --
 * differs from the rows just before and after it. The median ignores class
 * blocks (they never cover most of a row) and the comparison with close
 * neighbours ignores a background that slowly changes colour, so grey,
 * orange or any other ruling is found; the first version looked only for
 * grey lines darker than the page, and a real portal rules its grid in orange.
 */
function ruledLines(pixels, direction, span, range) {
    const s = pixels.scale;
    const across = direction === "horizontal" ? pixels.width : pixels.height;
    const along = direction === "horizontal" ? pixels.height : pixels.width;
    const spanFrom = Math.max(0, Math.floor(span.from * s));
    const spanTo = Math.min(across - 1, Math.ceil(span.to * s));
    const rangeFrom = Math.max(0, Math.floor(range.from * s));
    const rangeTo = Math.min(along - 1, Math.ceil(range.to * s));
    if (spanTo - spanFrom < 10 || rangeTo <= rangeFrom)
        return [];
    const step = Math.max(1, Math.floor((spanTo - spanFrom) / 200));
    const medianOf = (line) => {
        if (line < 0 || line >= along)
            return null;
        const channels = [[], [], []];
        for (let t = spanFrom; t <= spanTo; t += step) {
            const x = direction === "horizontal" ? t : line;
            const y = direction === "horizontal" ? line : t;
            const i = (y * pixels.width + x) * 3;
            channels[0].push(pixels.data[i]);
            channels[1].push(pixels.data[i + 1]);
            channels[2].push(pixels.data[i + 2]);
        }
        return channels.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
    };
    const medians = new Map();
    const at = (line) => {
        if (!medians.has(line))
            medians.set(line, medianOf(line));
        return medians.get(line) ?? null;
    };
    const apart = (a, b) => !a || !b ? 0 : Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const k = 3;
    const hits = [];
    for (let line = rangeFrom; line <= rangeTo; line += 1) {
        const here = at(line);
        if (apart(here, at(line - k)) >= 18 && apart(here, at(line + k)) >= 18)
            hits.push(line);
    }
    const lines = [];
    let run = [];
    for (const hit of hits) {
        if (run.length && hit - run[run.length - 1] > 1) {
            lines.push((run[0] + run[run.length - 1]) / 2);
            run = [];
        }
        run.push(hit);
    }
    if (run.length)
        lines.push((run[0] + run[run.length - 1]) / 2);
    return lines.map((line) => (line + 0.5) / s);
}
//# sourceMappingURL=image-pixels.js.map