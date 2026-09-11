"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cellGridLayout = exports.calendarBlockLayout = void 0;
exports.extractSchedule = extractSchedule;
/**
 * Days across the top is a calendar view whatever its cells look like; days
 * down the side is one only when its classes are drawn as coloured blocks.
 */
const calendarBlockLayout = (layout) => layout.orientation === "days-as-columns" ||
    (layout.orientation === "days-as-rows" && layout.kind === "calendar-block");
exports.calendarBlockLayout = calendarBlockLayout;
/** The ruled-grid reader expects days down the side; it also gets the unsure cases, as before. */
const cellGridLayout = (layout) => layout.orientation !== "days-as-columns";
exports.cellGridLayout = cellGridLayout;
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