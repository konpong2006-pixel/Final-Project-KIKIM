function createSmartLifeCleanSurvey() {
  const form = FormApp.create('แบบสอบถามหลังใช้งานแอป SmartLife');
  form.setDescription(
    'แบบสอบถามนี้ไม่เก็บชื่อ อีเมล หรือข้อมูลระบุตัวตน ใช้เพื่อศึกษาจุดประสงค์ ประสบการณ์ใช้งาน และความคิดเห็นต่อระบบ SmartLife'
  );
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(false);

  const scale = ['1 = น้อยที่สุด', '2 = น้อย', '3 = ปานกลาง', '4 = มาก', '5 = มากที่สุด'];

  addChoice_(form, '1) ก่อนใช้ SmartLife คุณเคยใช้แอปจัดตารางชีวิต/การเงิน/โน้ตมาก่อนหรือไม่', [
    'เคย ใช้เป็นประจำ',
    'เคย แต่ใช้นาน ๆ ครั้ง',
    'ไม่เคย ใช้วิธีจดเองหรือจำเอง',
    'ไม่แน่ใจ',
  ]);

  addChoice_(form, '2) จุดประสงค์หลักที่อยากใช้ SmartLife คืออะไร', [
    'จัดตารางเรียน/ตารางชีวิต',
    'จัดการงานและเดดไลน์',
    'ควบคุมรายรับรายจ่าย',
    'ใช้ AI ช่วยสรุป/แนะนำ',
    'สแกนเอกสารหรือใบเสร็จ',
    'อื่น ๆ',
  ]);

  addChoice_(form, '3) โดยรวมแล้ว SmartLife ใช้งานง่ายแค่ไหน', scale);
  addChoice_(form, '4) AI Dynamic ช่วยจัดลำดับสิ่งสำคัญให้เห็นก่อนจริงแค่ไหน', scale);
  addChoice_(form, '5) Calendar / Planner ช่วยจัดตารางชีวิตได้ดีแค่ไหน', scale);
  addChoice_(form, '6) Adaptive Scheduling หรือ AI แนะนำช่วงเวลาทำงาน มีประโยชน์แค่ไหน', scale);
  addChoice_(form, '7) ระบบการเงินช่วยให้เข้าใจรายรับ รายจ่าย และเงินคงเหลือได้ดีแค่ไหน', scale);
  addChoice_(form, '8) Smart Scan / OCR ช่วยลดเวลาพิมพ์ข้อมูลเองได้แค่ไหน', scale);
  addChoice_(form, '9) AI Assistant ตอบคำถามเกี่ยวกับชีวิต ตาราง งาน โน้ต และการเงินได้ตรงแค่ไหน', scale);
  addChoice_(form, '10) ระบบแจ้งเตือนงาน/กิจกรรม มีประโยชน์แค่ไหน', scale);

  addCheckbox_(form, '11) ส่วนไหนของแอปที่คุณคิดว่ามีประโยชน์ที่สุด เลือกได้มากกว่า 1 ข้อ', [
    'AI Dynamic Dashboard',
    'Calendar / Planner',
    'Notes / Tasks',
    'Adaptive Scheduling',
    'Finance Dashboard',
    'LINE/Bank Import',
    'Smart Scan OCR',
    'AI Assistant',
  ]);

  addCheckbox_(form, '12) ส่วนไหนที่คุณคิดว่ายังใช้งานยากที่สุด เลือกได้มากกว่า 1 ข้อ', [
    'การเพิ่มข้อมูล',
    'การดูตาราง',
    'การเงิน',
    'AI Assistant',
    'Smart Scan',
    'การแจ้งเตือน',
    'การตั้งค่า/ขอสิทธิ์',
    'ยังไม่เจอจุดที่ยาก',
  ]);

  addChoice_(form, '13) คุณอยากใช้ SmartLife ต่อในชีวิตจริงหรือไม่', [
    'อยากใช้ต่อแน่นอน',
    'น่าจะใช้ต่อ',
    'ยังไม่แน่ใจ',
    'ไม่น่าจะใช้ต่อ',
  ]);

  form.addParagraphTextItem()
    .setTitle('14) จุดที่คุณชอบที่สุดใน SmartLife คืออะไร (ตอบหรือไม่ตอบก็ได้)')
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('15) ข้อเสนอแนะหรือจุดที่ควรปรับปรุงเพิ่มเติม (ตอบหรือไม่ตอบก็ได้)')
    .setRequired(false);

  Logger.log('EDIT_URL=' + form.getEditUrl());
  Logger.log('PUBLIC_URL=' + form.getPublishedUrl());
}

function addChoice_(form, title, choices) {
  form.addMultipleChoiceItem()
    .setTitle(title)
    .setChoiceValues(choices)
    .setRequired(true);
}

function addCheckbox_(form, title, choices) {
  form.addCheckboxItem()
    .setTitle(title)
    .setChoiceValues(choices)
    .setRequired(true);
}
