/**
 * The one spending-category list for the whole app.
 *
 * Before this there was no shared list at all -- just a free-form
 * `Transaction.category` string that every source filled differently:
 *
 *   - receipt scans wrote English from the OCR parser ("Food", "Others")
 *   - the LINE importer defaulted to the English "Others"
 *   - manually entered and seeded rows used Thai ("อาหาร", "เดินทาง")
 *
 * `spending-analytics` groups by the lowercased string, so "Food" and "อาหาร"
 * counted as two different categories and the charts fragmented silently.
 * Everything now resolves through this list.
 *
 * Values are stored as the Thai label, because that is what the user reads
 * everywhere in this app and what the existing Thai rows already contain.
 * `aliases` carry the legacy English values and common variants, so history
 * lands in the right bucket instead of being stranded.
 */

export type ExpenseCategory = {
  /** Extra spellings that map here, including the legacy English values. */
  aliases: string[];
  /** Material symbol, matching the icons the finance list already uses. */
  icon: string;
  /** Stored and displayed. */
  label: string;
};

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  {aliases: ['food', 'restaurant', 'cafe', 'coffee', 'อาหาร', 'เครื่องดื่ม', 'กาแฟ', 'ร้านอาหาร'], icon: 'restaurant', label: 'อาหารและเครื่องดื่ม'},
  // Kept separate from food rather than merged: the receipt parser already
  // distinguishes supermarket runs, and for a student a weekly grocery shop
  // and a lunch are different spending habits.
  {aliases: ['groceries', 'grocery', 'supermarket', 'convenience', 'ของชำ', 'ซูเปอร์', 'ตลาด'], icon: 'shopping_basket', label: 'ของชำ/ซูเปอร์'},
  {aliases: ['transport', 'transportation', 'fuel', 'taxi', 'grab', 'bts', 'mrt', 'เดินทาง', 'น้ำมัน', 'รถ', 'ค่ารถ'], icon: 'directions_bus', label: 'การเดินทาง'},
  {aliases: ['education', 'tuition', 'book', 'stationery', 'การศึกษา', 'ค่าเทอม', 'หนังสือ', 'เครื่องเขียน', 'ปริ้น'], icon: 'school', label: 'การศึกษา'},
  {aliases: ['housing', 'rent', 'dorm', 'ที่พัก', 'หอพัก', 'ค่าเช่า', 'ค่าหอ'], icon: 'home', label: 'ที่พัก/หอพัก'},
  {aliases: ['utilities', 'utility', 'electric', 'water', 'internet', 'phone', 'ค่าไฟ', 'ค่าน้ำ', 'อินเทอร์เน็ต', 'โทรศัพท์', 'เติมเงิน'], icon: 'bolt', label: 'สาธารณูปโภค'},
  {aliases: ['shopping', 'shop', 'store', 'clothes', 'clothing', 'ช้อป', 'เสื้อผ้า', 'ร้านค้า'], icon: 'shopping_bag', label: 'ช้อปปิ้ง/เสื้อผ้า'},
  {aliases: ['health', 'medical', 'pharmacy', 'hospital', 'สุขภาพ', 'ยา', 'โรงพยาบาล', 'คลินิก'], icon: 'medical_services', label: 'สุขภาพ'},
  {aliases: ['entertainment', 'movie', 'game', 'stream', 'บันเทิง', 'ภาพยนตร์', 'เกม', 'สังสรรค์'], icon: 'movie', label: 'บันเทิง/สังสรรค์'},
  // The concrete gap this list was extended for: a bank transfer slip carries
  // a "ค่าธรรมเนียม" line and nothing routed it anywhere.
  {aliases: ['fee', 'fees', 'transfer', 'bank', 'ค่าธรรมเนียม', 'โอนเงิน', 'โอน', 'ธนาคาร'], icon: 'account_balance', label: 'ค่าธรรมเนียม/โอนเงิน'},
  {aliases: ['personalcare', 'personal care', 'toiletries', 'ของใช้', 'ของใช้ส่วนตัว', 'เครื่องสำอาง'], icon: 'soap', label: 'ของใช้ส่วนตัว'},
  {aliases: ['insurance', 'ประกัน', 'เบี้ยประกัน'], icon: 'shield', label: 'ประกัน'},
  {aliases: ['savings', 'investment', 'invest', 'ออม', 'ออมเงิน', 'ลงทุน'], icon: 'savings', label: 'ออมเงิน/ลงทุน'},
  {aliases: ['gift', 'gifts', 'donation', 'charity', 'ของขวัญ', 'บริจาค', 'ทำบุญ'], icon: 'card_giftcard', label: 'ของขวัญ/บริจาค'},
  {aliases: ['others', 'other', 'misc', 'general', 'ทั่วไป', 'อื่น'], icon: 'category', label: 'อื่นๆ'},
];

/** The genuine last resort, never a silent default for a recognisable spend. */
export const FALLBACK_CATEGORY = 'อื่นๆ';

const BY_LABEL = new Map(EXPENSE_CATEGORIES.map((entry) => [entry.label.toLowerCase(), entry]));

/**
 * Resolves any stored or AI-produced value to a category in the list.
 *
 * Returns null when nothing matches, so callers can decide between keeping a
 * user's own wording and falling back -- this must not quietly relabel a
 * category someone typed themselves.
 */
export function matchExpenseCategory(value: unknown): ExpenseCategory | null {
  if (typeof value !== 'string') return null;
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  const exact = BY_LABEL.get(needle);
  if (exact) return exact;
  return EXPENSE_CATEGORIES.find((entry) =>
    entry.aliases.some((alias) => needle === alias || needle.includes(alias))) ?? null;
}

/** The label to store and display. Unrecognised text is kept, not overwritten. */
export function normalizeExpenseCategory(value: unknown) {
  const matched = matchExpenseCategory(value);
  if (matched) return matched.label;
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || FALLBACK_CATEGORY;
}

export function expenseCategoryIcon(value: unknown) {
  return matchExpenseCategory(value)?.icon ?? 'category';
}
