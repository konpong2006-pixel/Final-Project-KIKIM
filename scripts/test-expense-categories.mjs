import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  EXPENSE_CATEGORIES,
  FALLBACK_CATEGORY,
  matchExpenseCategory,
  normalizeExpenseCategory,
} from '../src/config/expense-categories.ts';

// ---------------------------------------------------------------- the list
const labels = EXPENSE_CATEGORIES.map((entry) => entry.label);
assert.equal(new Set(labels).size, labels.length, 'category labels must be unique');
assert.ok(labels.includes(FALLBACK_CATEGORY), 'the fallback must itself be a category');
for (const entry of EXPENSE_CATEGORIES) {
  assert.ok(entry.icon, `${entry.label} needs an icon`);
  assert.ok(entry.aliases.length, `${entry.label} needs at least one alias`);
  for (const alias of entry.aliases) {
    assert.equal(alias, alias.toLowerCase(), `alias "${alias}" must be lowercase to match`);
  }
}

// An alias belonging to two categories makes the match order silently decide.
const seen = new Map();
for (const entry of EXPENSE_CATEGORIES) {
  for (const alias of entry.aliases) {
    assert.ok(!seen.has(alias), `alias "${alias}" is claimed by both ${seen.get(alias)} and ${entry.label}`);
    seen.set(alias, entry.label);
  }
}

// -------------------------------------------------------------- resolution
assert.equal(normalizeExpenseCategory('Food'), 'อาหารและเครื่องดื่ม', 'legacy English values must land in the Thai bucket');
assert.equal(normalizeExpenseCategory('อาหาร'), 'อาหารและเครื่องดื่ม');
assert.equal(normalizeExpenseCategory('Fees'), 'ค่าธรรมเนียม/โอนเงิน');
assert.equal(normalizeExpenseCategory('ค่าธรรมเนียม'), 'ค่าธรรมเนียม/โอนเงิน', 'the K+ slip line item routes to the fee category');
assert.equal(normalizeExpenseCategory('อื่น ๆ'), 'อื่นๆ', 'the old spaced spelling must not be a separate bucket');
assert.equal(normalizeExpenseCategory(''), FALLBACK_CATEGORY);
assert.equal(normalizeExpenseCategory(null), FALLBACK_CATEGORY);
assert.equal(normalizeExpenseCategory(undefined), FALLBACK_CATEGORY);

// A category someone typed themselves is kept, never silently relabelled.
assert.equal(normalizeExpenseCategory('ค่าเลี้ยงแมว'), 'ค่าเลี้ยงแมว');
assert.equal(matchExpenseCategory('ค่าเลี้ยงแมว'), null);

// Every label must resolve to itself, or storing one would rewrite it.
for (const label of labels) {
  assert.equal(normalizeExpenseCategory(label), label, `${label} must round-trip`);
}

// ------------------------------------------------- the Cloud Function enum
// The function picks a category from its own English list and the client maps
// it onto a Thai label. A value there with no alias here would silently become
// "อื่นๆ" for the user, so the two lists are checked against each other.
const functionSource = fs.readFileSync(new URL('../functions/src/receipt-parsers/gemini-receipt.ts', import.meta.url), 'utf8');
const enumBlock = functionSource.match(/const CATEGORY_VALUES = \[([\s\S]*?)\] as const;/);
assert.ok(enumBlock, 'CATEGORY_VALUES must still be declared in gemini-receipt.ts');
const functionCategories = [...enumBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert.ok(functionCategories.length >= 10, `expected the extended list, saw ${functionCategories.length}`);

const stranded = functionCategories.filter((value) => !matchExpenseCategory(value));
assert.deepEqual(stranded, [], `these function categories have no alias in the app list: ${stranded.join(', ')}`);

console.log(`Expense category tests passed: ${labels.length} categories, ${functionCategories.length} function values all mapped.`);
