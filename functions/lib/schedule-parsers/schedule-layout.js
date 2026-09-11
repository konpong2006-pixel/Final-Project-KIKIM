"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectScheduleLayout = detectScheduleLayout;
const image_pixels_1 = require("./image-pixels");
const vision_schedule_grid_1 = require("./vision-schedule-grid");
const merged = (words) => (0, vision_schedule_grid_1.toWord)(words.flatMap((word) => [{ x: word.left, y: word.top }, { x: word.right, y: word.bottom }]), words.map((word) => word.text).join(""));
/**
 * Day names wherever they appear, with Vision's splits undone first: it reads
 * "พฤ." as three words, so touching words on a line are joined and tried
 * together before each is tried alone.
 */
function dayTokens(words) {
    const marks = [];
    for (const line of (0, vision_schedule_grid_1.groupLines)(words)) {
        const pieces = [];
        for (const word of line) {
            const last = pieces[pieces.length - 1];
            const previous = last?.[last.length - 1];
            if (previous && word.left - previous.right < Math.min(previous.height, word.height) * 0.6)
                last.push(word);
            else
                pieces.push([word]);
        }
        for (const piece of pieces) {
            const whole = (0, vision_schedule_grid_1.dayIndex)(piece.map((word) => word.text).join(""));
            if (whole >= 0) {
                marks.push({ day: whole, word: merged(piece) });
                continue;
            }
            for (const word of piece) {
                const day = (0, vision_schedule_grid_1.dayIndex)(word.text);
                if (day >= 0)
                    marks.push({ day, word });
            }
        }
    }
    return marks;
}
/** Items that share a line (same y). */
function inRows(items, box) {
    const height = (0, vision_schedule_grid_1.median)(items.map((item) => box(item).height)) || 20;
    const groups = [];
    for (const item of [...items].sort((a, b) => box(a).cy - box(b).cy)) {
        const group = groups.find((candidate) => Math.abs((0, vision_schedule_grid_1.median)(candidate.map((other) => box(other).cy)) - box(item).cy) <= Math.max(6, height * 0.7));
        if (group)
            group.push(item);
        else
            groups.push([item]);
    }
    return groups.map((group) => [...group].sort((a, b) => box(a).cx - box(b).cx));
}
/** Items stacked in one column (overlapping x ranges). */
function inColumns(items, box) {
    const groups = [];
    for (const item of [...items].sort((a, b) => box(a).left - box(b).left)) {
        const word = box(item);
        const group = groups.find((candidate) => word.left <= candidate.right && word.right >= candidate.left);
        if (group) {
            group.items.push(item);
            group.left = Math.min(group.left, word.left);
            group.right = Math.max(group.right, word.right);
        }
        else {
            groups.push({ items: [item], left: word.left, right: word.right });
        }
    }
    return groups.map((group) => [...group.items].sort((a, b) => box(a).cy - box(b).cy));
}
const distinctDays = (marks) => new Set(marks.map((mark) => mark.day)).size;
const best = (groups, score) => groups.reduce((top, group) => (score(group) > score(top) ? group : top), []);
function timeMarks(words) {
    return words.flatMap((word) => {
        const match = word.text.match(vision_schedule_grid_1.TIME_TOKEN);
        return match ? [{ minutes: Number(match[1]) * 60 + Number(match[2]), word }] : [];
    });
}
/** The longest run of labels whose times rise in reading order -- a scale, not scattered times. */
function rising(marks) {
    const kept = [];
    for (const mark of marks)
        if (!kept.length || mark.minutes > kept[kept.length - 1].minutes)
            kept.push(mark);
    return kept;
}
function detectScheduleLayout(annotation, pixels) {
    const words = (0, vision_schedule_grid_1.rawWords)(annotation).map((item) => (0, vision_schedule_grid_1.toWord)(item.points, item.text));
    const days = dayTokens(words);
    const times = timeMarks(words);
    const dayHeaderRow = best(inRows(days, (mark) => mark.word), distinctDays);
    const dayHeaderColumn = best(inColumns(days, (mark) => mark.word), distinctDays);
    const timeRow = rising(best(inRows(times, (mark) => mark.word), (group) => rising(group).length));
    const timeColumn = rising(best(inColumns(times, (mark) => mark.word), (group) => rising(group).length));
    const columnsScore = (distinctDays(dayHeaderRow) >= 3 ? 2 : 0) + (timeColumn.length >= 3 && timeColumn.length > timeRow.length ? 1 : 0);
    const rowsScore = (distinctDays(dayHeaderColumn) >= 3 ? 2 : 0) + (timeRow.length >= 3 && timeRow.length > timeColumn.length ? 1 : 0);
    const orientation = columnsScore > rowsScore ? "days-as-columns" :
        rowsScore > columnsScore ? "days-as-rows" : "unknown";
    const blocks = pixels ? (0, image_pixels_1.colouredBlocks)(pixels) : [];
    const codes = (0, vision_schedule_grid_1.findCodes)((0, vision_schedule_grid_1.groupLines)(words));
    const inside = (word) => blocks.some((block) => word.cx >= block.left && word.cx <= block.right && word.cy >= block.top && word.cy <= block.bottom);
    const codesInBlocks = codes.filter((code) => inside(code.word)).length;
    const kind = !pixels ? "unknown" :
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
//# sourceMappingURL=schedule-layout.js.map