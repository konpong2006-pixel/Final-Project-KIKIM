const SMARTLIFE_FORM_ID = '1ExgNfbSddRycM8pdTStghU8Bz_g5fE_C88U42v3YAj8';

function repairSmartLifeExistingFormGrid() {
  const form = FormApp.openById(SMARTLIFE_FORM_ID);

  form.setTitle('แบบสอบถามหลังใช้งานแอป SmartLife');
  form.setDescription(
    'แบบสอบถามนี้ใช้เพื่อประเมินประสบการณ์หลังทดลองใช้งานแอป SmartLife ' +
    'โดยไม่เก็บชื่อ อีเมล หรือข้อมูลระบุตัวตนของผู้ตอบ'
  );
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(false);
  form.setConfirmationMessage('ขอบคุณสำหรับความคิดเห็นของคุณ ทีม SmartLife จะนำข้อมูลไปปรับปรุงระบบให้ใช้งานง่ายขึ้น');

  const items = form.getItems();
  for (let i = items.length - 1; i >= 0; i--) {
    form.deleteItem(items[i]);
  }

  addChoice_(
    form,
    '1) ก่อนใช้ SmartLife คุณเคยใช้แอปจัดตารางชีวิต / การเงิน / โน้ตมาก่อนหรือไม่',
    [
      'เคยใช้เป็นประจำ',
      'เคยใช้บ้างเป็นบางครั้ง',
      'เคยลองใช้แต่เลิกใช้แล้ว',
      'ไม่เคยใช้มาก่อน',
    ],
    true
  );

  addCheckbox_(
    form,
    '2) จุดประสงค์หลักที่คุณอยากใช้ SmartLife คืออะไร',
    [
      'จัดตารางเรียน / ตารางชีวิต',
      'จัดการงานที่ต้องทำ',
      'ควบคุมรายรับรายจ่าย',
      'ให้ AI ช่วยเตือนหรือแนะนำสิ่งสำคัญ',
      'สแกนเอกสาร / ใบเสร็จ',
      'ลดความยุ่งยากในการจัดการชีวิตประจำวัน',
      'อื่น ๆ',
    ],
    true
  );

  form.addGridItem()
    .setTitle('3) ให้คะแนนประสบการณ์ใช้งานแต่ละส่วนของ SmartLife')
    .setHelpText('เลือกคะแนน 1–5 ในแต่ละแถว โดย 1 = น้อยที่สุด และ 5 = มากที่สุด')
    .setRows([
      'โดยรวมแล้ว SmartLife ใช้งานง่ายแค่ไหน',
      'AI Dynamic ช่วยจัดลำดับสิ่งสำคัญให้เห็นก่อนจริงแค่ไหน',
      'Calendar / Planner ช่วยจัดตารางชีวิตได้ดีแค่ไหน',
      'Adaptive Scheduling มีประโยชน์แค่ไหน',
      'ระบบการเงินช่วยให้เข้าใจรายรับ รายจ่าย และเงินคงเหลือได้ดีแค่ไหน',
      'Smart Scan / OCR ช่วยลดเวลาพิมพ์ข้อมูลเองได้แค่ไหน',
      'AI Assistant ตอบคำถามได้ตรงและช่วยเหลือได้ดีแค่ไหน',
      'ระบบแจ้งเตือนงาน / กิจกรรม มีประโยชน์แค่ไหน',
    ])
    .setColumns([
      '1 = น้อยที่สุด',
      '2 = น้อย',
      '3 = ปานกลาง',
      '4 = มาก',
      '5 = มากที่สุด',
    ])
    .setRequired(true);

  addCheckbox_(
    form,
    '4) ฟีเจอร์ใดของ SmartLife ที่คุณคิดว่ามีประโยชน์ที่สุด',
    [
      'AI Dynamic Dashboard',
      'AI Assistant',
      'Calendar / Planner',
      'Adaptive Scheduling',
      'Notes / Tasks',
      'Finance Dashboard',
      'Smart Scan / OCR',
      'อ่านเงินจาก LINE / ธนาคาร',
      'ระบบแจ้งเตือน',
      'ยังไม่แน่ใจ',
    ],
    true
  );

  addCheckbox_(
    form,
    '5) ส่วนใดของ SmartLife ที่คุณรู้สึกว่าใช้งานยากหรือยังสับสน',
    [
      'ไม่มีส่วนที่สับสน',
      'การเพิ่มกิจกรรม / งาน',
      'การใช้งาน AI Assistant',
      'AI Dynamic Dashboard',
      'Adaptive Scheduling',
      'ระบบการเงิน',
      'Smart Scan / OCR',
      'การอ่านเงินจาก LINE / ธนาคาร',
      'การตั้งค่า / การขอสิทธิ์',
      'หน้าตาแอป / ปุ่มต่าง ๆ',
      'อื่น ๆ',
    ],
    true
  );

  addChoice_(
    form,
    '6) หาก SmartLife พัฒนาต่อ คุณมีแนวโน้มจะใช้ต่อหรือไม่',
    [
      'อยากใช้ต่อแน่นอน',
      'น่าจะใช้ต่อ',
      'ยังไม่แน่ใจ',
      'ไม่น่าจะใช้ต่อ',
    ],
    true
  );

  form.addParagraphTextItem()
    .setTitle('7) สิ่งที่คุณชอบที่สุดใน SmartLife คืออะไร')
    .setHelpText('ตอบหรือไม่ตอบก็ได้')
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('8) อยากให้ SmartLife ปรับปรุงหรือเพิ่มอะไรอีกบ้าง')
    .setHelpText('ตอบหรือไม่ตอบก็ได้')
    .setRequired(false);

  Logger.log('EDIT_URL=' + form.getEditUrl());
  Logger.log('PUBLIC_URL=' + form.getPublishedUrl());
}

function addChoice_(form, title, choices, required) {
  form.addMultipleChoiceItem()
    .setTitle(title)
    .setChoiceValues(choices)
    .setRequired(required);
}

function addCheckbox_(form, title, choices, required) {
  form.addCheckboxItem()
    .setTitle(title)
    .setChoiceValues(choices)
    .setRequired(required);
}
