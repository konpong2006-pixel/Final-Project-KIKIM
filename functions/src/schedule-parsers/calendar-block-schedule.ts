// Schemas here carry no minimum/maximum/maxItems/minItems -- see
// gemini-structured.ts.
import {GRID_FIELD_LABELS, normalizeGridDay, ocrEvidence} from "./gemini-grid-crosscheck";
import {requestStructuredJson} from "./gemini-structured";
import {ruledLines, type ScanPixels} from "./image-pixels";
import type {DayMark, ScheduleLayout, TimeMark} from "./schedule-layout";
import type {StandardScheduleEntry} from "./types";
import {
  COURSE_CODE,
  findCodes,
  groupLines,
  hhmm,
  joinLine,
  median,
  ROOM_LABEL,
  SECTION_LABEL,
  THAI_DAYS,
  TIME_RANGE,
  toWord,
  type Word,
} from "./vision-schedule-grid";

/**
 * Reads a calendar-style timetable: each class a coloured block placed in its
 * day's column (or row), whose edges -- not any printed text -- say when it
 * starts and ends. A registration portal's "my schedule" week view is the
 * usual source: days across the top, hours down the side, and a block
 * holding "1101041 | ภาษาอังกฤษเพื่อการนำเสนอทางธุรกิจ".
 *
 * The ruled-grid reader cannot read these. It looks for a row of time headers
 * and fixed cells, and here the times run down the side and a class spans as
 * far as its block does. So this reader works on two axes chosen by the
 * detected orientation -- the day axis and the time axis -- and measures:
 *
 * - the day from the aligned day header the block sits under;
 * - start and end from the block's edges in the pixels, against the time
 *   labels (snapped to the ruled hour lines where they can be found);
 * - code and name from the words inside the block.
 *
 * Gemini then reads the same image for a second opinion, and its values are
 * held to what was measured or printed -- see crossCheckCalendarBlocks.
 */

type Box = {bottom: number; left: number; right: number; top: number};
type Axes = {
  dayCenter: (box: Box) => number;
  timeCenter: (box: Box) => number;
  timeEnd: (box: Box) => number;
  timeStart: (box: Box) => number;
};
const DAYS_AS_COLUMNS: Axes = {
  dayCenter: (box) => (box.left + box.right) / 2,
  timeCenter: (box) => (box.top + box.bottom) / 2,
  timeEnd: (box) => box.bottom,
  timeStart: (box) => box.top,
};
const DAYS_AS_ROWS: Axes = {
  dayCenter: (box) => (box.top + box.bottom) / 2,
  timeCenter: (box) => (box.left + box.right) / 2,
  timeEnd: (box) => box.right,
  timeStart: (box) => box.left,
};

/** How each entry's times were obtained, for the cross-check to weigh the model against. */
export type BlockEvidence = {
  /** The block runs off the edge of the image, so its end is not visible. */
  cut: boolean;
  measuredEnd: boolean;
  measuredStart: boolean;
  /** A time range was printed inside the block. */
  printed: boolean;
  /**
   * No trustworthy time scale reaches this class -- the label fit was refused,
   * or the class lies outside the grid the labels span -- so its times were
   * not measured at all, rather than measured wrongly.
   */
  unmeasurable: boolean;
};
export type CalendarBlockGeometry = {
  blocks: number;
  /** Day names from the header, for checking the model's days. */
  days: string[];
  entries: StandardScheduleEntry[];
  evidence: BlockEvidence[];
  found: boolean;
  timeScale: "gridlines" | "labels" | "none";
};

const round5 = (minutes: number) => Math.round(minutes / 5) * 5;
const THAI_CHAR = /[฀-๿]/;

/**
 * Wrapped lines of a block, rejoined. Thai is written without spaces between
 * words, so a name wrapped between two Thai words joins with nothing;
 * anything else joins with a space.
 */
function joinWrapped(parts: string[]) {
  return parts.reduce((out, part) => {
    if (!out) return part;
    return THAI_CHAR.test(out.slice(-1)) && THAI_CHAR.test(part[0]) ? out + part : `${out} ${part}`;
  }, "");
}

