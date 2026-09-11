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
 * Days across the top is a calendar view whatever its cells look like; days
 * down the side is one only when its classes are drawn as coloured blocks.
 */
export const calendarBlockLayout = (layout: ScheduleLayout) =>
  layout.orientation === "days-as-columns" ||
  (layout.orientation === "days-as-rows" && layout.kind === "calendar-block");

/** The ruled-grid reader expects days down the side; it also gets the unsure cases, as before. */
export const cellGridLayout = (layout: ScheduleLayout) => layout.orientation !== "days-as-columns";

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
