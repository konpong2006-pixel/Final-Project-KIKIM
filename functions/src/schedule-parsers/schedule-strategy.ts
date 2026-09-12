import type {ScheduleLayout} from "./schedule-layout";
import type {StandardScheduleEntry} from "./types";

/**
 * One way of reading a timetable. Each layout -- a ruled grid with days down
 * the side, a calendar view of coloured blocks, a registrar's course list --
 * is a strategy, and a new layout is a new entry in the list rather than
 * another branch inside an existing parser.
 */
export type ScheduleExtraction = Record<string, unknown> & {entries: StandardScheduleEntry[]};
export type ScheduleStrategy<Context extends {layout: ScheduleLayout}> = {
  extract: (context: Context) => Promise<ScheduleExtraction | null>;
  /** Whether this strategy is built for the detected layout. */
  matches: (layout: ScheduleLayout) => boolean;
  name: string;
};

/**
 * Days across the top: a calendar view, whatever its cells look like. Days
 * down the side is NOT decided by colour -- a real university timetable rules
 * a fixed grid and fills each course's cell with a pastel colour, which reads
 * as "blocks" and sent it to the calendar reader, losing the section, room
 * and printed time range the ruled-grid reader takes from the cell. Days down
 * the side goes to the ruled-grid reader first and falls back to the calendar
 * reader (below) only when that finds nothing.
 */
export const calendarBlockLayout = (layout: ScheduleLayout) => layout.orientation === "days-as-columns";

/** The ruled-grid reader expects days down the side; it also gets the unsure cases, as before. */
export const cellGridLayout = (layout: ScheduleLayout) => layout.orientation !== "days-as-columns";

/**
 * Days down the side drawn as free-floating coloured blocks -- a calendar
 * view on its side. Only reached when the ruled-grid reader read no course,
 * since on a ruled grid it is the weaker of the two.
 */
export const sidewaysCalendarLayout = (layout: ScheduleLayout) =>
  layout.orientation === "days-as-rows" && layout.kind === "calendar-block";

/**
 * Whether the ruled-grid reader's answer should stand on a layout whose
 * classes are drawn as coloured blocks.
 *
 * A university timetable rules a fixed grid and colours each course's cell:
 * the cell carries a section, a room and a printed time range, which is
 * exactly what this reader takes from it. A calendar view on its side colours
 * free-floating blocks that carry none of those, and there the block reader --
 * which measures each block's edges -- is the better answer.
 */
export function gridCellsCarryFields(
  entries: {endTime?: string | null; room?: string | null; section?: string | null}[],
) {
  const carried = entries.filter((entry) => entry.section || entry.room || entry.endTime).length;
  return carried >= entries.length / 2;
}

/**
 * Tries each matching strategy in order and keeps the first that reads any
 * course. When none does, the last answer is returned as it is, so an empty
 * result still carries what the text readers found (academic year and so on).
 */
export async function extractSchedule<Context extends {layout: ScheduleLayout}>(
  context: Context,
  strategies: ScheduleStrategy<Context>[],
): Promise<ScheduleExtraction & {scheduleStrategy: string; scheduleStrategiesTried: string[]}> {
  const tried: string[] = [];
  let last: ScheduleExtraction | null = null;
  for (const strategy of strategies) {
    if (!strategy.matches(context.layout)) continue;
    tried.push(strategy.name);
    const result = await strategy.extract(context);
    if (!result) continue;
    last = result;
    if (result.entries.length) return {...result, scheduleStrategiesTried: tried, scheduleStrategy: strategy.name};
  }
  return {...(last ?? {entries: []}), scheduleStrategiesTried: tried, scheduleStrategy: tried[tried.length - 1] ?? "none"};
}