/**
 * Which day a position on the day axis falls in.
 *
 * The columns come from where the headers sit, not from what they say: their
 * spacing gives the column width, and each header gets a slot number. Which
 * weekday slot 0 is is then decided by vote -- the start day most headers
 * agree with -- so one misread header cannot scramble the week. On a phone
 * screenshot Vision read the narrow "จ." as "ส.", and trusting labels one by
 * one left every Monday class with no day at all. Weeks starting on Sunday
 * or Monday need no special case.
 */
function dayScale(marks: DayMark[], at: (box: Box) => number) {
  const none = {at: (): number | null => null, extent: null as {from: number; to: number} | null, pitch: 0};
  const points = marks.map((mark) => ({day: mark.day, pos: at(mark.word)})).sort((a, b) => a.pos - b.pos);
  if (points.length < 3) return none;
  const gaps = points.slice(1).map((point, index) => point.pos - points[index].pos);
  const typical = median(gaps);
  // Pieces of one header ("พ" + "ฤ") sit far closer than any two columns.
  const real = gaps.filter((gap) => gap >= typical * 0.4);
  if (!real.length) return none;
  const smallest = Math.min(...real);
  const pitch = median(real.filter((gap) => gap <= smallest * 1.35));
  if (!(pitch > 0)) return none;
  const origin = points[0].pos;
  const slots = points
    .map((point) => ({day: point.day, exact: (point.pos - origin) / pitch}))
    .map((point) => ({...point, slot: Math.round(point.exact)}))
    .filter((point) => Math.abs(point.exact - point.slot) <= 0.3);
  let best = {agree: -1, first: 0};
  for (let first = 0; first < 7; first += 1) {
    const agree = slots.filter((point) => (first + point.slot) % 7 === point.day).length;
    if (agree > best.agree) best = {agree, first};
  }
  if (best.agree < Math.max(3, Math.ceil(slots.length / 2))) return none;
  const lastSlot = Math.max(...slots.map((point) => point.slot));
  return {
    at(pos: number): number | null {
      const exact = (pos - origin) / pitch;
      const slot = Math.round(exact);
      // A week has seven columns: never more than that, counting any the
      // header missed at either end.
      if (Math.abs(exact - slot) > 0.45 || slot < lastSlot - 6 || slot > 6) return null;
      return (((best.first + slot) % 7) + 7) % 7;
    },
    extent: {from: origin - pitch / 2, to: origin + (lastSlot + 0.5) * pitch},
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
/** Least-squares minutes = a + b * position, with its residuals in minutes. */
function fitLine(anchors: {minutes: number; pos: number}[]) {
  const n = anchors.length;
  const meanPos = anchors.reduce((sum, anchor) => sum + anchor.pos, 0) / n;
  const meanMinutes = anchors.reduce((sum, anchor) => sum + anchor.minutes, 0) / n;
  const spread = anchors.reduce((sum, anchor) => sum + (anchor.pos - meanPos) ** 2, 0);
  const b = spread ? anchors.reduce((sum, anchor) => sum + (anchor.pos - meanPos) * (anchor.minutes - meanMinutes), 0) / spread : 0;
  const a = meanMinutes - b * meanPos;
  const residuals = anchors.map((anchor) => a + b * anchor.pos - anchor.minutes);
  return {
    a,
    b,
    max: Math.max(...residuals.map(Math.abs)),
    rms: Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / n),
  };
}

/**
 * The time scale, or null when it cannot be trusted.
 *
 * Only labels that fall on one straight line count: every pair of labels
 * proposes a line, and the one most labels agree with wins. A phone
 * screenshot's status-bar clock ("14:40", above the grid, in the same column
 * as the hour labels) agrees with none of them, where before it was taken as
 * a label and put every morning class at 14:50. The survivors are pinned to
 * the ruled lines where those can be seen, then fitted by least squares; a
 * fit with a large residual, a backwards slope or times outside the day is
 * refused rather than used -- a wrong time stated confidently is worse than
 * one the user is asked for.
 */
function timeScale(marks: TimeMark[], at: (box: Box) => number, lines: number[], labelsMarkLines: boolean) {
  const all = marks.map((mark) => ({minutes: mark.minutes, pos: at(mark.word)})).sort((a, b) => a.pos - b.pos);
  if (all.length < 3) return null;
  let points: {minutes: number; pos: number}[] = [];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      if (all[j].pos === all[i].pos) continue;
      const b = (all[j].minutes - all[i].minutes) / (all[j].pos - all[i].pos);
      if (!(b > 0)) continue;
      const a = all[i].minutes - b * all[i].pos;
      const agree = all.filter((point) => Math.abs(a + b * point.pos - point.minutes) <= 7);
      if (agree.length > points.length) points = agree;
    }
  }
  // Most labels must agree. A real scale has nearly every hour label on its
  // line and a status-bar clock is one stray; a line only a few labels share
  // is a coincidence, however straight.
  if (points.length < Math.max(3, Math.ceil(all.length * 0.6))) {
    console.warn("[Schedule calendar] Time labels do not form one scale.", {agreeing: points.length, labels: all.length});
    return null;
  }
  const rates = points.slice(1).map((point, index) => (point.pos - points[index].pos) / (point.minutes - points[index].minutes)).filter((rate) => rate > 0);
  const pxPerMinute = median(rates);
  if (!(pxPerMinute > 0)) return null;
  const stepMinutes = median(points.slice(1).map((point, index) => point.minutes - points[index].minutes)) || 60;
  let anchors = points;
  let source: "gridlines" | "labels" = "labels";
  const before = (pos: number) => {
    const earlier = lines.filter((line) => line <= pos + 1);
    return earlier.length ? earlier[earlier.length - 1] : null;
  };
  if (lines.length >= 2) {
    const spacing = median(lines.slice(1).map((line, index) => line - lines[index]));
    const fractions = points.flatMap((point) => {
      const line = before(point.pos);
      return line === null ? [] : [(point.pos - line) / spacing];
    });
    if (spacing > 0 && fractions.length >= Math.max(2, points.length / 2)) {
      const midCell = median(fractions) >= 0.3 && median(fractions) <= 0.7;
      anchors = points.map((point) => {
        if (midCell) return {minutes: point.minutes, pos: before(point.pos) ?? point.pos - spacing / 2};
        const nearest = lines.reduce((best, line) => (Math.abs(line - point.pos) < Math.abs(best - point.pos) ? line : best));
        return {minutes: point.minutes, pos: Math.abs(nearest - point.pos) <= spacing * 0.35 ? nearest : point.pos};
      });
      source = "gridlines";
    }
  } else if (!labelsMarkLines) {
    anchors = points.map((point) => ({minutes: point.minutes, pos: point.pos - pxPerMinute * stepMinutes / 2}));
  }
  anchors = anchors.filter((anchor, index) => !index || anchor.pos > anchors[index - 1].pos + 1);
  if (anchors.length < 3) return null;
  let fit = fitLine(anchors);
  // Pinning to a wrong line would show up here; the labels alone may still fit.
  if (source === "gridlines" && (fit.rms > 4 || fit.max > 8)) {
    anchors = points;
    source = "labels";
    fit = fitLine(anchors);
  }
  const first = Math.min(...anchors.map((anchor) => anchor.minutes));
  const last = Math.max(...anchors.map((anchor) => anchor.minutes));
  if (!(fit.b > 0) || fit.rms > 4 || fit.max > 8 || first < 0 || last > 24 * 60) {
    console.warn("[Schedule calendar] Time scale refused.", {labels: anchors.length, max: fit.max, rms: fit.rms, slope: fit.b});
    return null;
  }
  const stepPx = stepMinutes / fit.b;
  return {
    /** How far the fitted labels reach, a step either side: the grid itself. */
    grid: {from: Math.min(...anchors.map((anchor) => anchor.pos)) - stepPx, to: Math.max(...anchors.map((anchor) => anchor.pos)) + stepPx},
    minutesAt: (pos: number) => fit.a + fit.b * pos,
    rms: Number(fit.rms.toFixed(2)),
    source,
  };
}

