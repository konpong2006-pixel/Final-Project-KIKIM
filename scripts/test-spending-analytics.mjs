import assert from 'node:assert/strict';

import {aggregateSpending} from '../src/services/spending-analytics.ts';

function bangkokDate(day, time = '12:00') {
  return `2026-08-${String(day).padStart(2, '0')}T${time}:00+07:00`;
}

const transactions = [
  {amount: 120, category: 'Food', occurredAt: bangkokDate(3), type: 'expense'},
  {amount: 80, category: 'food', occurredAt: bangkokDate(3, '19:00'), type: 'expense'},
  {amount: 50, category: 'Transport', occurredAt: bangkokDate(4), type: 'expense'},
  {amount: 2_000, category: 'Salary', occurredAt: bangkokDate(4), type: 'income'},
  {amount: 999, category: 'Shopping', occurredAt: bangkokDate(20), type: 'expense'},
  {amount: -40, category: 'Food', occurredAt: bangkokDate(4), type: 'expense'},
  {amount: 10, category: 'Invalid', occurredAt: 'not-a-date', type: 'expense'},
];

const week = aggregateSpending(transactions, 'week', new Date(bangkokDate(5)));
assert.equal(week.byDay.length, 7, 'a week must always render seven day bars');
assert.equal(week.total, 250);
assert.equal(week.transactionCount, 3);
assert.equal(week.highestDay?.key, '2026-08-03');
assert.equal(week.highestDay?.amount, 200);
assert.equal(week.highestCategory?.category, 'อาหารและเครื่องดื่ม', 'categories resolve to the shared list, not the first spelling seen');
assert.equal(week.highestCategory?.amount, 200);
assert.equal(Math.round(week.highestCategory?.percentage ?? 0), 80);

const month = aggregateSpending(transactions, 'month', new Date(bangkokDate(10)));
assert.equal(month.byDay.length, 31, 'August must render every calendar day');
assert.equal(month.total, 1_249);
assert.equal(month.byDay.find((point) => point.key === '2026-08-20')?.amount, 999);
assert.equal(month.highestCategory?.category, 'ช้อปปิ้ง/เสื้อผ้า');

const mixedSpellings = aggregateSpending([
  {amount: 100, category: 'Food', occurredAt: bangkokDate(3), type: 'expense'},
  {amount: 100, category: 'อาหาร', occurredAt: bangkokDate(4), type: 'expense'},
  {amount: 40, category: 'ค่าธรรมเนียม', occurredAt: bangkokDate(4), type: 'expense'},
  {amount: 20, category: 'Fees', occurredAt: bangkokDate(4), type: 'expense'},
], 'week', new Date(bangkokDate(5)));
assert.equal(mixedSpellings.byCategory.length, 2, 'English and Thai spellings of one category must not chart separately');
assert.equal(mixedSpellings.highestCategory?.category, 'อาหารและเครื่องดื่ม');
assert.equal(mixedSpellings.highestCategory?.amount, 200);
assert.equal(mixedSpellings.byCategory.find((entry) => entry.category === 'ค่าธรรมเนียม/โอนเงิน')?.amount, 60,
  'a transfer fee from a bank slip and one typed by hand share a bucket');

const empty = aggregateSpending([], 'month', new Date('2024-02-15T12:00:00+07:00'));
assert.equal(empty.byDay.length, 29, 'leap-year February must render 29 days');
assert.equal(empty.total, 0);
assert.equal(empty.highestDay, null);
assert.equal(empty.highestCategory, null);

const midnightBoundary = aggregateSpending([
  {amount: 75, category: 'Food', occurredAt: '2026-07-31T17:30:00.000Z', type: 'expense'},
], 'month', new Date(bangkokDate(5)));
assert.equal(midnightBoundary.byDay.find((point) => point.key === '2026-08-01')?.amount, 75, 'UTC timestamps must group by Bangkok calendar day');

console.log('Spending analytics tests passed.');
