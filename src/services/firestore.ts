import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  type DocumentData,
  endAt,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  type QueryConstraint,
  query,
  type QueryDocumentSnapshot,
  serverTimestamp,
  setDoc,
  startAt,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import {isDemoMode} from '@/lib/demo-mode';
import {
  demoBetween,
  demoCollection,
  demoCreate,
  demoNoteFolders,
  demoNotes,
  demoNotifications,
  demoRecommendations,
  demoTransactionsBetween,
} from '@/services/demo-data';
import type {
  Activity,
  AiRecommendation,
  Feedback,
  Note,
  NoteFolder,
  NoteLock,
  Notification,
  PendingLineReview,
  ScanLog,
  Schedule,
  Transaction,
  WithId,
} from '@/types/smartlife';

type UserCollection =
  | 'activities'
  | 'aiRecommendations'
  | 'bankNotifications'
  | 'feedback'
  | 'noteFolders'
  | 'notes'
  | 'notifications'
  | 'pendingReview'
  | 'scanLogs'
  | 'schedules'
  | 'transactions';

type CreateFields = { createdAt: ReturnType<typeof serverTimestamp>; ownerId: string; updatedAt: ReturnType<typeof serverTimestamp> };

export type ScheduleConflict = {
  endAt: string;
  id: string;
  kind: 'activity' | 'schedule';
  startAt: string;
  title: string;
};

function userCollection(uid: string, name: UserCollection) {
  return collection(db, 'users', uid, name);
}

function mapDocument<T>(snapshot: QueryDocumentSnapshot<DocumentData>): WithId<T> {
  return { id: snapshot.id, ...snapshot.data() } as WithId<T>;
}

function timestampMillis(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as {toMillis?: unknown}).toMillis === 'function') {
    return (value as {toMillis: () => number}).toMillis();
  }
  return 0;
}

function sortNewestFirst<T extends {createdAt?: unknown}>(items: T[]) {
  return [...items].sort((first, second) => timestampMillis(second.createdAt) - timestampMillis(first.createdAt));
}