/** Section, room, a printed time range and the name, from a block's lines. */
function readBlockText(lines: string[]) {
  let time: {end: number; start: number} | null = null;
  let section: string | null = null;
  let room: string | null = null;
  const name: string[] = [];
  for (const raw of lines) {
    let line = raw;
    const range = line.match(TIME_RANGE);
    if (range && !time) {
      time = {end: Number(range[3]) * 60 + Number(range[4]), start: Number(range[1]) * 60 + Number(range[2])};
      line = line.replace(range[0], "").replace(/[()]/g, " ");
    }
    const labelledSection = line.match(SECTION_LABEL);
    if (labelledSection && !section) {
      section = labelledSection[1];
      line = line.replace(labelledSection[0], " ");
    }
    const labelledRoom = line.match(ROOM_LABEL);
    if (labelledRoom && !room) {
      room = labelledRoom[1].trim();
      line = line.replace(labelledRoom[0], " ");
    }
    // The "|" between code and name, and any separator left at either end.
    line = line.replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, "").replace(/\s{2,}/g, " ");
    if (line) name.push(line);
  }
  // Vision splits Thai into words, and a gap it leaves between two of them is
  // not a space the portal printed ("เสนอ ทาง" on the real scan).
  const joined = name.length ? joinWrapped(name).replace(/([฀-๿])\s+(?=[฀-๿])/g, "$1") : null;
  return {name: joined, room, section, time};
}

