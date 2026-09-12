import {demoUid} from '@/lib/demo-mode';

type DemoDocument = Record<string, unknown> & {id: string};
type DemoCollection =
  | 'activities'
  | 'aiRecommendations'
  | 'feedback'
  | 'noteFolders'
  | 'notes'
  | 'notifications'
  | 'scanLogs'
  | 'schedules'
  | 'transactions';

const now = new Date();
const plusHours = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
const plusDays = (days: number, hour = 9) => {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

const userProfile = {
  id: demoUid,
  uid: demoUid,
  email: 'demo@smartlife.local',
  displayName: 'SmartLife Demo',
  avatarUrl: '',
  role: 'user',
  studentId: 'B67DEMO',
  createdAt: plusHours(-240),
  updatedAt: plusHours(-1),
};

const schedules: DemoDocument[] = [
  {id: 'demo-data-structures', ownerId: demoUid, title: 'Data Structures', courseCode: 'SC1-201', startAt: plusHours(2), endAt: plusHours(5), location: 'อาคารเรียนรวม', color: '#6F8F6D', source: 'manual', createdAt: plusHours(-12), updatedAt: plusHours(-1), seriesId: 'demo-ds'},
  {id: 'demo-digital-tech', ownerId: demoUid, title: 'Project in Digital Tech', courseCode: '110191', startAt: plusDays(1, 9), endAt: plusDays(1, 12), location: 'ห้อง 110191', color: '#9297BB', source: 'manual', createdAt: plusHours(-10), updatedAt: plusHours(-1), seriesId: 'demo-project'},
  {id: 'demo-english', ownerId: demoUid, title: 'English Communication', courseCode: 'ENG102', startAt: plusDays(2, 13), endAt: plusDays(2, 15), location: 'Language Center', color: '#BB9293', source: 'manual', createdAt: plusHours(-8), updatedAt: plusHours(-1), seriesId: 'demo-eng'},
];

const activities: DemoDocument[] = [
  {id: 'demo-task-ds', ownerId: demoUid, title: 'อ่าน Linked List ก่อนควิซ', type: 'task', startAt: plusHours(1), endAt: plusHours(2), location: 'SmartLife', color: '#BB9293', status: 'planned', source: 'ai', createdAt: plusHours(-6), updatedAt: plusHours(-1)},
  {id: 'demo-activity-break', ownerId: demoUid, title: 'พักเบรก 15 นาที', type: 'activity', startAt: plusHours(6), endAt: plusHours(7), location: 'คาเฟ่ใกล้คณะ', color: '#9297BB', status: 'planned', source: 'ai', createdAt: plusHours(-5), updatedAt: plusHours(-1)},
  {id: 'demo-appointment', ownerId: demoUid, title: 'ประชุมกลุ่ม Project', type: 'appointment', startAt: plusDays(1, 14), endAt: plusDays(1, 15), location: 'Discord', color: '#6F8F6D', status: 'planned', source: 'manual', createdAt: plusHours(-4), updatedAt: plusHours(-1)},
];

const notes: DemoDocument[] = [
  {id: 'demo-note-linked-list', ownerId: demoUid, title: 'Linked List', content: 'สรุปโครงสร้างข้อมูลและโจทย์ที่ควรทบทวนก่อนควิซ', category: 'study', relatedScheduleId: 'demo-data-structures', color: '#6F8F6D', folderId: 'demo-folder-course', tags: ['ควิซ', 'DS'], pinned: true, linkedNoteIds: ['demo-note-project'], createdAt: plusHours(-72), updatedAt: plusHours(-2)},
  {id: 'demo-note-project', ownerId: demoUid, title: 'Project Plan', content: 'แบ่งงานและกำหนดส่งของทีม พร้อมรายการหน้าจอที่ต้อง polish', category: 'work', relatedScheduleId: 'demo-digital-tech', color: '#9297BB', folderId: 'demo-folder-project', tags: ['ทีม'], pinned: false, createdAt: plusHours(-48), updatedAt: plusHours(-3)},
  {id: 'demo-note-idea', ownerId: demoUid, title: 'ไอเดีย SmartLife', content: 'เพิ่มการแนะนำงบอาหารตามตารางเรียน และเตือนอ่านก่อนควิซ', category: 'idea', relatedScheduleId: '', color: '#BB9293', folderId: '', tags: ['ไอเดีย'], createdAt: plusHours(-30), updatedAt: plusHours(-4)},
];

const transactions: DemoDocument[] = [
  {id: 'demo-expense-food', ownerId: demoUid, type: 'expense', amount: 89, category: 'อาหาร', merchant: "McDonald's", note: 'ข้อมูลตัวอย่างจากโค้ดเดิม', occurredAt: plusHours(-5), receiptPath: '', createdAt: plusHours(-5), updatedAt: plusHours(-1)},
  {id: 'demo-expense-travel', ownerId: demoUid, type: 'expense', amount: 40, category: 'เดินทาง', merchant: 'BTS', note: 'ข้อมูลตัวอย่างจากโค้ดเดิม', occurredAt: plusHours(-8), receiptPath: '', createdAt: plusHours(-8), updatedAt: plusHours(-1)},
  {id: 'demo-income', ownerId: demoUid, type: 'income', amount: 500, category: 'รายรับ', merchant: 'เงินค่าขนม', note: 'ข้อมูลตัวอย่างจากโค้ดเดิม', occurredAt: plusHours(-18), receiptPath: '', createdAt: plusHours(-18), updatedAt: plusHours(-1)},
];

const notifications: DemoDocument[] = [
  {id: 'demo-notice-urgent', ownerId: demoUid, title: 'อ่าน Linked List ก่อนควิซ', message: 'เหลือเวลาเตรียมตัวก่อนเข้าเรียน Data Structures', kind: 'urgent', read: false, createdAt: plusHours(-1), updatedAt: plusHours(-1)},
  {id: 'demo-notice-ai', ownerId: demoUid, title: 'AI แนะนำพักเบรก 15 นาที', message: 'วันนี้มีเรียนและงานต่อเนื่อง ระบบแนะนำเว้นช่วงพัก', kind: 'ai', read: false, createdAt: plusHours(-2), updatedAt: plusHours(-2)},
  {id: 'demo-notice-finance', ownerId: demoUid, title: 'งบอาหารวันนี้เหลือ 371 บาท', message: 'รายการอาหารล่าสุด 89 บาทถูกบันทึกแล้ว', kind: 'finance', read: true, createdAt: plusHours(-4), updatedAt: plusHours(-4)},
  {id: 'demo-notice-schedule', ownerId: demoUid, title: 'Project in Digital Tech พรุ่งนี้ 09:00', message: 'เตรียมไฟล์พรีเซนต์ก่อนเข้าคลาส', kind: 'schedule', read: false, createdAt: plusHours(-6), updatedAt: plusHours(-6)},
];

const aiRecommendations: DemoDocument[] = [
  {id: 'demo-ai-priority', ownerId: demoUid, title: 'อ่าน Linked List ก่อนควิซ', kind: 'priority', contextSources: ['schedule', 'note'], action: {type: 'open-note'}, explanation: 'AI สรุปจากตารางเรียนและโน้ตที่เชื่อมกับวิชา Data Structures', status: 'new', createdAt: plusHours(-3), updatedAt: plusHours(-1)},
  {id: 'demo-ai-budget', ownerId: demoUid, title: 'กันงบอาหารวันนี้ 120 บาท', kind: 'finance', contextSources: ['schedule', 'finance'], action: {type: 'budget'}, explanation: 'วันนี้มีเรียนต่อเนื่อง ระบบแนะนำกันงบอาหารและเดินทางไว้ล่วงหน้า', status: 'new', createdAt: plusHours(-4), updatedAt: plusHours(-1)},
];

const feedback: DemoDocument[] = [
  {id: 'demo-feedback', ownerId: demoUid, type: 'ai', message: 'อยากให้ AI แนะนำเวลาอ่านหนังสือได้ละเอียดขึ้น', status: 'new', createdAt: plusHours(-24), updatedAt: plusHours(-24)},
];

const scanLogs: DemoDocument[] = [
  {id: 'demo-scan-receipt', ownerId: demoUid, kind: 'receipt', imagePath: `users/${demoUid}/receipts/demo.jpg`, status: 'completed', extractedText: "OCR อ่านใบเสร็จ McDonald's สำเร็จ", errorMessage: '', createdAt: plusHours(-7), updatedAt: plusHours(-7)},
  {id: 'demo-scan-schedule', ownerId: demoUid, kind: 'schedule', imagePath: `users/${demoUid}/schedules/demo.jpg`, status: 'completed', extractedText: 'OCR อ่านตารางเรียนสำเร็จ', errorMessage: '', createdAt: plusHours(-12), updatedAt: plusHours(-12)},
];

const categories: DemoDocument[] = [
  {id: 'food', domain: 'expense', labelTh: 'อาหาร', labelEn: 'Food', icon: 'tag', color: '#6F8F6D', active: true, sortOrder: 10, createdAt: plusHours(-120), updatedAt: plusHours(-1)},
  {id: 'travel', domain: 'expense', labelTh: 'เดินทาง', labelEn: 'Travel', icon: 'tag', color: '#9297BB', active: true, sortOrder: 20, createdAt: plusHours(-120), updatedAt: plusHours(-1)},
  {id: 'study', domain: 'note', labelTh: 'เรียน', labelEn: 'Study', icon: 'tag', color: '#6F8F6D', active: true, sortOrder: 10, createdAt: plusHours(-120), updatedAt: plusHours(-1)},
  {id: 'work', domain: 'note', labelTh: 'งาน', labelEn: 'Work', icon: 'tag', color: '#9297BB', active: true, sortOrder: 20, createdAt: plusHours(-120), updatedAt: plusHours(-1)},
  {id: 'activity', domain: 'activity', labelTh: 'กิจกรรม', labelEn: 'Activity', icon: 'tag', color: '#6F8F6D', active: true, sortOrder: 10, createdAt: plusHours(-120), updatedAt: plusHours(-1)},
];

const announcements: DemoDocument[] = [
  {id: 'demo-welcome', title: 'ยินดีต้อนรับสู่ SmartLife', message: 'ระบบเชื่อมข้อมูลตารางเรียน โน้ต และการเงินแล้ว', kind: 'feature', active: true, createdBy: demoUid, startAt: plusHours(-24), endAt: plusDays(30), createdAt: plusHours(-24), updatedAt: plusHours(-24)},
];

const systemStatus: DemoDocument[] = [
  {id: 'firestore', name: 'Cloud Firestore', detail: 'Demo data is loaded locally', status: 'operational', latencyMs: 0, checkedAt: plusHours(-1)},
  {id: 'functions', name: 'Cloud Functions', detail: 'Admin health function mocked for preview', status: 'operational', latencyMs: 0, checkedAt: plusHours(-1)},
  {id: 'ocr', name: 'Cloud Vision OCR', detail: 'OCR preview uses sample scan logs', status: 'operational', latencyMs: 0, checkedAt: plusHours(-1)},
  {id: 'calendar', name: 'Google Calendar Sync', detail: 'OAuth connection is disabled in demo mode', status: 'degraded', latencyMs: 0, checkedAt: plusHours(-1)},
];

const noteFolders = [
  {id: 'demo-folder-course', ownerId: demoUid, name: 'วิชาเรียน', color: '#628660', icon: 'folder', sortOrder: 0, createdAt: plusHours(-240), updatedAt: plusHours(-12)},
  {id: 'demo-folder-project', ownerId: demoUid, name: 'โปรเจกต์จบ', color: '#c49497', icon: 'folder_special', sortOrder: 1, createdAt: plusHours(-180), updatedAt: plusHours(-6)},
  {id: 'demo-folder-scanned', ownerId: demoUid, name: 'เอกสารสแกน', color: '#6F8F6D', icon: 'document_scanner', sortOrder: 0, createdAt: plusHours(-120), updatedAt: plusHours(-3)},
];

const collections: Record<DemoCollection, DemoDocument[]> = {
  activities,
  aiRecommendations,
  feedback,
  noteFolders,
  notes,
  notifications,
  scanLogs,
  schedules,
  transactions,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function millis(value: unknown) {
  const parsed = new Date(String(value ?? '')).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function between(items: DemoDocument[], field: string, from: Date, to: Date) {
  const start = from.getTime();
  const end = to.getTime();
  return items.filter((item) => {
    const value = millis(item[field]);
    return value >= start && value <= end;
  });
}

function rangeForPage(pageKey: string) {
  const start = new Date(now);
  const end = new Date(now);
  if (pageKey.includes('_month')) {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(end.getMonth() + 1, 1);
    end.setHours(0, 0, 0, 0);
  } else if (pageKey.includes('_week')) {
    start.setDate(start.getDate() - 3);
    end.setDate(end.getDate() + 7);
  } else {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }
  return {from: start, to: end};
}

export function demoCollection(name: DemoCollection) {
  return clone(collections[name]);
}

export function demoBetween(name: 'activities' | 'schedules', from: Date, to: Date) {
  return clone(between(collections[name], 'startAt', from, to));
}

export function demoTransactionsBetween(from: Date, to: Date, type?: unknown) {
  const items = between(transactions, 'occurredAt', from, to);
  return clone(type ? items.filter((item) => item.type === type) : items);
}

export function demoNoteFolders() {
  return clone([...noteFolders].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
}

export function demoNotes(category?: unknown) {
  const items = category ? notes.filter((item) => item.category === category) : notes;
  return clone([...items].sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt)));
}

export function demoNotifications(kind?: unknown) {
  const items = kind ? notifications.filter((item) => item.kind === kind) : notifications;
  return clone([...items].sort((a, b) => millis(b.createdAt) - millis(a.createdAt)));
}

export function demoRecommendations(kind?: unknown) {
  const items = kind ? aiRecommendations.filter((item) => item.kind === kind) : aiRecommendations;
  return clone([...items].sort((a, b) => millis(b.createdAt) - millis(a.createdAt)));
}

export function demoCounts() {
  return {
    activities: activities.length,
    aiRecommendations: aiRecommendations.length,
    notes: notes.length,
    schedules: schedules.length,
    scans: scanLogs.length,
    transactions: transactions.length,
    users: 1,
  };
}

export function demoPageData(pageKey: string) {
  if (pageKey.startsWith('admin/')) {
    if (pageKey.includes('users')) return {users: [userProfile]};
    if (pageKey.includes('categories')) return {categories};
    if (pageKey.includes('announcements')) return {announcements};
    if (pageKey.includes('feedback')) return {feedback};
    if (pageKey.includes('ocr_logs')) return {scanLogs};
    if (pageKey.includes('system_health')) return {systemStatus};
    if (pageKey.includes('ai_knowledge')) return {recommendations: aiRecommendations};
    return {counts: demoCounts(), scanLogs, systemStatus};
  }

  if (pageKey === 'user/index') {
    const {from, to} = rangeForPage(pageKey);
    return {
      activities: demoBetween('activities', from, to),
      counts: demoCounts(),
      notes: demoNotes(),
      notifications: demoNotifications(),
      profile: userProfile,
      schedules: demoBetween('schedules', from, to),
      transactions: demoTransactionsBetween(from, to),
    };
  }
  if (pageKey.includes('calendar')) {
    const {from, to} = rangeForPage(pageKey);
    return {from, to, activities: demoBetween('activities', from, to), notes: demoNotes('study'), schedules: demoBetween('schedules', from, to)};
  }
  if (pageKey.includes('finance')) {
    const {from, to} = rangeForPage(pageKey);
    const type = pageKey.includes('_income') ? 'income' : pageKey.includes('_expense') ? 'expense' : undefined;
    return {from, to, transactions: demoTransactionsBetween(from, to, type)};
  }
  if (pageKey.includes('schedule_finance_sync')) {
    const {from, to} = rangeForPage(pageKey);
    return {from, to, activities: demoBetween('activities', from, to), schedules: demoBetween('schedules', from, to), transactions: demoTransactionsBetween(from, to)};
  }
  if (pageKey.includes('notes')) {
    const category = pageKey.includes('_study') ? 'study' : pageKey.includes('_work') ? 'work' : pageKey.includes('_ideas') ? 'idea' : undefined;
    return {notes: demoNotes(category)};
  }
  if (pageKey.includes('notifications')) {
    const kind = pageKey.includes('_urgent') ? 'urgent' : pageKey.includes('_ai') ? 'ai' : pageKey.includes('_finance') ? 'finance' : pageKey.includes('_schedule') ? 'schedule' : undefined;
    return {notifications: demoNotifications(kind)};
  }
  if (pageKey.includes('profile')) return {counts: demoCounts(), profile: userProfile};
  if (pageKey.includes('ai_')) return {recommendations: demoRecommendations()};
  return {profile: userProfile};
}

export async function demoAction() {
  return true;
}

export async function demoCreate(name: DemoCollection) {
  return `demo-${name}-${Date.now().toString(36)}`;
}
