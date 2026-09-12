export const TRUSTED_COACHING_SOURCES = {
  finance: {
    label: 'ธนาคารแห่งประเทศไทย: แผนใช้เงิน',
    url: 'https://www.bot.or.th/th/satang-story/money-plan/budgeting.html',
  },
  /**
   * Duration bands only. The consensus statement gives recommended hours per
   * age group; it is not a burnout source, which is why it is named separately
   * from the wellbeing guidance rather than folded into it.
   */
  sleepDuration: {
    label: 'National Sleep Foundation: คำแนะนำชั่วโมงการนอนตามช่วงวัย',
    url: 'https://www.sleepfoundation.org/how-sleep-works/how-much-sleep-do-we-really-need',
  },
  wellbeing: {
    label: 'กรมสุขภาพจิต: ความรู้เรื่องภาวะหมดไฟ',
    url: 'https://mhc7.dmh.go.th/30/05/2024/18076/',
  },
} as const;

export const WELLBEING_AI_DISCLAIMER =
  'เราเป็นแค่เพื่อน AI น้า ถ้าเครียดมากหรือเป็นเรื่องใหญ่ ไปปรึกษาแพทย์หรือผู้เชี่ยวชาญจะดีที่สุดนะครับ';

export function activityForFreeSlot(minutes: number) {
  if (minutes < 30) return 'ช่วงนี้สั้นมาก แนะนำให้พักสายตา ดื่มน้ำ หรือหายใจช้า ๆ ก่อน ไม่ต้องฝืนเริ่มงานใหญ่';
  if (minutes < 60) return `ช่วงว่าง ${minutes} นาที เหมาะกับพักสั้น ๆ หรือเคลียร์งานเล็กที่จบได้ในช่วงเดียว`;
  if (minutes < 180) return `ช่วงว่าง ${minutes} นาที เหมาะกับงานขนาดกลางหนึ่งชิ้น โดยเว้นพักสั้น ๆ ระหว่างทาง`;
  return `ช่วงว่าง ${Math.round(minutes / 60)} ชั่วโมง เหมาะกับโปรเจกต์ใหญ่ แบ่งเป็นช่วงโฟกัสและพัก ไม่ต้องทำยาวรวดเดียว`;
}
