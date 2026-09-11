import {colouredBlocks, type PixelBox, type ScanPixels} from "./image-pixels";
import {dayIndex, findCodes, groupLines, median, rawWords, TIME_TOKEN, toWord, type Word} from "./vision-schedule-grid";

/**
 * Which way a timetable runs, and how its classes are drawn -- decided before
 * any parser sees it, so each layout goes to a reader built for it.
 *
 * Orientation comes from where the labels line up. Day names that share one
 * line are column headers; day names stacked in one column are row headers.
 * Times are the same the other way round. Only aligned labels count: a bare
 * "จ." or "ส." is one character and turns up in ordinary text, but three day
 * names in a row are a header.
 *
 * Kind comes from the pixels: course codes sitting inside filled, coloured
 * rectangles are a calendar-style view (a class is a block whose edges are its
 * times); otherwise it is a ruled grid of cells.
 */
export type ScheduleOrientation = "days-as-columns" | "days-as-rows" | "unknown";
export type ScheduleLayoutKind = "calendar-block" | "cell-grid" | "unknown";
export type DayMark = {day: number; word: Word};
export type TimeMark = {minutes: number; word: Word};
export type ScheduleLayout = {
  blocks: PixelBox[];
  codes: number;
  codesInBlocks: number;
  /** The aligned day header of the winning orientation, in reading order. */
  dayMarks: DayMark[];
  kind: ScheduleLayoutKind;
  orientation: ScheduleOrientation;
  /** The aligned time labels of the winning orientation, in reading order. */
  timeMarks: TimeMark[];
  words: Word[];
};

const merged = (words: Word[]) => toWord(
  words.flatMap((word) => [{x: word.left, y: word.top}, {x: word.right, y: word.bottom}]),
  words.map((word) => word.text).join(""),
);

/**
 * Day names wherever they appear, with Vision's splits undone first: it reads
 * "พฤ." as three words, so touching words on a line are joined and tried
 * together before each is tried alone.
 */
function dayTokens(words: Word[]): DayMark[] {
  const marks: DayMark[] = [];
  for (const line of groupLines(words)) {
    const pieces: Word[][] = [];
    for (const word of line) {
      const last = pieces[pieces.length - 1];
      const previous = last?.[last.length - 1];
      if (previous && word.left - previous.right < Math.min(previous.height, word.height) * 0.6) last.push(word);
      else pieces.push([word]);
    }
    for (const piece of pieces) {
      const whole = dayIndex(piece.map((word) => word.text).join(""));
      if (whole >= 0) {
        marks.push({day: whole, word: merged(piece)});
        continue;
      }
      for (const word of piece) {
        const day = dayIndex(word.text);
        if (day >= 0) marks.push({day, word});
      }
    }
  }
  return marks;
}

/** Items that share a line (same y). */
function inRows<T>(items: T[], box: (item: T) => Word) {
  const height = median(items.map((item) => box(item).height)) || 20;
  const groups: T[][] = [];
  for (const item of [...items].sort((a, b) => box(a).cy - box(b).cy)) {
    const group = groups.find((candidate) => Math.abs(median(candidate.map((other) => box(other).cy)) - box(item).cy) <= Math.max(6, height * 0.7));
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => [...group].sort((a, b) => box(a).cx - box(b).cx));
}

/** Items stacked in one column (overlapping x ranges). */
function inColumns<T>(items: T[], box: (item: T) => Word) {
  const groups: {items: T[]; left: number; right: number}[] = [];
  for (const item of [...items].sort((a, b) => box(a).left - box(b).left)) {
    const word = box(item);
    const group = groups.find((candidate) => word.left <= candidate.right && word.right >= candidate.left);
    if (group) {
      group.items.push(item);
      group.left = Math.min(group.left, word.left);
      group.right = Math.max(group.right, word.right);
    } else {
      groups.push({items: [item], left: word.left, right: word.right});
    }
  }
  return groups.map((group) => [...group.items].sort((a, b) => box(a).cy - box(b).cy));
}

const distinctDays = (marks: DayMark[]) => new Set(marks.map((mark) => mark.day)).size;
const best = <T>(groups: T[][], score: (group: T[]) => number) =>
  groups.reduce<T[]>((top, group) => (score(group) > score(top) ? group : top), []);

function timeMarks(words: Word[]): TimeMark[] {
  return words.flatMap((word) => {
    const match = word.text.match(TIME_TOKEN);
    return match ? [{minutes: Number(match[1]) * 60 + Number(match[2]), word}] : [];
  });
}

/** The longest run of labels whose times rise in reading order -- a scale, not scattered times. */
function rising(marks: TimeMark[]) {
  const kept: TimeMark[] = [];
  for (const mark of marks) if (!kept.length || mark.minutes > kept[kept.length - 1].minutes) kept.push(mark);
  return kept;
}

export function detectScheduleLayout(annotation: unknown, pixels: ScanPixels | null): ScheduleLayout {
  const words = rawWords(annotation).map((item) => toWord(item.points, item.text));
  const days = dayTokens(words);
  const times = timeMarks(words);
  const dayHeaderRow = best(inRows(days, (mark) => mark.word), distinctDays);
  const dayHeaderColumn = best(inColumns(days, (mark) => mark.word), distinctDays);
  const timeRow = rising(best(inRows(times, (mark) => mark.word), (group) => rising(group).length));
  const timeColumn = rising(best(inColumns(times, (mark) => mark.word), (group) => rising(group).length));

  const columnsScore = (distinctDays(dayHeaderRow) >= 3 ? 2 : 0) + (timeColumn.length >= 3 && timeColumn.length > timeRow.length ? 1 : 0);
  const rowsScore = (distinctDays(dayHeaderColumn) >= 3 ? 2 : 0) + (timeRow.length >= 3 && timeRow.length > timeColumn.length ? 1 : 0);
  const orientation: ScheduleOrientation = columnsScore > rowsScore ? "days-as-columns" :
    rowsScore > columnsScore ? "days-as-rows" : "unknown";

  const blocks = pixels ? colouredBlocks(pixels) : [];
  const codes = findCodes(groupLines(words));
  const inside = (word: Word) => blocks.some((block) =>
    word.cx >= block.left && word.cx <= block.right && word.cy >= block.top && word.cy <= block.bottom);
  const codesInBlocks = codes.filter((code) => inside(code.word)).length;
  const kind: ScheduleLayoutKind = !pixels ? "unknown" :
    codesInBlocks >= Math.max(1, Math.ceil(codes.length * 0.34)) ? "calendar-block" : "cell-grid";

  return {
    blocks,
    codes: codes.length,
    codesInBlocks,
    dayMarks: orientation === "days-as-columns" ? dayHeaderRow : orientation === "days-as-rows" ? dayHeaderColumn : [],
    kind,
    orientation,
    timeMarks: orientation === "days-as-columns" ? timeColumn : orientation === "days-as-rows" ? timeRow : [],
    words,
  };
}
