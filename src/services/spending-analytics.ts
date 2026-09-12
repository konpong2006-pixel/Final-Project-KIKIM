import {normalizeExpenseCategory} from '@/config/expense-categories';
import {thailandDateKey, thailandRange} from '@/lib/thailand-time';

export type SpendingPeriod = 'week' | 'month';

export type SpendingTransactionInput = {
  amount?: unknown;
  category?: unknown;
  occurredAt?: unknown;
  type?: unknown;
};

export type SpendingDayPoint = {
  amount: number;
  date: Date;
  key: string;
  label: string;
  shortLabel: string;
};

export type SpendingCategoryPoint = {
  amount: number;
  category: string;
  percentage: number;
};

export type SpendingAnalytics = {
  byCategory: SpendingCategoryPoint[];
  byDay: SpendingDayPoint[];
  highestCategory: SpendingCategoryPoint | null;
  highestDay: SpendingDayPoint | null;
  total: number;
  transactionCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function transactionDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof value === 'object') {
    const timestamp = value as {seconds?: unknown; toDate?: () => Date; toMillis?: () => number};
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof timestamp.toMillis === 'function') {
      const date = new Date(timestamp.toMillis());
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof timestamp.seconds === 'number') {
      const date = new Date(timestamp.seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Resolved through the shared list so a legacy English row ('Food') and a Thai
// one land in one slice instead of being charted as two categories.
function categoryName(value: unknown) {
  return normalizeExpenseCategory(value);
}

function dayPoint(date: Date, period: SpendingPeriod): SpendingDayPoint {
  const shortLabel = period === 'week'
    ? new Intl.DateTimeFormat('th-TH', {timeZone: 'Asia/Bangkok', weekday: 'short'}).format(date)
    : new Intl.DateTimeFormat('th-TH', {day: 'numeric', timeZone: 'Asia/Bangkok'}).format(date);
  return {
    amount: 0,
    date,
    key: thailandDateKey(date),
    label: new Intl.DateTimeFormat('th-TH', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Bangkok',
      weekday: 'short',
      year: 'numeric',
    }).format(date),
    shortLabel,
  };
}

/** Builds a complete Bangkok-calendar series, including zero-spend days. */
export function aggregateSpending(
  transactions: SpendingTransactionInput[],
  period: SpendingPeriod,
  referenceDate = new Date(),
): SpendingAnalytics {
  const {from, to} = thailandRange(period, referenceDate);
  const dayCount = Math.round((to.getTime() - from.getTime() + 1) / DAY_MS);
  const byDay = Array.from({length: dayCount}, (_, index) => dayPoint(new Date(from.getTime() + index * DAY_MS), period));
  const dayLookup = new Map(byDay.map((point) => [point.key, point]));
  const categories = new Map<string, {amount: number; category: string}>();
  let total = 0;
  let transactionCount = 0;

  transactions.forEach((transaction) => {
    if (transaction.type !== 'expense') return;
    const amount = Number(transaction.amount);
    const occurredAt = transactionDate(transaction.occurredAt);
    if (!occurredAt || !Number.isFinite(amount) || amount <= 0) return;
    if (occurredAt.getTime() < from.getTime() || occurredAt.getTime() > to.getTime()) return;
    const point = dayLookup.get(thailandDateKey(occurredAt));
    if (!point) return;

    point.amount += amount;
    total += amount;
    transactionCount += 1;
    const category = categoryName(transaction.category);
    const categoryKey = category.toLocaleLowerCase('th-TH');
    const current = categories.get(categoryKey);
    categories.set(categoryKey, {amount: (current?.amount ?? 0) + amount, category: current?.category ?? category});
  });

  const byCategory = Array.from(categories.values())
    .sort((left, right) => right.amount - left.amount || left.category.localeCompare(right.category, 'th-TH'))
    .map((item) => ({...item, percentage: total > 0 ? item.amount / total * 100 : 0}));
  const highestDay = byDay.reduce<SpendingDayPoint | null>((highest, point) => (
    point.amount > (highest?.amount ?? 0) ? point : highest
  ), null);

  return {
    byCategory,
    byDay,
    highestCategory: byCategory[0] ?? null,
    highestDay: highestDay?.amount ? highestDay : null,
    total,
    transactionCount,
  };
}
