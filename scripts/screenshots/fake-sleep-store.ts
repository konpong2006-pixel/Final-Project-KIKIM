/**
 * In-memory stand-in for the Firestore activities collection, used only by the
 * screenshot harness. It implements the same surface `sleep-log.ts` calls, so
 * the real service, the real card, and the real model all run unmodified -- the
 * only thing replaced is the network underneath.
 *
 * Without this the harness could not reach the "in bed" or "just woke up"
 * states, because the demo-mode stubs in the app discard writes.
 */
type Stamp = {toDate: () => Date; toMillis: () => number};
type Record_ = {
  [key: string]: unknown;
  endAt: Stamp;
  id: string;
  startAt: Stamp;
  status: string;
};

const stamp = (value: Date): Stamp => ({toDate: () => new Date(value), toMillis: () => value.getTime()});

let rows: Record_[] = [];
let counter = 0;

export function __resetStore() {
  rows = [];
  counter = 0;
}

/**
 * Plants a sleep session opened well over a day ago and never closed, which is
 * the exact condition the "ลืมกดตื่นนอนหรือเปล่า?" prompt exists to catch.
 */
export function __seedStaleNight(hoursAgo = 30) {
  const start = new Date(Date.now() - hoursAgo * 36e5);
  rows.push({
    category: 'sleep',
    color: '#7e88b5',
    endAt: stamp(new Date(start.getTime() + 8 * 36e5)),
    id: `stale-${(counter += 1)}`,
    location: '',
    note: 'บันทึกด้วยปุ่มเข้านอน/ตื่นนอน',
    ownerId: 'screenshot-user',
    source: 'manual',
    startAt: stamp(start),
    status: 'in-progress',
    title: 'นอน',
    type: 'activity',
  });
}

export const activities = {
  between: async (_uid: string, from: Date, to: Date) => rows.filter((row) => {
    const start = row.startAt.toDate();
    return start >= from && start <= to;
  }),
  create: async (_uid: string, data: object) => {
    const id = `row-${(counter += 1)}`;
    rows.push({...(data as Record_), id});
    return id;
  },
  listTasks: async () => [],
  remove: async (_uid: string, id: string) => {
    rows = rows.filter((row) => row.id !== id);
  },
  update: async (_uid: string, id: string, data: object) => {
    rows = rows.map((row) => (row.id === id ? {...row, ...(data as object)} as Record_ : row));
  },
};

export const notes = {create: async () => '', list: async () => [], remove: async () => undefined, update: async () => undefined};
export const schedules = {between: async () => [], create: async () => '', createMany: async () => [], remove: async () => undefined, update: async () => undefined, updateMany: async () => 0, updateSeries: async () => 0};
export const transactions = {between: async () => [], create: async () => '', remove: async () => undefined, update: async () => undefined};
export const scanLogs = {create: async () => '', get: async () => null, list: async () => [], remove: async () => undefined, watch: () => () => undefined, watchList: () => () => undefined};
export const notifications = {list: async () => [], markRead: async () => undefined};
export const aiRecommendations = {list: async () => []};
export const feedback = {create: async () => ''};
export const pendingReviews = {get: async () => null, list: async () => [], watch: () => () => undefined};
export const deleteCourseSeries = async () => 0;
