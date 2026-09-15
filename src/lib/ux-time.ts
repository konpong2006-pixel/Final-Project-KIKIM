export function bangkokGreeting(now = new Date()) {
  const hour = new Date(now.getTime() + 7 * 3600000).getUTCHours();
  return hour < 5 ? 'สวัสดียามดึก' : hour < 12 ? 'สวัสดีตอนเช้า' : hour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
}

export function futureSuggestion(item: {startAt: string; endAt: string}, now = Date.now()) {
  const start = Date.parse(item.startAt), end = Date.parse(item.endAt);
  return Number.isFinite(start) && Number.isFinite(end) && start > now && end > start;
}

export function financeDate(value: unknown, fallback = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T12:00:00+07:00`);
  return Number.isFinite(parsed.getTime()) && new Date(parsed.getTime() + 7 * 3600000).toISOString().slice(0, 10) === value ? parsed : fallback;
}