export function parseCalendarBlocks(layout: ScheduleLayout, pixels: ScanPixels | null): CalendarBlockGeometry {
  const none: CalendarBlockGeometry = {blocks: layout.blocks.length, days: [], entries: [], evidence: [], found: false, timeScale: "none"};
  if (layout.orientation === "unknown" || !layout.dayMarks.length) return none;
  const columns = layout.orientation === "days-as-columns";
  const axes = columns ? DAYS_AS_COLUMNS : DAYS_AS_ROWS;
  const words = layout.words;
  const height = median(words.map((word) => word.height)) || 20;
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
    ruledLines(pixels, columns ? "horizontal" : "vertical", days.extent, {from: headerEdge, to: pageEnd}) :
    [];
  const scale = timeScale(layout.timeMarks, axes.timeCenter, lines, columns);

  const gridWords = words.filter((word) => axes.timeCenter(word) > headerEdge && axes.dayCenter(word) > labelEdge);
  const codes = findCodes(groupLines(gridWords));
  // A code wrapped in a narrow column: the real portal printed "IST20" over
  // "1506 |", and neither piece is a code on its own. A piece whose
  // continuation sits right under it is joined -- only where the portal's
  // "CODE | NAME" separator follows, so a room number is never glued on.
  const taken = new Set(codes.flatMap((code) => code.words));
  for (const upper of gridWords) {
    if (taken.has(upper) || !/^(?:[A-Z]{2,5}\d{0,6}|\d{3,7})$/i.test(upper.text)) continue;
    const lower = gridWords.find((word) => !taken.has(word) && word !== upper && /^\d{1,6}\|?$/.test(word.text) &&
      // The next line down: small block text has a line gap as tall as the
      // text itself (10 px under 9 px letters on the real scan).
      Math.abs(word.left - upper.left) <= upper.height && word.top > upper.top && word.top - upper.bottom <= upper.height * 1.6);
    if (!lower) continue;
    const text = `${upper.text}${lower.text.replace(/\|$/, "")}`.toUpperCase();
    const separated = lower.text.endsWith("|") || gridWords.some((word) => word.text === "|" &&
      Math.abs(word.cy - lower.cy) < lower.height && word.left >= lower.right - 2 && word.left - lower.right < lower.height);
    if (!COURSE_CODE.test(text) || !separated) continue;
    codes.push({
      text,
      word: toWord([{x: Math.min(upper.left, lower.left), y: upper.top}, {x: Math.max(upper.right, lower.right), y: lower.bottom}], text),
      words: [upper, lower],
    });
    taken.add(upper);
    taken.add(lower);
  }
  const codeWords = new Set(codes.flatMap((code) => code.words));
  const contains = (box: Box, word: Word, pad = 2) =>
    word.cx >= box.left - pad && word.cx <= box.right + pad && word.cy >= box.top - pad && word.cy <= box.bottom + pad;
  const pxPerMinute = scale ? Math.abs(1 / ((scale.minutesAt(1000) - scale.minutesAt(0)) / 1000)) : 0;

  // Calendars draw a block a few pixels inside its slot, so a class ending on
  // the hour measured as five minutes early. The inset is learned from class
  // blocks (ones holding a code -- not a coloured header bar) whose edges sit
  // right next to a ruled line, and taken back off every edge, half-hour ones
  // included.
  const classBlocks = layout.blocks.filter((block) => codes.some((code) => contains(block, code.word, 0)));
  const spacing = lines.length >= 2 ? median(lines.slice(1).map((line, index) => line - lines[index])) : 0;
  // Either way: the real portal's blocks carry a border that overhangs the
  // hour line by a few pixels, which read every end five to ten minutes late.
  const inset = (edge: (box: Box) => number, sign: 1 | -1) => {
    if (!spacing) return 0;
    const gaps = classBlocks.flatMap((block) => {
      const at = edge(block);
      const nearest = lines.reduce((best, line) => (Math.abs(line - at) < Math.abs(best - at) ? line : best));
      return Math.abs(at - nearest) <= spacing * 0.12 ? [(at - nearest) * sign] : [];
    });
    const typical = gaps.length ? median(gaps) : 0;
    return Math.max(-spacing * 0.12, Math.min(typical, spacing * 0.12));
  };
  const startInset = inset(axes.timeStart, 1);
  const endInset = inset(axes.timeEnd, -1);

  const seen = new Set<string>();
  const entries: StandardScheduleEntry[] = [];
  const evidence: BlockEvidence[] = [];
  for (const code of codes) {
    const block = layout.blocks
      .filter((candidate) => contains(candidate, code.word, 0))
      .sort((a, b) => (a.right - a.left) * (a.bottom - a.top) - (b.right - b.left) * (b.bottom - b.top))[0];
    const dayPos = block ? axes.dayCenter(block) : axes.dayCenter(code.word);
    const dayNumber = days.at(dayPos);

    let region: Word[];
    if (block) {
      region = gridWords.filter((word) => !codeWords.has(word) && contains(block, word));
    } else {
      // No block to bound it: the class's own day, from its code to the next
      // code in that day (or a few hours on, at most). The day comes from
      // the header, not from distance to the code -- a code sits at the start
      // of its block, and a band centred on it cut the name in half.
      const band = (code.word.right - code.word.left) * 1.5;
      const sameDay = (word: Word) => dayNumber !== null ?
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
    const textLines = groupLines(region).map(joinLine);
    // A code wrapped in a narrow column -- "IST20150" on one line, "6 |
    // สุขภาพองค์รวม" on the next. What comes before the "|" is the code's.
    let codeText = code.text;
    const tail = textLines[0]?.match(/^([A-Z0-9]{1,4})\s*\|/i);
    if (tail && COURSE_CODE.test(`${codeText}${tail[1].toUpperCase()}`)) {
      codeText = `${codeText}${tail[1].toUpperCase()}`;
      textLines[0] = textLines[0].slice(tail[1].length);
    }
    const cell = readBlockText(textLines);

    let start: number | null = null;
    let end: number | null = null;
    const facts: BlockEvidence = {cut: false, measuredEnd: false, measuredStart: false, printed: false, unmeasurable: false};
    const leading = axes.timeStart(block ?? code.word);
    if (cell.time && cell.time.end > cell.time.start) {
      start = cell.time.start;
      end = cell.time.end;
      facts.printed = facts.measuredStart = facts.measuredEnd = true;
    } else if (!scale || leading < scale.grid.from || leading > scale.grid.to) {
      // Nothing trustworthy to measure against: the label fit was refused,
      // or this sits outside the grid the labels span (a screen header, a
      // tab bar). Left unmeasured, and the cross-check says so.
      facts.unmeasurable = true;
    } else if (block) {
      start = round5(scale.minutesAt(axes.timeStart(block) - startInset));
      facts.measuredStart = true;
      facts.cut = pageEnd - axes.timeEnd(block) <= 3 / (pixels?.scale ?? 1) + 1;
      if (!facts.cut) {
        end = round5(scale.minutesAt(axes.timeEnd(block) + endInset));
        facts.measuredEnd = true;
      }
    } else {
      // Text starts a little inside its block; this is only an estimate, and
      // the cross-check says so unless the model agrees.
      start = round5(scale.minutesAt(axes.timeStart(code.word) - height * 0.35));
    }
    if (start !== null && (start < 0 || start >= 24 * 60)) start = null;
    if (end !== null && (start === null || end <= start || end > 24 * 60)) {
      end = null;
      facts.measuredEnd = false;
    }

    const day = dayNumber === null ? null : THAI_DAYS[dayNumber];
    const startTime = start === null ? null : hhmm(start);
    const endTime = end === null ? null : hhmm(end);
    const key = `${codeText}|${day}|${startTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      buildingName: cell.room,
      classTime: startTime && endTime ? `${startTime}-${endTime}` : null,
      courseCode: codeText,
      courseName: cell.name,
      day,
      endTime,
      parserSource: "vision-calendar-block",
      raw: [codeText, ...textLines].join("\n"),
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
    days: [...new Set(layout.dayMarks.map((mark) => THAI_DAYS[mark.day]))],
    entries,
    evidence,
    found: entries.length > 0,
    timeScale: scale?.source ?? "none",
  };
}

export type GeminiBlockCourse = {
  course_code: string | null;
  course_name: string | null;
  day: string | null;
  end_time: string | null;
  start_time: string | null;
};

export const BLOCK_EXTRACTION_PROMPT = `You read a weekly class schedule drawn as a calendar, for a Thai student app.
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

const nullableString = {type: ["string", "null"]} as const;
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
} as const;

/** Every class block the model sees in the image, or null when it cannot answer. */
export async function extractCalendarBlocksWithGemini({
  apiKey,
  imageDataUrl,
  ocrText,
  timeoutMs = 18000,
}: {
  apiKey: string;
  imageDataUrl: string;
  ocrText: string;
  timeoutMs?: number;
}): Promise<{courses: GeminiBlockCourse[]; model: string} | null> {
  const answer = await requestStructuredJson<{courses?: unknown}>({
    apiKey,
    imageDataUrl,
    label: "Schedule calendar",
    prompt: BLOCK_EXTRACTION_PROMPT,
    schema: BLOCK_SCHEMA,
    text: `OCR transcript of the same image (may contain errors):\n${ocrText.slice(0, 20000)}`,
    timeoutMs,
  });
  if (!answer) return null;
  const courses = Array.isArray(answer.value.courses) ? answer.value.courses as GeminiBlockCourse[] : [];
  return {courses, model: answer.model};
}

export type CalendarCrossCheckStats = {
  added: number;
  agreed: number;
  blocks: number;
  conflicts: number;
  /** Names whose letters OCR confirmed but whose tone marks the model read better. */
  correctedNames: number;
  dropped: number;
  filled: number;
  flagged: number;
  geminiCourses: number;
  geometryCourses: number;
};

/** Minutes the model's time may differ from a measured block edge and still agree. */
const MEASURED_TOLERANCE = 10;
/** The same for a start estimated from where the code sits. */
const ESTIMATED_TOLERANCE = 20;

const squash = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9ก-๙]/g, "");
/**
 * Thai reduced to its letters: sara am decomposed (NFKD makes it nikhahit +
 * sara aa), tone and other above-line marks dropped, and a doubled sara aa
 * collapsed. Vision reads "นำเสนอ" as "น่าเสนอ" or "นำาเสนอ" -- the letters
 * right, the marks wrong -- so a name is checked letter for letter against
 * the OCR text, not mark for mark.
 */