async function createOwned<T extends object>(uid: string, name: UserCollection, data: T) {
  const timestamps: CreateFields = { ownerId: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  const reference = await addDoc(userCollection(uid, name), { ...data, ...timestamps });
  return reference.id;
}

async function createOwnedMany<T extends object>(uid: string, name: UserCollection, items: T[]) {
  if (!items.length) return [];
  if (items.length > 500) throw new Error('A Firestore batch can contain at most 500 documents.');
  const batch = writeBatch(db);
  const ids = items.map((data) => {
    const reference = doc(userCollection(uid, name));
    batch.set(reference, {...data, ownerId: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()});
    return reference.id;
  });
  await batch.commit();
  return ids;
}

async function updateOwned(uid: string, name: UserCollection, id: string, data: object) {
  await updateDoc(doc(db, 'users', uid, name, id), { ...data, updatedAt: serverTimestamp() });
}

async function updateOwnedMany(uid: string, name: UserCollection, items: {data: object; id: string}[]) {
  if (!items.length) return 0;
  if (items.length > 500) throw new Error('A Firestore batch can contain at most 500 documents.');
  const batch = writeBatch(db);
  items.forEach((item) => batch.update(doc(db, 'users', uid, name, item.id), {...item.data, updatedAt: serverTimestamp()}));
  await batch.commit();
  return items.length;
}

async function removeOwned(uid: string, name: UserCollection, id: string) {
  await deleteDoc(doc(db, 'users', uid, name, id));
}

async function listOwned<T>(uid: string, name: UserCollection, constraints: QueryConstraint[] = []) {
  const snapshot = await getDocs(query(userCollection(uid, name), ...constraints));
  return snapshot.docs.map((item) => mapDocument<T>(item));
}

export async function deleteCourseSeries(uid: string, courseCode: string, seriesId?: string) {
  if (isDemoMode) return 1;
  const normalizedCourseCode = courseCode.replace(/\s+/g, '').toUpperCase();
  const normalizedSeriesId = seriesId?.trim();
  if (!uid || (!normalizedSeriesId && !normalizedCourseCode)) {
    throw new Error('A user ID and course series identifier are required.');
  }

  const schedulesRef = userCollection(uid, 'schedules');
  const matchingSchedules = normalizedSeriesId
    ? query(schedulesRef, where('seriesId', '==', normalizedSeriesId))
    : query(schedulesRef, where('courseCode', '==', normalizedCourseCode));
  const snapshot = await getDocs(matchingSchedules);

  if (snapshot.empty) return 0;
  if (snapshot.size > 500) {
    throw new Error('This course series exceeds the Firestore batch limit of 500 schedules.');
  }

  const batch = writeBatch(db);
  snapshot.docs.forEach((scheduleDocument) => batch.delete(scheduleDocument.ref));
  await batch.commit();
  return snapshot.size;
}

export const schedules = {
  create: (uid: string, data: Omit<Schedule, keyof CreateFields | 'ownerId'>) => isDemoMode ? demoCreate('schedules') : createOwned(uid, 'schedules', data),
  createMany: async (uid: string, data: Omit<Schedule, keyof CreateFields | 'ownerId'>[]) => isDemoMode ? Promise.all(data.map(() => demoCreate('schedules'))) : createOwnedMany(uid, 'schedules', data),
  update: (uid: string, id: string, data: Partial<Omit<Schedule, keyof CreateFields | 'ownerId'>>) => isDemoMode ? Promise.resolve() : updateOwned(uid, 'schedules', id, data),
  updateMany: (uid: string, items: {data: Partial<Omit<Schedule, keyof CreateFields | 'ownerId'>>; id: string}[]) => isDemoMode ? Promise.resolve(items.length) : updateOwnedMany(uid, 'schedules', items),
  remove: (uid: string, id: string) => isDemoMode ? Promise.resolve() : removeOwned(uid, 'schedules', id),
  between: (uid: string, from: Date, to: Date) => isDemoMode ? Promise.resolve(demoBetween('schedules', from, to) as WithId<Schedule>[]) : listOwned<Schedule>(uid, 'schedules', [
    orderBy('startAt'), startAt(Timestamp.fromDate(from)), endAt(Timestamp.fromDate(to)),
  ]),
  updateSeries: async (uid: string, seriesId: string, data: Partial<Omit<Schedule, keyof CreateFields | 'ownerId'>>) => {
    if (isDemoMode) return 1;
    const snapshot = await getDocs(query(userCollection(uid, 'schedules'), where('seriesId', '==', seriesId)));
    if (snapshot.size > 500) throw new Error('This schedule series exceeds the Firestore batch limit.');
    const batch = writeBatch(db);
    snapshot.docs.forEach((item) => batch.update(item.ref, {...data, updatedAt: serverTimestamp()}));
    await batch.commit();
    return snapshot.size;
  },
};

export const activities = {
  create: (uid: string, data: Omit<Activity, keyof CreateFields | 'ownerId'>) => isDemoMode ? demoCreate('activities') : createOwned(uid, 'activities', data),
  listTasks: (uid: string) => isDemoMode
    ? Promise.resolve((demoCollection('activities') as WithId<Activity>[]).filter((item) => item.type === 'task'))
    : listOwned<Activity>(uid, 'activities', [where('type', '==', 'task'), limit(200)]),
  update: (uid: string, id: string, data: Partial<Omit<Activity, keyof CreateFields | 'ownerId'>>) => isDemoMode ? Promise.resolve() : updateOwned(uid, 'activities', id, data),
  remove: (uid: string, id: string) => isDemoMode ? Promise.resolve() : removeOwned(uid, 'activities', id),
  between: (uid: string, from: Date, to: Date) => isDemoMode ? Promise.resolve(demoBetween('activities', from, to) as WithId<Activity>[]) : listOwned<Activity>(uid, 'activities', [
    orderBy('startAt'), startAt(Timestamp.fromDate(from)), endAt(Timestamp.fromDate(to)),
  ]),
};

export async function findScheduleConflicts(uid: string, proposedStart: Date, proposedEnd: Date): Promise<ScheduleConflict[]> {
  if (!uid || Number.isNaN(proposedStart.getTime()) || Number.isNaN(proposedEnd.getTime()) || proposedStart >= proposedEnd) return [];

  const sourceItems = isDemoMode
    ? [
      ...(demoCollection('schedules') as WithId<Schedule>[]).map((item) => ({data: item, id: item.id, kind: 'schedule' as const})),
      ...(demoCollection('activities') as WithId<Activity>[]).map((item) => ({data: item, id: item.id, kind: 'activity' as const})),
    ]
    : (await Promise.all((['schedules', 'activities'] as const).map(async (name) => {
      const snapshot = await getDocs(query(
        userCollection(uid, name),
        where('startAt', '<', Timestamp.fromDate(proposedEnd)),
        orderBy('startAt', 'desc'),
        limit(500),
      ));
      return snapshot.docs.map((item) => ({data: item.data(), id: item.id, kind: name === 'schedules' ? 'schedule' as const : 'activity' as const}));
    }))).flat();

  return sourceItems.flatMap(({data, id, kind}) => {
    if (kind === 'activity' && ['cancelled', 'completed'].includes(String(data.status ?? ''))) return [];
    const startMs = timestampMillis(data.startAt);
    const endMs = timestampMillis(data.endAt);
    if (!startMs || !endMs || startMs >= proposedEnd.getTime() || endMs <= proposedStart.getTime()) return [];
    return [{
      endAt: new Date(endMs).toISOString(),
      id,
      kind,
      startAt: new Date(startMs).toISOString(),
      title: String(data.title || ('courseName' in data ? data.courseName : '') || 'รายการในตาราง').slice(0, 120),
    }];
  }).sort((left, right) => left.startAt.localeCompare(right.startAt));
}

export const notes = {
  create: (uid: string, data: Omit<Note, keyof CreateFields | 'ownerId'>) => isDemoMode ? demoCreate('notes') : createOwned(uid, 'notes', data),
  /** Reads one note, for the detail/edit screen. Returns null when it is gone. */
  get: async (uid: string, id: string) => {
    if (isDemoMode) return (demoNotes().find((item) => (item as {id?: string}).id === id) ?? null) as WithId<Note> | null;
    const snapshot = await getDoc(doc(db, 'users', uid, 'notes', id));
    return snapshot.exists() ? ({id: snapshot.id, ...snapshot.data()} as WithId<Note>) : null;
  },
  update: (uid: string, id: string, data: Partial<Omit<Note, keyof CreateFields | 'ownerId'>>) => isDemoMode ? Promise.resolve() : updateOwned(uid, 'notes', id, data),
  remove: (uid: string, id: string) => isDemoMode ? Promise.resolve() : removeOwned(uid, 'notes', id),
  list: (uid: string, category?: Note['category']) => isDemoMode ? Promise.resolve(demoNotes(category) as WithId<Note>[]) : listOwned<Note>(uid, 'notes', [
    ...(category ? [where('category', '==', category)] : []), orderBy('updatedAt', 'desc'), limit(100),
  ]),
};

export const noteFolders = {
  create: (uid: string, data: Omit<NoteFolder, keyof CreateFields | 'ownerId'>) => isDemoMode ? demoCreate('noteFolders') : createOwned(uid, 'noteFolders', data),
  update: (uid: string, id: string, data: Partial<Omit<NoteFolder, keyof CreateFields | 'ownerId'>>) => isDemoMode ? Promise.resolve() : updateOwned(uid, 'noteFolders', id, data),
  remove: (uid: string, id: string) => isDemoMode ? Promise.resolve() : removeOwned(uid, 'noteFolders', id),
  list: (uid: string) => isDemoMode
    ? Promise.resolve(demoNoteFolders() as unknown as WithId<NoteFolder>[])
    : listOwned<NoteFolder>(uid, 'noteFolders', [orderBy('sortOrder'), limit(50)]),
};

/**
 * The per-user note PIN, stored at `users/{uid}/settings/noteLock`.
 *
 * Only a salted digest is ever written -- see `note-lock.ts` for the hashing --
 * and the rules make this document readable by its owner alone, not by admins.
 */
export const noteLock = {
  get: async (uid: string) => {
    if (isDemoMode) return null;
    const snapshot = await getDoc(doc(db, 'users', uid, 'settings', 'noteLock'));
    return snapshot.exists() ? (snapshot.data() as NoteLock) : null;
  },
  set: async (uid: string, data: {biometricEnabled?: boolean; hash: string; hint?: string; salt: string}) => {
    if (isDemoMode) return;
    const reference = doc(db, 'users', uid, 'settings', 'noteLock');
    const existing = await getDoc(reference);
    if (existing.exists()) {
      await updateDoc(reference, {...data, updatedAt: serverTimestamp()});
      return;
    }
    await setDoc(reference, {...data, ownerId: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()});
  },
  clear: async (uid: string) => {
    if (isDemoMode) return;
    await deleteDoc(doc(db, 'users', uid, 'settings', 'noteLock'));
  },
};

export const transactions = {
  create: (uid: string, data: Omit<Transaction, keyof CreateFields | 'ownerId'>) => isDemoMode ? demoCreate('transactions') : createOwned(uid, 'transactions', data),
  update: (uid: string, id: string, data: Partial<Omit<Transaction, keyof CreateFields | 'ownerId'>>) => isDemoMode ? Promise.resolve() : updateOwned(uid, 'transactions', id, data),
  remove: (uid: string, id: string) => isDemoMode ? Promise.resolve() : removeOwned(uid, 'transactions', id),
  between: (uid: string, from: Date, to: Date, type?: Transaction['type']) => isDemoMode ? Promise.resolve(demoTransactionsBetween(from, to, type) as WithId<Transaction>[]) : listOwned<Transaction>(uid, 'transactions', [
    ...(type ? [where('type', '==', type)] : []),
    where('occurredAt', '>=', Timestamp.fromDate(from)),
    where('occurredAt', '<=', Timestamp.fromDate(to)),
    orderBy('occurredAt', 'desc'),
  ]),
};

export const pendingReviews = {
  get: async (uid: string, id: string) => {
    if (isDemoMode) return null;
    const snapshot = await getDoc(doc(db, 'users', uid, 'pendingReview', id));
    return snapshot.exists() ? ({id: snapshot.id, ...snapshot.data()} as WithId<PendingLineReview>) : null;
  },
  list: (uid: string) => isDemoMode
    ? Promise.resolve([] as WithId<PendingLineReview>[])
    : listOwned<PendingLineReview>(uid, 'pendingReview', [orderBy('createdAt', 'desc'), limit(100)]),
  watch: (
    uid: string,
    onChange: (value: WithId<PendingLineReview>[]) => void,
    onError?: (error: Error) => void,
  ) => isDemoMode
    ? (onChange([]), () => undefined)
    : onSnapshot(
      query(userCollection(uid, 'pendingReview'), orderBy('createdAt', 'desc'), limit(100)),
      (snapshot) => onChange(snapshot.docs.map((item: QueryDocumentSnapshot<DocumentData>) => mapDocument<PendingLineReview>(item))),
      onError,
    ),
};

export const scanLogs = {
  create: (uid: string, data: Omit<ScanLog, keyof CreateFields | 'ownerId'>) => isDemoMode ? demoCreate('scanLogs') : createOwned(uid, 'scanLogs', data),
  list: async (uid: string) => isDemoMode ? demoCollection('scanLogs') as WithId<ScanLog>[] : sortNewestFirst(await listOwned<ScanLog>(uid, 'scanLogs')).slice(0, 100),
  remove: (uid: string, id: string) => isDemoMode ? Promise.resolve() : removeOwned(uid, 'scanLogs', id),
  get: async (uid: string, id: string) => {
    if (isDemoMode) return (demoCollection('scanLogs') as WithId<ScanLog>[]).find((item) => item.id === id) ?? null;
    const snapshot = await getDoc(doc(db, 'users', uid, 'scanLogs', id));
    return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as WithId<ScanLog>) : null;
  },
  watch: (uid: string, id: string, onChange: (value: WithId<ScanLog> | null) => void) =>
    isDemoMode ? (onChange((demoCollection('scanLogs') as WithId<ScanLog>[]).find((item) => item.id === id) ?? null), () => undefined) : onSnapshot(doc(db, 'users', uid, 'scanLogs', id), (snapshot) => {
      onChange(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as WithId<ScanLog>) : null);
    }),
  watchList: (uid: string, onChange: (value: WithId<ScanLog>[]) => void, onError?: (error: Error) => void) =>
    isDemoMode ? (onChange(demoCollection('scanLogs') as WithId<ScanLog>[]), () => undefined) : onSnapshot(userCollection(uid, 'scanLogs'), (snapshot) => {
      const items = snapshot.docs.map((item: QueryDocumentSnapshot<DocumentData>) => mapDocument<ScanLog>(item));
      onChange(sortNewestFirst(items).slice(0, 100) as WithId<ScanLog>[]);
    }, onError),
};

export const notifications = {
  list: (uid: string, kind?: Notification['kind']) => isDemoMode ? Promise.resolve(demoNotifications(kind) as WithId<Notification>[]) : listOwned<Notification>(uid, 'notifications', [
    ...(kind ? [where('kind', '==', kind)] : []), orderBy('createdAt', 'desc'), limit(100),
  ]),
  markRead: (uid: string, id: string, read = true) => isDemoMode ? Promise.resolve() : updateOwned(uid, 'notifications', id, { read }),
};

export const aiRecommendations = {
  list: (uid: string, kind?: AiRecommendation['kind']) => isDemoMode ? Promise.resolve(demoRecommendations(kind) as WithId<AiRecommendation>[]) : listOwned<AiRecommendation>(uid, 'aiRecommendations', [
    ...(kind ? [where('kind', '==', kind)] : []), orderBy('createdAt', 'desc'), limit(100),
  ]),
};

export const feedback = {
  create: (uid: string, data: Pick<Feedback, 'message' | 'type'>) => isDemoMode ? demoCreate('feedback') : createOwned(uid, 'feedback', { ...data, status: 'new' }),
};
