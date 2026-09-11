"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCK_EXTRACTION_PROMPT = void 0;
exports.parseCalendarBlocks = parseCalendarBlocks;
exports.extractCalendarBlocksWithGemini = extractCalendarBlocksWithGemini;
exports.crossCheckCalendarBlocks = crossCheckCalendarBlocks;
// Schemas here carry no minimum/maximum/maxItems/minItems -- see
// gemini-structured.ts.
const gemini_grid_crosscheck_1 = require("./gemini-grid-crosscheck");
const gemini_structured_1 = require("./gemini-structured");
const image_pixels_1 = require("./image-pixels");
const vision_schedule_grid_1 = require("./vision-schedule-grid");
const DAYS_AS_COLUMNS = {
    dayCenter: (box) => (box.left + box.right) / 2,
    timeCenter: (box) => (box.top + box.bottom) / 2,
    timeEnd: (box) => box.bottom,
    timeStart: (box) => box.top,
};
const DAYS_AS_ROWS = {
    dayCenter: (box) => (box.top + box.bottom) / 2,
    timeCenter: (box) => (box.left + box.right) / 2,
    timeEnd: (box) => box.right,
    timeStart: (box) => box.left,
};
const round5 = (minutes) => Math.round(minutes / 5) * 5;
const THAI_CHAR = /[฀-๿]/;
/**
 * Wrapped lines of a block, rejoined. Thai is written without spaces between
 * words, so a name wrapped between two Thai words joins with nothing;
 * anything else joins with a space.
 */
function joinWrapped(parts) {
    return parts.reduce((out, part) => {
        if (!out)
            return part;
        return THAI_CHAR.test(out.slice(-1)) && THAI_CHAR.test(part[0]) ? out + part : `${out} ${part}`;
    }, "");
}
/**
 * Which day a position on the day axis falls in. A header that starts the
 * week on Sunday puts อา. first, so Sunday counts as day -1 there to keep the
 * header in order; a header OCR missed is recovered from the even spacing of
 * the others, and with no even spacing only a position close to a header is
 * trusted.
 */
function dayScale(marks, at) {
    const monday = marks.find((mark) => mark.day === 0);
    const points = marks.map((mark) => {
        const pos = at(mark.word);
        const sundayFirst = mark.day === 6 && (monday ? pos < at(monday.word) : marks.every((other) => other === mark || pos < at(other.word)));
        return { ordinal: sundayFirst ? -1 : mark.day, pos, size: Math.max(mark.word.right - mark.word.left, mark.word.bottom - mark.word.top) };
    }).sort((a, b) => a.pos - b.pos)
        .filter((point, index, all) => all.findIndex((other) => other.ordinal === point.ordinal) === index);
    const steps = [];
    let ordered = true;
    for (let index = 1; index < points.length; index += 1) {
        const days = points[index].ordinal - points[index - 1].ordinal;
        if (days <= 0)
            ordered = false;
        else
            steps.push((points[index].pos - points[index - 1].pos) / days);
    }
    const typical = (0, vision_schedule_grid_1.median)(steps);
    const pitch = ordered && steps.length && steps.every((step) => Math.abs(step - typical) <= typical * 0.25) ? typical : 0;
    return {
        at(pos) {
            if (!points.length)
                return null;
            const nearest = points.reduce((best, point) => (Math.abs(point.pos - pos) < Math.abs(best.pos - pos) ? point : best));
            if (!pitch)
                return Math.abs(nearest.pos - pos) <= nearest.size * 3 ? ((nearest.ordinal % 7) + 7) % 7 : null;
            const offset = (pos - nearest.pos) / pitch;
            const steps = Math.round(offset);
            if (Math.abs(offset - steps) > 0.45)
                return null;
            const ordinal = nearest.ordinal + steps;
            return ordinal < -1 || ordinal > 6 ? null : ((ordinal % 7) + 7) % 7;
        },
        extent: points.length ? { from: points[0].pos - (pitch || points[0].size) / 2, to: points[points.length - 1].pos + (pitch || points[0].size) / 2 } : null,
        pitch,
    };
}
/**
 * Minutes at a position on the time axis.
 *
 * The labels give the scale, but not exactly where each hour is: a calendar
 * prints "09:00" centred on the 09:00 line, beside it, or just under it, and
 * a ruled timetable prints it in the middle of the 09:00 cell. Where the ruled
 * lines can be seen, each label is pinned to the line it names -- the line
 * before it when labels sit mid-cell, the nearest line otherwise.
 */