const foldThai = (value: string) => value.normalize("NFKD").replace(/[็-๎]/g, "").replace(/า{2,}/g, "า");
/** Share of letters two readings have in common: 1 - edit distance / the longer length. */
function letterAgreement(a: string, b: string) {
  if (!a || !b) return 0;
  let previous = Array.from({length: b.length + 1}, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}
const minutesOf = (value: unknown) => {
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
export function crossCheckCalendarBlocks(
  geometry: CalendarBlockGeometry,
  courses: GeminiBlockCourse[],
  ocrText: string,
): {entries: StandardScheduleEntry[]; stats: CalendarCrossCheckStats} {
  const evidence = ocrEvidence(ocrText, geometry.days);
  const ocrLetters = foldThai(evidence.squashed);
  const stats: CalendarCrossCheckStats = {
    added: 0, agreed: 0, blocks: geometry.blocks, conflicts: 0, correctedNames: 0, dropped: 0,
    filled: 0, flagged: 0, geminiCourses: courses.length, geometryCourses: geometry.entries.length,
  };
  const flag = (entry: StandardScheduleEntry, field: string, note: string) => {
    entry.reviewFields = [...new Set([...(entry.reviewFields ?? []), field])];
    entry.reviewNotes = [...(entry.reviewNotes ?? []), note];
    stats.flagged += 1;
  };

  const applyDay = (entry: StandardScheduleEntry, course: GeminiBlockCourse) => {
    const offered = normalizeGridDay(course.day);
    if (!offered) return;
    const current = typeof entry.day === "string" ? entry.day : "";
    const inHeader = evidence.days.has(offered);
    if (current) {
      if (current === offered) stats.agreed += 1;
      else if (inHeader) {
        flag(entry, "day", `${GRID_FIELD_LABELS.day}: ตำแหน่งในตารางคือ "${current}" แต่ AI อ่านเป็น "${offered}"`);
        stats.conflicts += 1;
      }
    } else if (inHeader) {
      entry.day = offered;
      stats.filled += 1;
    } else {
      flag(entry, "day", `${GRID_FIELD_LABELS.day}: AI อ่านได้ "${offered}" แต่ไม่พบในหัวตาราง จึงยังไม่กรอกให้`);
    }
  };

  const applyName = (entry: StandardScheduleEntry, course: GeminiBlockCourse) => {
    const offered = String(course.course_name ?? "").trim();
    if (!offered) return;
    const current = String(entry.courseName ?? "").trim();
    const offeredLetters = foldThai(squash(offered));
    const verified = offeredLetters.length >= 3 && ocrLetters.includes(offeredLetters);
    if (current) {
      if (squash(current) === squash(offered)) stats.agreed += 1;
      else if (letterAgreement(foldThai(squash(current)), offeredLetters) >= 0.85) {
        // OCR confirms nearly every letter of the model's reading; what
        // differs is what OCR is known to get wrong in Thai -- a mark, one
        // misread letter (the real scan read "นำ" as "บ้า"), one dropped
        // syllable ("ผู้" of "ผู้ประกอบการธุรกิจ").
        entry.courseName = offered;
        stats.correctedNames += 1;
      } else if (verified) {
        flag(entry, "courseName", `ชื่อวิชา: ระบบอ่านได้ "${current}" แต่ AI อ่านเป็น "${offered}"`);
        stats.conflicts += 1;
      }
      return;
    }
    if (verified) {
      entry.courseName = offered;
      stats.filled += 1;
    } else {
      flag(entry, "courseName", `ชื่อวิชา: AI อ่านได้ "${offered}" แต่ไม่พบในข้อความที่สแกน จึงยังไม่กรอกให้`);
    }
  };

  const applyTimes = (entry: StandardScheduleEntry, facts: BlockEvidence | null, course: GeminiBlockCourse | null) => {
    for (const field of ["startTime", "endTime"] as const) {
      const label = GRID_FIELD_LABELS[field];
      const offered = minutesOf(course?.[field === "startTime" ? "start_time" : "end_time"]);
      const offeredText = offered === null ? null : hhmm(offered);
      const current = minutesOf(entry[field]);
      const measured = Boolean(facts && (field === "startTime" ? facts.measuredStart : facts.measuredEnd));
      if (facts?.unmeasurable) {
        // The scan gave nothing to hold the model's time to, so it is
        // offered in the note, never filled in as if it had been checked.
        entry[field] = null;
        flag(entry, field, offeredText ?
          `${label}: วัดเวลาจากภาพไม่ได้ AI อ่านได้ "${offeredText}" แต่ยืนยันไม่ได้ จึงยังไม่กรอกให้` :
          `${label}: วัดเวลาจากภาพไม่ได้ กรุณากรอกเอง`);
        continue;
      }
      if (field === "endTime" && facts?.cut) {
        entry.endTime = null;
        flag(entry, field, offeredText ?
          `${label}: กรอบวิชาถูกตัดที่ขอบภาพ AI อ่านได้ "${offeredText}" แต่ยืนยันจากภาพไม่ได้ จึงยังไม่กรอกให้` :
          `${label}: กรอบวิชาถูกตัดที่ขอบภาพ กรุณากรอกเอง`);
        continue;
      }
      if (current !== null && measured) {
        if (offered === null) continue;
        if (Math.abs(offered - current) <= MEASURED_TOLERANCE) {
          stats.agreed += 1;
          if (!facts?.printed) entry[field] = offeredText;
        } else {
          flag(entry, field, `${label}: วัดจากกรอบในภาพได้ "${hhmm(current)}" แต่ AI อ่านเป็น "${offeredText}"`);
          stats.conflicts += 1;
        }
        continue;
      }
      if (current !== null) {
        if (offered !== null && Math.abs(offered - current) <= ESTIMATED_TOLERANCE) {
          entry[field] = offeredText;
          stats.agreed += 1;
        } else {
          flag(entry, field, `${label}: ประมาณจากตำแหน่งในภาพได้ "${hhmm(current)}"${offeredText ? ` แต่ AI อ่านเป็น "${offeredText}"` : ""} กรุณาตรวจสอบ`);
        }
        continue;
      }
      if (offeredText && evidence.times.has(offeredText)) {
        entry[field] = offeredText;
        stats.filled += 1;
      } else if (offeredText) {
        flag(entry, field, `${label}: AI อ่านได้ "${offeredText}" แต่ยืนยันจากภาพไม่ได้ จึงยังไม่กรอกให้`);
      } else {
        flag(entry, field, `${label}: อ่านขอบของกรอบวิชาไม่ได้ กรุณากรอกเอง`);
      }
    }
    const start = minutesOf(entry.startTime);
    const end = minutesOf(entry.endTime);
    if (start !== null && end !== null) {
      if (start >= end) flag(entry, "endTime", `${GRID_FIELD_LABELS.endTime}: เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม`);
      else entry.classTime = `${entry.startTime}-${entry.endTime}`;
    }
  };

  const entries: StandardScheduleEntry[] = geometry.entries.map((entry) => ({
    ...entry,
    reviewFields: [...(entry.reviewFields ?? [])],
    reviewNotes: [...(entry.reviewNotes ?? [])],
  }));
  const used = new Set<number>();
  entries.forEach((entry, index) => {
    const key = squash(entry.courseCode);
    const matchAt = (withDay: boolean) => courses.findIndex((course, at) => !used.has(at) && squash(course.course_code) === key &&
      (!withDay || !entry.day || normalizeGridDay(course.day) === entry.day));
    let at = matchAt(true);
    if (at < 0) at = matchAt(false);
    const course = at >= 0 ? courses[at] : null;
    if (course) {
      used.add(at);
      applyDay(entry, course);
      applyName(entry, course);
    }
    applyTimes(entry, geometry.evidence[index] ?? null, course);
  });

  courses.forEach((course, at) => {
    if (used.has(at)) return;
    const code = squash(course.course_code);
    if (code.length < 4 || !evidence.squashed.includes(code)) {
      stats.dropped += 1;
      return;
    }
    const entry: StandardScheduleEntry = {
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
  return {entries, stats};
}
