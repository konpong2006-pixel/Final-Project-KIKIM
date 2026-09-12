"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hhmm = exports.median = exports.ROOM_LABEL = exports.SECTION_LABEL = exports.COURSE_CODE = exports.TIME_RANGE = exports.TIME_TOKEN = exports.THAI_DAYS = void 0;
exports.rawWords = rawWords;
exports.toWord = toWord;
exports.groupLines = groupLines;
exports.joinLine = joinLine;
exports.dayIndex = dayIndex;
exports.findCodes = findCodes;
exports.parseScheduleGrid = parseScheduleGrid;
exports.THAI_DAYS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
/**
 * Spellings a day header can take once dots and spaces are removed. The bare
 * Thai initials are safe here, and only here: this list is matched against the
 * day column of a grid, never against free text, where "พ" or "ส" alone would
 * mean nothing.
 */
const DAY_LABELS = [
    ["จันทร์", "จ", "mon", "monday"],
    ["อังคาร", "อ", "tue", "tues", "tuesday"],
    ["พุธ", "พ", "wed", "wednesday"],
    ["พฤหัสบดี", "พฤหัส", "พฤ", "thu", "thur", "thurs", "thursday"],
    ["ศุกร์", "ศ", "fri", "friday"],
    ["เสาร์", "ส", "sat", "saturday"],
    ["อาทิตย์", "อา", "sun", "sunday"],
];
/** A time on its own -- a column header such as "08:00", "8.00" or "8.00-9.00". */
exports.TIME_TOKEN = /^\(?([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*[-–—]\s*(?:[01]?\d|2[0-3])[:.][0-5]\d)?\)?(?:น\.?)?$/;
exports.TIME_RANGE = /([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)\s*[-–—~]\s*([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)/;
/**
 * Letters running straight into digits ("ACC315-68") or a numeric code
 * ("2110101"). A room such as "SCI-1204" has a separator after its letters,
 * and "410" is too short, so neither qualifies.
 */
exports.COURSE_CODE = /^(?:[A-Z]{2,5}\d{3}(?:-?\d{2,3})?|\d{6,8}(?:-\d{1,3})?)$/;
exports.SECTION_LABEL = /(?:sec(?:tion)?|กลุ่ม(?:เรียน)?|ตอน(?:เรียน)?|หมู่(?:เรียน)?)\s*[:.#]?\s*([A-Z0-9]{1,4})(?![A-Z0-9])/i;
exports.ROOM_LABEL = /(?:ห้อง(?:เรียน)?|room|rm\.?|อาคาร|bldg\.?)\s*[:.#]?\s*([A-Z0-9ก-๙][A-Z0-9ก-๙\-/ ]{0,20})/i;
/** Headings of the course list or exam table that often sits under the grid. */
const LOWER_TABLE = /รายวิชา|รหัสวิชา|ชื่อวิชา|ตารางสอบ|สอบกลางภาค|สอบปลายภาค|COURSE\s*(?:CODE|NAME|LIST)|EXAM/i;
const median = (values) => {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
exports.median = median;
const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
exports.hhmm = hhmm;
function rawWords(annotation) {
    const pages = annotation?.pages ?? [];
    const out = [];
    for (const page of pages) {
        for (const block of page.blocks ?? []) {
            for (const paragraph of block.paragraphs ?? []) {
                for (const word of paragraph.words ?? []) {
                    const text = (word.symbols ?? []).map((symbol) => symbol.text ?? "").join("").trim();
                    const vertices = word.boundingBox?.vertices ?? [];
                    if (!text || vertices.length < 4)
                        continue;
                    out.push({ points: vertices.map((vertex) => ({ x: Number(vertex.x ?? 0), y: Number(vertex.y ?? 0) })), text });
                }
            }
        }
    }
    return out;
}
function toWord(points, text) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return { bottom, cx: (left + right) / 2, cy: (top + bottom) / 2, height: Math.max(1, bottom - top), left, right, text, top };
}
/**
 * The tilt of the page, from the time headers, which a photo keeps in one
 * straight row however it was held. Pairs of time words vote with their slope
 * and the median wins, so a stray time inside a cell cannot swing it.
 */
function skewSlope(words) {
    const times = words.filter((word) => exports.TIME_TOKEN.test(word.text));
    const slopes = [];
    for (let i = 0; i < times.length; i += 1) {
        for (let j = i + 1; j < times.length; j += 1) {
            const dx = times[j].cx - times[i].cx;
            if (Math.abs(dx) < 3 * Math.max(times[i].height, times[j].height))
                continue;
            const slope = (times[j].cy - times[i].cy) / dx;
            if (Math.abs(slope) < 0.27)
                slopes.push(slope);
        }
    }
    return slopes.length >= 3 ? (0, exports.median)(slopes) : 0;
}
function groupLines(words) {
    const height = (0, exports.median)(words.map((word) => word.height)) || 20;
    const lines = [];
    for (const word of [...words].sort((a, b) => a.cy - b.cy || a.left - b.left)) {
        const line = lines.find((candidate) => Math.abs((0, exports.median)(candidate.map((item) => item.cy)) - word.cy) <= Math.max(4, height * 0.55));
        if (line)
            line.push(word);
        else
            lines.push([word]);
    }
    return lines
        .map((line) => [...line].sort((a, b) => a.left - b.left))
        .sort((a, b) => (0, exports.median)(a.map((word) => word.cy)) - (0, exports.median)(b.map((word) => word.cy)));
}
/**
 * Rejoins a line of words. Vision splits "(08:00-11:00)" into seven words and
 * "อ." into two, so spacing is kept only where there was a real gap and never
 * next to the punctuation those pieces break on.
 */
function joinLine(line) {
    let out = "";
    let previous = null;
    for (const word of line) {
        if (previous) {
            const tight = /[:(\-/.]$/.test(previous.text) || /^[:)\-/.]/.test(word.text);
            if (!tight && word.left - previous.right > Math.min(previous.height, word.height) * 0.35)
                out += " ";
        }
        out += word.text;
        previous = word;
    }
    return out;
}
function headerColumns(words) {
    const times = words.filter((word) => exports.TIME_TOKEN.test(word.text)).sort((a, b) => a.cy - b.cy);
    const height = (0, exports.median)(times.map((word) => word.height)) || 20;
    const groups = [];
    for (const word of times) {
        const group = groups.find((candidate) => Math.abs((0, exports.median)(candidate.map((item) => item.cy)) - word.cy) <= Math.max(8, height * 0.8));
        if (group)
            group.push(word);
        else
            groups.push([word]);
    }
    const best = groups.filter((group) => group.length >= 3).sort((a, b) => b.length - a.length || a[0].cy - b[0].cy)[0];
    if (!best)
        return null;
    const columns = [];
    let last = -1;
    for (const word of [...best].sort((a, b) => a.cx - b.cx)) {
        const match = word.text.match(exports.TIME_TOKEN);
        if (!match)
            continue;
        const minutes = Number(match[1]) * 60 + Number(match[2]);
        if (minutes <= last)
            continue;
        last = minutes;
        columns.push({ minutes, word });
    }
    if (columns.length < 3)
        return null;
    const pitch = (0, exports.median)(columns.slice(1).map((column, index) => column.word.cx - columns[index].word.cx));
    const step = (0, exports.median)(columns.slice(1).map((column, index) => column.minutes - columns[index].minutes));
    return {
        bottom: Math.max(...best.map((word) => word.bottom)),
        columns: columns.map((column, index) => ({
            endMinutes: index < columns.length - 1 ? columns[index + 1].minutes : column.minutes + step,
            left: index ? (columns[index - 1].word.cx + column.word.cx) / 2 : column.word.cx - pitch / 2,
            minutes: column.minutes,
            right: index < columns.length - 1 ? (column.word.cx + columns[index + 1].word.cx) / 2 : column.word.cx + pitch / 2,
            x: column.word.cx,
        })),
        pitch,
        words: best,
    };
}
function dayIndex(text) {
    const label = text.replace(/[.\s]/g, "").replace(/^วัน/, "").toLowerCase();
    return DAY_LABELS.findIndex((labels) => labels.includes(label));
}
function dayRows(words, gridLeft, headerBottom, cutoff) {
    const column = words.filter((word) => word.cx < gridLeft && word.cy > headerBottom && word.cy < cutoff);
    const rows = [];
    for (const line of groupLines(column)) {
        // The whole line first ("อ" + "." -> "อ."), then each word, for headers
        // such as "จันทร์ Mon" that carry a second label.
        const day = [joinLine(line), ...line.map((word) => word.text)].map(dayIndex).find((index) => index >= 0);
        if (day !== undefined)
            rows.push({ day, y: (0, exports.median)(line.map((word) => word.cy)) });
    }
    return rows.sort((a, b) => a.y - b.y);
}
/**
 * Distance per day between the day headers that were read, or 0 when they are
 * not evenly spaced in weekday order -- in which case nothing is inferred.
 */
function rowPitch(rows) {
    const steps = [];
    for (let index = 1; index < rows.length; index += 1) {
        const days = rows[index].day - rows[index - 1].day;
        if (days <= 0)
            return 0;
        steps.push((rows[index].y - rows[index - 1].y) / days);
    }
    if (!steps.length)
        return 0;
    const typical = (0, exports.median)(steps);
    return steps.every((step) => Math.abs(step - typical) <= typical * 0.25) ? typical : 0;
}
/**
 * Which day a line of the grid belongs to. A header OCR failed to read -- the
 * Monday "จ." in a real scan -- is recovered from its evenly spaced
 * neighbours; with no reliable spacing the day is left unknown rather than
 * guessed.
 */
function dayFor(y, rows, pitch, height) {
    if (!rows.length)
        return null;
    const nearest = rows.reduce((best, row) => (Math.abs(row.y - y) < Math.abs(best.y - y) ? row : best));
    if (!pitch)
        return Math.abs(nearest.y - y) <= height * 3 ? nearest.day : null;
    const offset = (y - nearest.y) / pitch;
    const steps = Math.round(offset);
    if (Math.abs(offset - steps) > 0.45)
        return null;
    const day = nearest.day + steps;
    return day >= 0 && day < 7 ? day : null;
}
function findCodes(lines) {
    const codes = [];
    for (const line of lines) {
        for (let index = 0; index < line.length; index += 1) {
            // Vision occasionally splits a code ("ACC315" "-68"), so a word and its
            // close neighbours are tried together before giving up on it.
            for (let length = 1; length <= 3 && index + length <= line.length; length += 1) {
                const parts = line.slice(index, index + length);
                const gapsTight = parts.every((part, at) => !at || part.left - parts[at - 1].right < part.height * 0.6);
                // A trailing "|" is the "CODE | NAME" separator Vision sometimes glues on.
                const text = parts.map((part) => part.text).join("").toUpperCase().replace(/\|+$/, "");
                if (!gapsTight || !exports.COURSE_CODE.test(text))
                    continue;
                codes.push({ text, word: toWord(parts.flatMap((part) => [{ x: part.left, y: part.top }, { x: part.right, y: part.bottom }]), text), words: parts });
                index += length - 1;
                break;
            }
        }
    }
    return codes;
}
/**
 * Section, room and time from one cell's lines -- by label where there is one,
 * and otherwise by shape and position: a one- or two-character value is a
 * section, a longer one containing a digit is a room. That is what keeps them
 * apart. The old text parser took the first short alphanumeric it met in a
 * window of neighbouring lines, so rooms came back as "01" and sections empty.
 */
function readCell(lines) {
    let section = null;
    let room = null;
    let time = null;
    let name = null;
    const rest = [];
    for (const line of lines) {
        const range = line.match(exports.TIME_RANGE);
        if (range && !time) {
            time = { end: (0, exports.hhmm)(Number(range[3]) * 60 + Number(range[4])), start: (0, exports.hhmm)(Number(range[1]) * 60 + Number(range[2])) };
            const remainder = line.replace(range[0], "").replace(/[()]/g, "").trim();
            if (remainder)
                rest.push(remainder);
            continue;
        }
        const labelledSection = line.match(exports.SECTION_LABEL);
        if (labelledSection && !section) {
            section = labelledSection[1];
            const remainder = line.replace(labelledSection[0], "").trim();
            if (remainder)
                rest.push(remainder);
            continue;
        }
        const labelledRoom = line.match(exports.ROOM_LABEL);
        if (labelledRoom && !room) {
            room = labelledRoom[1].trim();
            continue;
        }
        rest.push(line);
    }
    for (const line of rest) {
        const token = line.replace(/[()]/g, "").trim();
        if (!token)
            continue;
        if (!section && /^[A-Z0-9]{1,2}$/i.test(token)) {
            section = token;
            continue;
        }
        if (!room && /\d/.test(token) && /^[A-Z0-9ก-๙][A-Z0-9ก-๙\-/ ]{1,20}$/i.test(token)) {
            room = token;
            continue;
        }
        if (!name && /[A-Za-zก-๙]{3,}/.test(token))
            name = token;
    }
    return { name, room, section, time };
}
function parseScheduleGrid(annotation) {
    const nothing = { columns: [], entries: [], found: false, rows: [], skewDegrees: 0 };
    const raw = rawWords(annotation);
    if (raw.length < 6)
        return nothing;
    const angle = Math.atan(skewSlope(raw.map((item) => toWord(item.points, item.text))));
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const words = raw.map((item) => toWord(item.points.map((point) => ({ x: point.x * cos + point.y * sin, y: -point.x * sin + point.y * cos })), item.text));
    const skewDegrees = Number((angle * 180 / Math.PI).toFixed(2));
    const header = headerColumns(words);
    if (!header)
        return { ...nothing, skewDegrees };
    const height = (0, exports.median)(words.map((word) => word.height)) || 20;
    const gridLeft = header.columns[0].left;
    const gridRight = header.columns[header.columns.length - 1].right;
    const below = groupLines(words.filter((word) => word.cy > header.bottom));
    const lowerTable = below.find((line) => LOWER_TABLE.test(joinLine(line)));
    const cutoff = lowerTable ? Math.min(...lowerTable.map((word) => word.top)) : Number.POSITIVE_INFINITY;
    const rows = dayRows(words, gridLeft, header.bottom, cutoff);
    const pitch = rowPitch(rows);
    const rowHeight = pitch || height * 6;
    const headerWords = new Set(header.words);
    const gridWords = words.filter((word) => !headerWords.has(word) && word.cy > header.bottom && word.cy < cutoff &&
        word.cx >= gridLeft - header.pitch * 0.15 && word.cx <= gridRight + header.pitch * 0.5);
    // One missing trailing header can still be recovered, but nothing further
    // down counts -- that is where footers and course lists live.
    const gridBottom = Math.min(cutoff, rows.length && pitch ? rows[rows.length - 1].y + pitch * 1.6 : Number.POSITIVE_INFINITY);
    const codes = findCodes(groupLines(gridWords)).filter((code) => code.word.cy < gridBottom);
    const codeWords = new Set(codes.flatMap((code) => code.words));
    const seen = new Set();
    const entries = [];
    for (const code of codes) {
        const toTheRight = codes.filter((other) => other !== code &&
            Math.abs(other.word.top - code.word.top) < rowHeight * 0.5 && other.word.left > code.word.left);
        const xEnd = toTheRight.length ? Math.min(...toTheRight.map((other) => other.word.left)) - 1 : gridRight + header.pitch * 0.5;
        const underneath = codes.filter((other) => other !== code && other.word.top > code.word.bottom &&
            other.word.left < xEnd && other.word.right > code.word.left - height);
        const yEnd = Math.min(code.word.top + rowHeight * 0.95, underneath.length ? Math.min(...underneath.map((other) => other.word.top)) - 1 : Number.POSITIVE_INFINITY, gridBottom);
        const cellLines = groupLines(gridWords.filter((word) => !codeWords.has(word) &&
            word.cy >= code.word.top - height * 0.3 && word.cy < yEnd &&
            word.cx >= code.word.left - height && word.cx < xEnd)).map(joinLine);
        const cell = readCell(cellLines);
        const anchorX = code.word.left + height * 0.3;
        const column = header.columns.find((candidate) => anchorX >= candidate.left && anchorX < candidate.right) ??
            header.columns.reduce((best, candidate) => (Math.abs(candidate.x - anchorX) < Math.abs(best.x - anchorX) ? candidate : best));
        const dayNumber = dayFor(code.word.cy, rows, pitch, height);
        const day = dayNumber === null ? null : exports.THAI_DAYS[dayNumber];
        const startTime = cell.time?.start ?? (0, exports.hhmm)(column.minutes);
        // The end of a merged cell is its right-hand border, which Vision does not
        // report. Without a printed range it stays unknown here, for the model
        // cross-check to fill from the image or for the user to set.
        const endTime = cell.time?.end ?? null;
        const key = `${code.text.replace(/[^A-Z0-9]/g, "")}|${day}|${startTime}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        entries.push({
            buildingName: cell.room,
            classTime: endTime ? `${startTime}-${endTime}` : null,
            courseCode: code.text,
            courseName: cell.name,
            day,
            endTime,
            parserSource: "vision-grid-geometry",
            raw: [code.text, ...cellLines].join("\n"),
            reviewFields: [],
            reviewNotes: [],
            room: cell.room,
            section: cell.section,
            startTime,
        });
    }
    return {
        columns: header.columns,
        entries,
        found: entries.length > 0,
        rows: rows.map((row) => ({ day: exports.THAI_DAYS[row.day], y: row.y })),
        skewDegrees,
    };
}
//# sourceMappingURL=vision-schedule-grid.js.map