function timeScale(marks, at, lines, labelsMarkLines) {
    const points = marks.map((mark) => ({ minutes: mark.minutes, pos: at(mark.word) })).sort((a, b) => a.pos - b.pos);
    if (points.length < 2)
        return null;
    const rates = points.slice(1).map((point, index) => (point.pos - points[index].pos) / (point.minutes - points[index].minutes)).filter((rate) => rate > 0);
    const pxPerMinute = (0, vision_schedule_grid_1.median)(rates);
    if (!(pxPerMinute > 0))
        return null;
    const stepMinutes = (0, vision_schedule_grid_1.median)(points.slice(1).map((point, index) => point.minutes - points[index].minutes)) || 60;
    let anchors = points;
    let source = "labels";
    const before = (pos) => {
        const earlier = lines.filter((line) => line <= pos + 1);
        return earlier.length ? earlier[earlier.length - 1] : null;
    };
    if (lines.length >= 2) {
        const spacing = (0, vision_schedule_grid_1.median)(lines.slice(1).map((line, index) => line - lines[index]));
        const fractions = points.flatMap((point) => {
            const line = before(point.pos);
            return line === null ? [] : [(point.pos - line) / spacing];
        });
        if (spacing > 0 && fractions.length >= Math.max(2, points.length / 2)) {
            const midCell = (0, vision_schedule_grid_1.median)(fractions) >= 0.3 && (0, vision_schedule_grid_1.median)(fractions) <= 0.7;
            anchors = points.map((point) => {
                if (midCell)
                    return { minutes: point.minutes, pos: before(point.pos) ?? point.pos - spacing / 2 };
                const nearest = lines.reduce((best, line) => (Math.abs(line - point.pos) < Math.abs(best - point.pos) ? line : best));
                return { minutes: point.minutes, pos: Math.abs(nearest - point.pos) <= spacing * 0.35 ? nearest : point.pos };
            });
            source = "gridlines";
        }
    }
    else if (!labelsMarkLines) {
        anchors = points.map((point) => ({ minutes: point.minutes, pos: point.pos - pxPerMinute * stepMinutes / 2 }));
    }
    anchors = anchors.filter((anchor, index) => !index || anchor.pos > anchors[index - 1].pos + 1);
    if (anchors.length < 2)
        return null;
    return {
        minutesAt(pos) {
            let index = anchors.findIndex((anchor, k) => k < anchors.length - 1 && pos <= anchors[k + 1].pos);
            if (index < 0)
                index = anchors.length - 2;
            const a = anchors[index];
            const b = anchors[index + 1];
            return a.minutes + (pos - a.pos) * (b.minutes - a.minutes) / (b.pos - a.pos);
        },
        source,
    };
}
/** Section, room, a printed time range and the name, from a block's lines. */
function readBlockText(lines) {
    let time = null;
    let section = null;
    let room = null;
    const name = [];
    for (const raw of lines) {
        let line = raw;
        const range = line.match(vision_schedule_grid_1.TIME_RANGE);
        if (range && !time) {
            time = { end: Number(range[3]) * 60 + Number(range[4]), start: Number(range[1]) * 60 + Number(range[2]) };
            line = line.replace(range[0], "").replace(/[()]/g, " ");
        }
        const labelledSection = line.match(vision_schedule_grid_1.SECTION_LABEL);
        if (labelledSection && !section) {
            section = labelledSection[1];
            line = line.replace(labelledSection[0], " ");
        }
        const labelledRoom = line.match(vision_schedule_grid_1.ROOM_LABEL);
        if (labelledRoom && !room) {
            room = labelledRoom[1].trim();
            line = line.replace(labelledRoom[0], " ");
        }
        // The "|" between code and name, and any separator left at either end.
        line = line.replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, "").replace(/\s{2,}/g, " ");
        if (line)
            name.push(line);
    }
    return { name: name.length ? joinWrapped(name) : null, room, section, time };
}
function parseCalendarBlocks(layout, pixels) {
    const none = { blocks: layout.blocks.length, days: [], entries: [], evidence: [], found: false, timeScale: "none" };
    if (layout.orientation === "unknown" || !layout.dayMarks.length)
        return none;
    const columns = layout.orientation === "days-as-columns";
    const axes = columns ? DAYS_AS_COLUMNS : DAYS_AS_ROWS;
    const words = layout.words;
    const height = (0, vision_schedule_grid_1.median)(words.map((word) => word.height)) || 20;
    const days = dayScale(layout.dayMarks, axes.dayCenter);
    // The grid lies past the day header along the time axis, and past the
    // time labels along the day axis.
    const headerEdge = Math.max(...layout.dayMarks.map((mark) => axes.timeEnd(mark.word)));
    const labelEdge = layout.timeMarks.length ?
        Math.max(...layout.timeMarks.map((mark) => (columns ? mark.word.right : mark.word.bottom))) :
        Number.NEGATIVE_INFINITY;
    const pageEnd = pixels ?
        (columns ? pixels.sourceHeight : pixels.sourceWidth) :
        Math.max(...words.map((word) => axes.timeEnd(word)));
    const lines = pixels && days.extent ?
        (0, image_pixels_1.ruledLines)(pixels, columns ? "horizontal" : "vertical", days.extent, { from: headerEdge, to: pageEnd }) :
        [];
    const scale = timeScale(layout.timeMarks, axes.timeCenter, lines, columns);
    const gridWords = words.filter((word) => axes.timeCenter(word) > headerEdge && axes.dayCenter(word) > labelEdge);
    const codes = (0, vision_schedule_grid_1.findCodes)((0, vision_schedule_grid_1.groupLines)(gridWords));
    const codeWords = new Set(codes.flatMap((code) => code.words));
    const contains = (box, word, pad = 2) => word.cx >= box.left - pad && word.cx <= box.right + pad && word.cy >= box.top - pad && word.cy <= box.bottom + pad;
    const pxPerMinute = scale ? Math.abs(1 / ((scale.minutesAt(1000) - scale.minutesAt(0)) / 1000)) : 0;
    // Calendars draw a block a few pixels inside its slot, so a class ending on
    // the hour measured as five minutes early. The inset is learned from class
    // blocks (ones holding a code -- not a coloured header bar) whose edges sit
    // right next to a ruled line, and taken back off every edge, half-hour ones
    // included.
    const classBlocks = layout.blocks.filter((block) => codes.some((code) => contains(block, code.word, 0)));
    const spacing = lines.length >= 2 ? (0, vision_schedule_grid_1.median)(lines.slice(1).map((line, index) => line - lines[index])) : 0;
    const inset = (edge, sign) => {
        if (!spacing)
            return 0;
        const gaps = classBlocks.flatMap((block) => {
            const at = edge(block);
            const nearest = lines.reduce((best, line) => (Math.abs(line - at) < Math.abs(best - at) ? line : best));
            const gap = (at - nearest) * sign;
            return Math.abs(at - nearest) <= spacing * 0.12 && gap >= 0 ? [gap] : [];
        });
        return gaps.length ? Math.min((0, vision_schedule_grid_1.median)(gaps), spacing * 0.12) : 0;
    };
    const startInset = inset(axes.timeStart, 1);
    const endInset = inset(axes.timeEnd, -1);
    const seen = new Set();
    const entries = [];
    const evidence = [];
    for (const code of codes) {
        const block = layout.blocks
            .filter((candidate) => contains(candidate, code.word, 0))
            .sort((a, b) => (a.right - a.left) * (a.bottom - a.top) - (b.right - b.left) * (b.bottom - b.top))[0];
        const dayPos = block ? axes.dayCenter(block) : axes.dayCenter(code.word);
        const dayNumber = days.at(dayPos);
        let region;
        if (block) {
            region = gridWords.filter((word) => !codeWords.has(word) && contains(block, word));
        }
        else {
            // No block to bound it: the class's own day, from its code to the next
            // code in that day (or a few hours on, at most). The day comes from
            // the header, not from distance to the code -- a code sits at the start
            // of its block, and a band centred on it cut the name in half.
            const band = (code.word.right - code.word.left) * 1.5;
            const sameDay = (word) => dayNumber !== null ?
                days.at(axes.dayCenter(word)) === dayNumber :
                Math.abs(axes.dayCenter(word) - axes.dayCenter(code.word)) < band;
            const start = axes.timeStart(code.word) - height * 0.3;
            const next = codes
                .filter((other) => other !== code && sameDay(other.word) && axes.timeStart(other.word) > axes.timeStart(code.word))
                .map((other) => axes.timeStart(other.word));
            const end = Math.min(...next, start + (pxPerMinute ? pxPerMinute * 180 : height * 8));
            region = gridWords.filter((word) => !codeWords.has(word) && sameDay(word) &&
                axes.timeCenter(word) >= start && axes.timeCenter(word) < end);
        }
        // The code's own line first (its text runs straight on after the code),
        // then the wrapped lines below, each rebuilt from words that overlap in y.
        const textLines = (0, vision_schedule_grid_1.groupLines)(region).map(vision_schedule_grid_1.joinLine);
        const cell = readBlockText(textLines);
        let start = null;
        let end = null;
        const facts = { cut: false, measuredEnd: false, measuredStart: false, printed: false };
        if (cell.time && cell.time.end > cell.time.start) {
            start = cell.time.start;
            end = cell.time.end;
            facts.printed = facts.measuredStart = facts.measuredEnd = true;
        }
        else if (block && scale) {
            start = round5(scale.minutesAt(axes.timeStart(block) - startInset));
            facts.measuredStart = true;
            facts.cut = pageEnd - axes.timeEnd(block) <= 3 / (pixels?.scale ?? 1) + 1;
            if (!facts.cut) {
                end = round5(scale.minutesAt(axes.timeEnd(block) + endInset));
                facts.measuredEnd = true;
            }
        }
        else if (scale) {
            // Text starts a little inside its block; this is only an estimate, and
            // the cross-check says so unless the model agrees.
            start = round5(scale.minutesAt(axes.timeStart(code.word) - height * 0.35));
        }
        if (start !== null && (start < 0 || start >= 24 * 60))
            start = null;
        if (end !== null && (start === null || end <= start || end > 24 * 60)) {
            end = null;
            facts.measuredEnd = false;
        }
        const day = dayNumber === null ? null : vision_schedule_grid_1.THAI_DAYS[dayNumber];
        const startTime = start === null ? null : (0, vision_schedule_grid_1.hhmm)(start);
        const endTime = end === null ? null : (0, vision_schedule_grid_1.hhmm)(end);
        const key = `${code.text}|${day}|${startTime}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        entries.push({
            buildingName: cell.room,
            classTime: startTime && endTime ? `${startTime}-${endTime}` : null,
            courseCode: code.text,
            courseName: cell.name,
            day,
            endTime,
            parserSource: "vision-calendar-block",
            raw: [code.text, ...textLines].join("\n"),
            reviewFields: [],
            reviewNotes: [],
            room: cell.room,
            section: cell.section,
            startTime,
        });
        evidence.push(facts);
    }
    return {
        blocks: layout.blocks.length,
        days: [...new Set(layout.dayMarks.map((mark) => vision_schedule_grid_1.THAI_DAYS[mark.day]))],
        entries,
        evidence,
        found: entries.length > 0,
        timeScale: scale?.source ?? "none",
    };
}
exports.BLOCK_EXTRACTION_PROMPT = `You read a weekly class schedule drawn as a calendar, for a Thai student app.
Days are the columns (or rows) of the calendar, and each class is a coloured
block whose two edges along the time scale mark when it starts and ends.

For every class block visible in the image return:
- course_code: exactly as printed in the block (for example 1101041 or IST201506)
- course_name: exactly as printed in the block, joining wrapped lines
- day: MON, TUE, WED, THU, FRI, SAT or SUN -- from the header of the column (or row) the block sits in
- start_time and end_time as HH:MM, read from where the block's edges meet the
  time scale. If a time range is printed inside the block, use that.

Rules: report only blocks you can see. If a block runs off the edge of the
image, set end_time to null. Never invent a code, name or time. Reply with
JSON only.`;
const nullableString = { type: ["string", "null"] };
const BLOCK_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        courses: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    course_code: nullableString,
                    course_name: nullableString,
                    day: nullableString,
                    end_time: nullableString,
                    start_time: nullableString,
                },
                required: ["course_code", "course_name", "day", "end_time", "start_time"],
            },
        },
    },
    required: ["courses"],
};
/** Every class block the model sees in the image, or null when it cannot answer. */
async function extractCalendarBlocksWithGemini({ apiKey, imageDataUrl, ocrText, timeoutMs = 18000, }) {
    const answer = await (0, gemini_structured_1.requestStructuredJson)({
        apiKey,
        imageDataUrl,
        label: "Schedule calendar",
        prompt: exports.BLOCK_EXTRACTION_PROMPT,
        schema: BLOCK_SCHEMA,
        text: `OCR transcript of the same image (may contain errors):\n${ocrText.slice(0, 20000)}`,
        timeoutMs,
    });
    if (!answer)
        return null;
    const courses = Array.isArray(answer.value.courses) ? answer.value.courses : [];
    return { courses, model: answer.model };
}
/** Minutes the model's time may differ from a measured block edge and still agree. */
const MEASURED_TOLERANCE = 10;
/** The same for a start estimated from where the code sits. */
const ESTIMATED_TOLERANCE = 20;
const squash = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9ก-๙]/g, "");
/**
 * Thai reduced to its letters: sara am decomposed (NFKD makes it nikhahit +
 * sara aa), tone and other above-line marks dropped, and a doubled sara aa
 * collapsed. Vision reads "นำเสนอ" as "น่าเสนอ" or "นำาเสนอ" -- the letters
 * right, the marks wrong -- so a name is checked letter for letter against
 * the OCR text, not mark for mark.
 */
const foldThai = (value) => value.normalize("NFKD").replace(/[็-๎]/g, "").replace(/า{2,}/g, "า");
const minutesOf = (value) => {
    const match = String(value ?? "").trim().match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
/**
 * The model's reading, held to the image.
 *
 * - Day: the block's position under the header decides; a model day that
 *   disagrees is flagged, one filling a gap must be a day in the header.
 * - Times: a time measured from a block edge (or printed in it) stands; the
 *   model's reading replaces it only within a few minutes -- it reads the
 *   labels more cleanly than a pixel edge -- and otherwise is flagged. A time
 *   nothing measured is filled only if it is one of the printed labels, else
 *   left empty and flagged with the model's reading in the note. A block cut
 *   off by the image edge never gets an end time.
 * - Name: kept from OCR, but the model's spelling wins when the letters are
 *   the same; a different name is flagged when the OCR text also contains it.
 * - Course: one only the model saw is kept, flagged, if its code is in the
 *   OCR text, and dropped otherwise.
 */
function crossCheckCalendarBlocks(geometry, courses, ocrText) {
    const evidence = (0, gemini_grid_crosscheck_1.ocrEvidence)(ocrText, geometry.days);
    const ocrLetters = foldThai(evidence.squashed);
    const stats = {
        added: 0, agreed: 0, blocks: geometry.blocks, conflicts: 0, correctedNames: 0, dropped: 0,
        filled: 0, flagged: 0, geminiCourses: courses.length, geometryCourses: geometry.entries.length,
    };
    const flag = (entry, field, note) => {
        entry.reviewFields = [...new Set([...(entry.reviewFields ?? []), field])];
        entry.reviewNotes = [...(entry.reviewNotes ?? []), note];
        stats.flagged += 1;
    };
    const applyDay = (entry, course) => {
        const offered = (0, gemini_grid_crosscheck_1.normalizeGridDay)(course.day);
        if (!offered)
            return;
        const current = typeof entry.day === "string" ? entry.day : "";
        const inHeader = evidence.days.has(offered);
        if (current) {
            if (current === offered)
                stats.agreed += 1;
            else if (inHeader) {
                flag(entry, "day", `${gemini_grid_crosscheck_1.GRID_FIELD_LABELS.day}: ตำแหน่งในตารางคือ "${current}" แต่ AI อ่านเป็น "${offered}"`);
                stats.conflicts += 1;
            }
        }
        else if (inHeader) {
            entry.day = offered;
            stats.filled += 1;
        }
        else {
            flag(entry, "day", `${gemini_grid_crosscheck_1.GRID_FIELD_LABELS.day}: AI อ่านได้ "${offered}" แต่ไม่พบในหัวตาราง จึงยังไม่กรอกให้`);
        }
    };
    const applyName = (entry, course) => {
        const offered = String(course.course_name ?? "").trim();
        if (!offered)
            return;
        const current = String(entry.courseName ?? "").trim();
        const offeredLetters = foldThai(squash(offered));
        const verified = offeredLetters.length >= 3 && ocrLetters.includes(offeredLetters);
        if (current) {
            if (squash(current) === squash(offered))
                stats.agreed += 1;
            else if (foldThai(squash(current)) === offeredLetters) {
                entry.courseName = offered;
                stats.correctedNames += 1;
            }
            else if (verified) {
                flag(entry, "courseName", `ชื่อวิชา: ระบบอ่านได้ "${current}" แต่ AI อ่านเป็น "${offered}"`);
                stats.conflicts += 1;
            }
            return;
        }
        if (verified) {
            entry.courseName = offered;
            stats.filled += 1;
        }
        else {
            flag(entry, "courseName", `ชื่อวิชา: AI อ่านได้ "${offered}" แต่ไม่พบในข้อความที่สแกน จึงยังไม่กรอกให้`);
        }
    };
    const applyTimes = (entry, facts, course) => {
        for (const field of ["startTime", "endTime"]) {
            const label = gemini_grid_crosscheck_1.GRID_FIELD_LABELS[field];
            const offered = minutesOf(course?.[field === "startTime" ? "start_time" : "end_time"]);
            const offeredText = offered === null ? null : (0, vision_schedule_grid_1.hhmm)(offered);
            const current = minutesOf(entry[field]);
            const measured = Boolean(facts && (field === "startTime" ? facts.measuredStart : facts.measuredEnd));
            if (field === "endTime" && facts?.cut) {
                entry.endTime = null;
                flag(entry, field, offeredText ?
                    `${label}: กรอบวิชาถูกตัดที่ขอบภาพ AI อ่านได้ "${offeredText}" แต่ยืนยันจากภาพไม่ได้ จึงยังไม่กรอกให้` :
                    `${label}: กรอบวิชาถูกตัดที่ขอบภาพ กรุณากรอกเอง`);
                continue;
            }
            if (current !== null && measured) {
                if (offered === null)
                    continue;
                if (Math.abs(offered - current) <= MEASURED_TOLERANCE) {
                    stats.agreed += 1;
                    if (!facts?.printed)
                        entry[field] = offeredText;
                }
                else {
                    flag(entry, field, `${label}: วัดจากกรอบในภาพได้ "${(0, vision_schedule_grid_1.hhmm)(current)}" แต่ AI อ่านเป็น "${offeredText}"`);
                    stats.conflicts += 1;
                }
                continue;
            }
            if (current !== null) {
                if (offered !== null && Math.abs(offered - current) <= ESTIMATED_TOLERANCE) {
                    entry[field] = offeredText;
                    stats.agreed += 1;
                }
                else {
                    flag(entry, field, `${label}: ประมาณจากตำแหน่งในภาพได้ "${(0, vision_schedule_grid_1.hhmm)(current)}"${offeredText ? ` แต่ AI อ่านเป็น "${offeredText}"` : ""} กรุณาตรวจสอบ`);
                }
                continue;
            }
            if (offeredText && evidence.times.has(offeredText)) {
                entry[field] = offeredText;
                stats.filled += 1;
            }
            else if (offeredText) {
                flag(entry, field, `${label}: AI อ่านได้ "${offeredText}" แต่ยืนยันจากภาพไม่ได้ จึงยังไม่กรอกให้`);
            }
            else {
                flag(entry, field, `${label}: อ่านขอบของกรอบวิชาไม่ได้ กรุณากรอกเอง`);
            }
        }
        const start = minutesOf(entry.startTime);
        const end = minutesOf(entry.endTime);
        if (start !== null && end !== null) {
            if (start >= end)
                flag(entry, "endTime", `${gemini_grid_crosscheck_1.GRID_FIELD_LABELS.endTime}: เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม`);
            else
                entry.classTime = `${entry.startTime}-${entry.endTime}`;
        }
    };
    const entries = geometry.entries.map((entry) => ({
        ...entry,
        reviewFields: [...(entry.reviewFields ?? [])],
        reviewNotes: [...(entry.reviewNotes ?? [])],
    }));
    const used = new Set();
    entries.forEach((entry, index) => {
        const key = squash(entry.courseCode);
        const matchAt = (withDay) => courses.findIndex((course, at) => !used.has(at) && squash(course.course_code) === key &&
            (!withDay || !entry.day || (0, gemini_grid_crosscheck_1.normalizeGridDay)(course.day) === entry.day));
        let at = matchAt(true);
        if (at < 0)
            at = matchAt(false);
        const course = at >= 0 ? courses[at] : null;
        if (course) {
            used.add(at);
            applyDay(entry, course);
            applyName(entry, course);
        }
        applyTimes(entry, geometry.evidence[index] ?? null, course);
    });
    courses.forEach((course, at) => {
        if (used.has(at))
            return;
        const code = squash(course.course_code);
        if (code.length < 4 || !evidence.squashed.includes(code)) {
            stats.dropped += 1;
            return;
        }
        const entry = {
            courseCode: String(course.course_code).trim().toUpperCase(),
            courseName: null,
            day: null,
            endTime: null,
            parserSource: "gemini-calendar-only",
            reviewFields: ["courseCode"],
            reviewNotes: ["พบวิชานี้จาก AI เท่านั้น ระบบอ่านตารางไม่พบ กรุณาตรวจสอบ"],
            room: null,
            section: null,
            startTime: null,
        };
        applyDay(entry, course);
        applyName(entry, course);
        applyTimes(entry, null, course);
        entries.push(entry);
        stats.added += 1;
    });
    return { entries, stats };
}
//# sourceMappingURL=calendar-block-schedule.js.map