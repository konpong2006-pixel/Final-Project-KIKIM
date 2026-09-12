"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sidewaysCalendarLayout = exports.cellGridLayout = exports.calendarBlockLayout = void 0;
exports.gridCellsCarryFields = gridCellsCarryFields;
exports.extractSchedule = extractSchedule;
/**
 * Days across the top: a calendar view, whatever its cells look like. Days
 * down the side is NOT decided by colour -- a real university timetable rules
 * a fixed grid and fills each course's cell with a pastel colour, which reads
 * as "blocks" and sent it to the calendar reader, losing the section, room
 * and printed time range the ruled-grid reader takes from the cell. Days down
 * the side goes to the ruled-grid reader first and falls back to the calendar
 * reader (below) only when that finds nothing.
 */
const calendarBlockLayout = (layout) => layout.orientation === "days-as-columns";
exports.calendarBlockLayout = calendarBlockLayout;
/** The ruled-grid reader expects days down the side; it also gets the unsure cases, as before. */
const cellGridLayout = (layout) => layout.orientation !== "days-as-columns";
exports.cellGridLayout = cellGridLayout;
/**
 * Days down the side drawn as free-floating coloured blocks -- a calendar
 * view on its side. Only reached when the ruled-grid reader read no course,
 * since on a ruled grid it is the weaker of the two.
 */
const sidewaysCalendarLayout = (layout) => layout.orientation === "days-as-rows" && layout.kind === "calendar-block";
exports.sidewaysCalendarLayout = sidewaysCalendarLayout;
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
function gridCellsCarryFields(entries) {
    const carried = entries.filter((entry) => entry.section || entry.room || entry.endTime).length;
    return carried >= entries.length / 2;
}
/**
 * Tries each matching strategy in order and keeps the first that reads any
 * course. When none does, the last answer is returned as it is, so an empty
 * result still carries what the text readers found (academic year and so on).
 */
async function extractSchedule(context, strategies) {
    const tried = [];
    let last = null;
    for (const strategy of strategies) {
        if (!strategy.matches(context.layout))
            continue;
        tried.push(strategy.name);
        const result = await strategy.extract(context);
        if (!result)
            continue;
        last = result;
        if (result.entries.length)
            return { ...result, scheduleStrategiesTried: tried, scheduleStrategy: strategy.name };
    }
    return { ...(last ?? { entries: [] }), scheduleStrategiesTried: tried, scheduleStrategy: tried[tried.length - 1] ?? "none" };
}
//# sourceMappingURL=schedule-strategy.js.map