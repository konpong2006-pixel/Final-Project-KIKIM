# SmartLife — เอกสารส่งต่อโปรเจกต์ให้ Claude
ตรวจจาก local working tree วันที่ 14 กันยายน 2026 (Asia/Bangkok)

## 0. อ่านส่วนนี้ก่อน: สถานะจริงและข้อจำกัด
นี่คือคำอธิบายระบบและงานในเครื่อง ไม่ใช่ใบรับรองว่า production/APK ล่าสุดใช้ได้ครบทุกฟังก์ชัน
- โฟลเดอร์หลัก: C:/Users/konpo/Downloads/Final-Project
- Branch local: codex/friend-master-widget-only
- HEAD: c45a4797f543dfe0b11b3edf84731eae7e44f2c5 — feat: add Android home widget
- Commit ฐานของเพื่อนในประวัติ local: 2fdffb4 — fix(scan): a coloured timetable grid is still a grid, not a calendar
- ไม่ได้ตรวจว่า 2fdffb4 ยังเป็น commit ล่าสุดของ GitHub ในวันอ่านเอกสารนี้
- มีงานแก้ที่ยังไม่ commit จำนวนมาก และมีไฟล์ใหม่ untracked ดังนั้น HEAD ไม่ได้แทนโค้ดทั้งหมดที่กำลังใช้
- Repo ของเพื่อนที่ผู้ใช้ระบุ: https://github.com/faloxsgz5-oss/Final-Project
- ผู้ใช้ต้องการใช้ระบบของเพื่อนเป็นฐาน เพิ่ม Widget ของผู้ใช้ และแก้ตาม feedback โดยไม่อัปทับ GitHub เพื่อนโดยพลการ
- ไม่ได้ push/deploy ในรอบจัดทำเอกสารนี้; ไม่ลบ/เปลี่ยน Widget และไม่แก้โปรแกรมเพิ่มเติม
- localhost: http://127.0.0.1:8765/login/login/
- production: https://smartlife-budget.web.app/login/login
- localhost เป็น frontend local เท่านั้น ไม่ได้รับประกันว่าเชื่อมฐานข้อมูลทดสอบ หากไม่ได้เปิด emulator อาจเชื่อม Firebase จริง
- ข้อความใน README ที่กล่าวว่า backend deployed เป็นข้อมูลในเอกสารเดิม ไม่ใช่หลักฐานว่า backend มี local changes ชุดล่าสุด
- ไฟล์ APK ที่ชื่อ latest หรือไฟล์ screenshot เก่าไม่พิสูจน์ว่ามีโค้ดรอบนี้ ต้องตรวจ build/version และทดสอบแยก

## 1. โปรเจกต์นี้คืออะไร
SmartLife เป็นแอปสำหรับนักศึกษาและผู้ที่ต้องจัดการเรียน งาน ตารางชีวิต บันทึก การเงิน และการพักผ่อน โดยนำข้อมูลเหล่านี้มาแสดงรวมกันและสร้างคำแนะนำที่มีบริบท
เป้าหมายคือ ลดการกรอกข้อมูลซ้ำ รู้สิ่งที่ควรทำก่อน หาช่วงว่างที่ทำได้จริง คุมรายจ่าย และตระหนักถึงภาระงาน/เวลาพัก
ไม่ได้เป็นแอปธนาคาร ไม่โอนเงินจริง ไม่เข้าบัญชีธนาคารแทนผู้ใช้ และไม่ใช่อุปกรณ์วินิจฉัยสุขภาพ

กลุ่มผู้ใช้:
1. User: จัดการข้อมูลของตน ใช้ AI, OCR, ตาราง, เงิน และการแจ้งเตือน
2. Admin: ดูภาพรวมผู้ใช้ สถานะบริการ และข้อมูลดูแลระบบตามสิทธิ์
การมีหน้าจอ admin หรือ login provider อยู่ในโค้ดไม่แปลว่าสิทธิ์/provider บน production ตั้งครบแล้ว

## 2. เทคโนโลยีและโครงสร้าง
- Expo SDK 57 (~57.0.12), React Native 0.86.2, React 19.2.3, TypeScript
- Expo Router (~57.0.12); route หลัก src/app/[section]/[page]/index.tsx เลือกหน้าตาม section/page และสถานะผู้ใช้
- Firebase Auth, Firestore, Storage, Cloud Functions, Hosting; backend หลัก smartlife-budget, region asia-southeast1
- Functions package กำหนด Node 22; client และ functions มี package/TypeScript แยกกัน
- Gemini ใช้ช่วยตอบ/แปลง intent/อธิบาย/OCR บางเส้นทาง; Google Cloud Vision และ iApp ใช้ OCR ตามชนิดเอกสารและทางเลือกของ pipeline
- มี source fallback ของ OpenAI ใน schedule-parsers แต่การมีไฟล์ไม่พิสูจน์ว่าถูกเลือกใช้หรือเปิด secret ในระบบจริง
- Google Calendar OAuth/API ใช้ซิงก์ตาราง
- Android native module modules/smartlife-line-listener รวม notification listener, share receiver และ home widget
- src/screens/native คือหน้าจอที่พัฒนาหลัก; src/screens/legacy เป็นข้อมูลอ้างอิงหน้าตาเดิม อย่าแก้ไฟล์ legacy แล้วสรุปว่าหน้าจอที่ใช้จริงเปลี่ยนแล้ว
- src/services คือ logic/data access, src/dashboard คือ ranking, src/components คือ UI ใช้ร่วม, src/lib คือ config/time/utilities
- functions/src คือ backend source; functions/lib คือ output ที่ compile ต้องไม่แก้ lib อย่างเดียว
- firestore.rules, firestore.indexes.json, storage.rules เป็นส่วนของการติดตั้งและสิทธิ์ ไม่ใช่รายละเอียดที่ข้ามได้

AGENTS.md ในโปรเจกต์ระบุให้อ่าน https://docs.expo.dev/versions/v57.0.0/ ก่อนเขียนโค้ด ใช้ docs ตาม SDK จริง ไม่ใช้ API จาก SDK ล่าสุดโดยเดา

## 3. รายละเอียดแต่ละระบบ

### 3.1 บัญชีผู้ใช้และสิทธิ์
ไฟล์: src/services/auth.ts, src/providers/auth-provider.tsx, src/screens/auth/auth-portal.tsx, src/app/[section]/[page]/index.tsx
- สมัครด้วยอีเมล/รหัสผ่าน; เข้าสู่ระบบ; สร้าง/ตรวจ profile; โหลด role user/admin
- มี implementation Google และ Facebook sign-in, reset password, logout
- Native Google login ต้องมี build/certificate/OAuth config ที่ตรงกัน; ปุ่ม Facebook ไม่ใช่หลักฐานว่า provider เปิดใช้จริง
- Firebase Authentication ยืนยันตัวตน; Firestore rules และ callable ฝั่ง server ต้องตรวจ owner/role อีกชั้น
- App Check เป็นการยืนยันแอป แยกจาก login; login สำเร็จไม่ได้แปลว่า App Check/rules จะผ่าน
- ข้อผิดพลาด Missing or insufficient permissions และ App Check throttling ที่เคยพบ ต้องวิเคราะห์คนละชั้น ไม่แก้ด้วยเปิด allow read/write ให้ทุกคน

### 3.2 Onboarding และโปรไฟล์
ไฟล์: onboarding-screen.tsx, profile-screen.tsx, sleep-log.ts, monthly-budget.ts
- มีหน้าคำแนะนำเริ่มใช้งานและขั้นตอน onboarding
- โปรไฟล์ แสดงข้อมูลบัญชี/สรุปที่เกี่ยวข้อง ตั้งค่าช่วงนอน และเข้าตั้งค่าสิทธิ์แจ้งเตือน
- มี feedback และ logout; การส่ง feedback เป็น write จริง ควรใช้ข้อมูลทดสอบ
- การตั้งค่าใช้งานบางอย่างเก็บ local และ sync remote ต้องแยก synced/unsynced ไม่อ้างว่าบันทึก server แล้วหากเครือข่ายล้มเหลว

### 3.3 Dashboard / AI Dynamic
ไฟล์: dashboard-screen.tsx, src/dashboard/contextBuilder.ts, scoringEngine.ts, prioritizationService.ts, services/smartlife-recommendations.ts
- สรุปวันนี้ ตาราง งาน/สอบที่ควรโฟกัส งบใช้ได้ ภาพรวมรายจ่าย และความเสี่ยงภาระชีวิต
- จัดอันดับ class, assignment, exam, finance alert, note reminder และ wellbeing alert ตามข้อมูล
- คืน score, เหตุผล, การแสดง pinned/visible/hidden; มีข้อยกเว้นช่วงใกล้สอบและภาระชีวิตสูง
- ไม่ใช่ทุกคะแนนต้องเรียก LLM: ranking หลักเป็นกฎคำนวณตรวจสอบได้ ส่วน LLM ใช้อธิบายหรือแต่งคำแนะนำในบางเส้นทาง
- งาน/Task Priority, Dashboard ranking, Adaptive score และ Burnout score เป็นคนละเครื่องคำนวณ อย่าใช้สูตรเดียวแทนทุกระบบ
- คำแนะนำกิจกรรมมีเวลาเริ่ม/จบจาก free-slot engine และอาจเสริมคำอธิบายผ่าน enhanceSmartLifeRecommendations
- คำทักทายรอบล่าสุดคำนวณตามเวลาไทย ไม่ hardcode ว่าเช้า
- เชื่อมอัปเดตข้อมูลให้ Android Widget ผ่าน service; ไม่ใช่ widget ดึงทุกข้อมูลจาก Firestore เองตลอดเวลา

### 3.4 Calendar / Planner / กิจกรรม
ไฟล์: calendar-screen.tsx, planner-screen.tsx, activity-form-screen.tsx, firestore.ts
- ดูตารางรายวัน/สัปดาห์/เดือน และมีการแสดงระดับปีในระบบตาราง
- เพิ่มกิจกรรม งาน นัดหมาย และแบบฟอร์ม reminder พร้อมชื่อ วันที่ เวลา ระยะเวลา สถานที่ สี โน้ต และความสำคัญ
- ตารางเรียนและกิจกรรมเป็นคนละ collection; งานมักเป็น activity type task
- เช็กงานเสร็จ เลื่อน/จัดการกิจกรรม และตรวจตารางชนตามเส้นทาง UI
- แสดงรายการที่ชนก่อนบันทึก ให้กลับแก้หรือยืนยันซ้อนโดยเจตนา ไม่ถือว่าการยอมซ้อนเองเป็นความผิดของ AI
- Explicit date รองรับวันไกล ไม่ควรถูกจำกัดด้วย horizon ที่ใช้ค้นหาช่วงว่างอัตโนมัติ
- มีการจัดการชุดวิชา/series; ห้ามลบชุดใหญ่เพียงเพื่อทดสอบ
- ตัวเลือกการทำซ้ำในฟอร์มบางเส้นทางนำข้อความ recurrence ไปเก็บใน note จึงไม่ควรกล่าวว่าทุกชนิด recurrence สร้างรายการวนซ้ำครบถ้วนโดยไม่ได้ตรวจ write path
- วันที่เก็บเป็น Timestamp/ISO และแสดงไทย; มี utilities แปลง พ.ศ./ค.ศ./เลขไทย/เวลาไทย
- แม้มี timezone tests ผ่าน ยังไม่ใช่หลักฐานว่าทุก Date call ทุกหน้าใช้ timezone ถูกทั้งหมด

### 3.5 Google Calendar
ไฟล์: services/google-calendar.ts, components/google-calendar-sync-card.tsx
- เชื่อมบัญชี ตรวจสถานะ sync, สั่งซิงก์สองทาง, disconnect และ clear session
- มีการป้องกันการนำเข้าซ้ำตาม metadata ของ event
- Imported/external events เป็นข้อจำกัดคงที่ต่อ Adaptive; ระบบไม่ควรย้าย event ภายนอกเอง
- OAuth token/session และสิทธิ์ปฏิทินสำคัญ ไม่ได้ยืนยันว่า background sync ทำงานทุกเวลา
- การกด sync อาจเขียนทั้ง Google และ Firestore ไม่ใช่การทดสอบ read-only

### 3.6 Notes / Tasks
ไฟล์: notes-screen.tsx, note-form-screen.tsx, note-lock.ts, note-math.ts, document-note-text.ts
- สร้าง/แก้/ลบโน้ต แยกหมวด personal/study/work/ideas ตามชนิดที่ระบบรองรับ
- ค้นหา กรองตามโฟลเดอร์ ปักหมุด และสถานะงาน/บันทึกที่เกี่ยวข้อง
- มีโฟลเดอร์โน้ต และการเก็บข้อความจากเอกสารที่สแกน
- ค้นหาในหน้าบางเส้นทางทำบนรายการที่โหลดแล้ว ไม่ใช่ full-text search ของฐานข้อมูลทั้งบัญชีโดยอัตโนมัติ
- มี PIN ล็อกโน้ต ใช้ salted SHA-256; ตัวเนื้อหายังอยู่ plaintext ใน Firestore ไม่ใช่ end-to-end encryption
- มี note math สำหรับคำนวณนิพจน์ตามขอบเขต parser
- AI ช่วยแนะนำโน้ตและกิจกรรมจากบริบท; ต้องแยกข้อแนะนำออกจากรายการที่บันทึกจริง

### 3.7 Adaptive Scheduling
ไฟล์: adaptive-scheduling-screen.tsx, services/adaptive-scheduling.ts, functions/src/adaptive-scheduling/{engine,functions,validation,types}.ts
- เปิดใช้ ตั้งค่าเวลาที่สะดวก/เวลานอน ข้อห้ามรายหมวด น้ำหนักคะแนน ภาระงาน/ช่วงพัก และความเป็นส่วนตัว
- Suggestion Mode เป็น default; automatic rescheduling ต้องเปิดเอง ไม่ใช่ AI ย้ายทุกงานเสมอ
- เรียนรู้จาก behavior เช่น create/start/complete/postpone/cancel/accept/reject/reschedule/undo
- แยก pattern ตามหมวดและวัน; เอกสารระบบกำหนดข้อมูลน้อยกว่า 3 ครั้งยังไม่พอ, 3–5 ต่ำ, 6–10 กลาง, 11+ สูง เป็นค่าเริ่มต้นที่ server sanitize ได้
- เสนอเวลา อธิบายคะแนน เลือกเวลาอื่น ยอมรับ ปฏิเสธ ล็อก และ Undo
- ประมวลผลคำสั่งภาษาธรรมชาติ; rebalance วัน/สัปดาห์; มี scheduled recalculation และ outcome sweep
- งานย้ายได้ต้อง flexible, ไม่ locked, allowAiReschedule; นัดหมาย/มีผู้ร่วม/มี Google event เป็นข้อจำกัด
- ตรวจ deadline, duration, availability, sleep, conflict, transition, workload และ scheduleVersion
- ยอมรับคำแนะนำต้องตรวจซ้ำใน transaction เพื่อกันข้อมูลเก่าหรือหลายอุปกรณ์แก้พร้อมกัน
- Gemini แปลงคำสั่งหรือเขียนคำอธิบาย ไม่ควรเป็นผู้ตัดสินเวลาและเขียนตารางโดยไม่ผ่าน engine
- ข้อมูลไม่พอ/fallback ต้องบอกตรงๆ ไม่แต่งว่าเรียนรู้นิสัยผู้ใช้แล้ว

### 3.8 AI Assistant
ไฟล์: assistant-screen.tsx และ services/assistant-*; backend smartLifeAssistantReply
- สนทนาเรื่องตาราง งาน เรียน โน้ต งบประมาณ การเงิน และการจัดการชีวิตในขอบเขต SmartLife
- แยก intent, action intent, note intent, task ranking และ response strategy
- สร้าง context จากข้อมูลที่มีจริง รวม financial scenario, dynamic insights, behavior, history/memory ตามเส้นทาง
- มีประวัติสนทนา/แชตชั่วคราว ระบบข้อความต่อเนื่อง การเลื่อนข้อความล่าสุด และคำถามต่อยอด
- รองรับข้อความ เสียง/ถอดเสียง และไฟล์ผ่านบริการที่กำหนด; availability ขึ้นกับ platform/permission/provider
- proposed action เป็นร่าง ต้องยืนยันก่อนเขียน ไม่ใช้ข้อความตอบของ AI เป็นหลักฐานว่างานบันทึกแล้ว
- แก้วัน/เวลาร่างล่าสุดที่ยัง pending คง title/action ID; คำสั่งกำกวมต้องถามเพิ่ม
- มี auth retry, error mapping, safe fallback, message sanitizer, telemetry และ timeout/loading
- ไม่รับประกันคำตอบถูกทุกกรณีแม้มี API key; ต้องเทียบกับ context, records, เวลา และจำนวนเงินจริง
- financial scenario สมมุติต้องใช้จำนวนที่ผู้ใช้ถาม ไม่แทนด้วยยอดจริงของบัญชีโดยไม่อธิบาย
- รอบแก้ PDF เพิ่ม elapsed seconds และคำเตือนรอนานกว่า 30 วินาที ไม่ได้พิสูจน์ว่า latency ลดลง

### 3.9 Finance / งบประมาณ
ไฟล์: finance-screen.tsx, monthly-budget-screen.tsx, monthly-budget*.ts, spending-analytics.ts, budget-tension.ts, dynamic-insights.ts
- เพิ่มรายรับ/รายจ่ายด้วยมือ แก้หมวด/โน้ต และจัดการรายการตาม UI
- สรุปวัน/สัปดาห์/เดือน แยกรายรับ รายจ่าย ภาพรวม รายการล่าสุด และกราฟหมวดรายจ่าย
- แสดงยอดสุทธิในช่วง = รายรับ - รายจ่าย ไม่ใช่ยอดคงเหลือจริงในบัญชีธนาคารทั้งหมด
- งบรายเดือนเป็นเพดานที่ผู้ใช้ตั้ง แยกจากรายรับที่นำเข้า
- การอ่านรายรับเพิ่ม transaction ไม่ได้เพิ่มเพดานงบรายเดือนโดยอัตโนมัติในสูตรที่ตรวจ
- local-first monthly budget มี sync status/timeout และการจัดการเดือนใหม่ตาม service
- มี daily allowance, weekly share, budget tension, overspend, runway และคำแนะนำ
- รอบล่าสุดเก็บ period/date/filter ผ่าน URL; reload ของ URL เดิมรักษาค่า ไม่ใช่ตั้งค่าถาวรทั้งบัญชี
- หากโหลดผิดพลาดแสดง error/retry ไม่สรุปเป็นศูนย์; ป้องกัน response ของช่วงเก่าทับช่วงใหม่
- ไม่เติมรายรับให้มากขึ้นเพียงเพื่อทำให้ยอดสุทธิไม่ติดลบ

### 3.10 อ่านแจ้งเตือนการเงิน LINE + แอปธนาคาร
ไฟล์: line-import-screen.tsx, line-bank-screen.tsx, line-import-service.ts, line-transaction-parser*.ts, functions/src/line-import.ts, native module
- Android NotificationListenerService กรอง package และข้อมูลการเงิน
- มี allowlist LINE และ package ของธนาคารบางแอป เช่น K PLUS/SCB/กรุงไทย/กรุงเทพ/กรุงศรี/ttb ตาม source ไม่ใช่รับประกันใช้ได้กับทุกเวอร์ชัน
- Android ต้องอนุญาต Notification Access; แอปไม่ควรข้ามการอนุญาตของระบบ
- มี consent tier, listener status, คิวในเครื่อง, ส่ง pendingReview และระบบ sync
- รองรับ paste/share เป็นทางเลือก ไม่ต้องรอ notification เสมอ
- Parser ตรวจจำนวนเงิน ทิศทางเข้า/ออก ธนาคาร วันเวลา บัญชีที่ปิดบางส่วน balance และ confidence/warnings
- ข้อความ KBank LINE ที่มีเพียง “แจ้งเตือนรายการเงินเข้า” ไม่มีจำนวนเงิน ไม่สามารถเดายอดจากการ์ดในแชตได้
- K PLUS notification ที่มีจำนวนเงินเป็นอีก source; listener ไม่ได้อ่านภาพใน LINE หรือเปิดหน้าแอปธนาคาร
- Auto-save ต้องผ่านเงื่อนไขครบ ไม่ใช่ confidence สูงอย่างเดียว; ที่ client pending flow ตรวจ >=0.85, needsReview false, ไม่มี warnings และเงื่อนไขข้อมูล
- รายการไม่ชัดรอตรวจ แก้แล้ว confirm/reject ได้; มี duplicate choices ตาม flow
- ตรวจซ้ำต้องดูหลักฐานรายการ ไม่ตัดทิ้งเพียงเพราะยอดเท่ากัน; ธุรกรรมจริงสองครั้งยอดเท่ากันอาจต้องเก็บทั้งคู่
- raw text มี retention/cleanup ตาม backend; ตรวจว่า scheduled cleanup deploy แล้วก่อนสัญญาเรื่องเวลาลบจริง
- Source bank_auto_listener/line_auto_listener ต้องคงไว้ ไม่ hardcode LINE ทุกกรณี
- ชื่อฟีเจอร์ใหม่ “อ่านแจ้งเตือนการเงิน” แต่ชื่อไฟล์/collection/callable เดิมยังมี LINE เพื่อคง compatibility
- Web/iOS ไม่สามารถใช้ Android listener นี้; การมีหน้าตั้งค่าบนเว็บไม่ได้ทำให้ browser อ่านแจ้งเตือนแอปอื่นได้

### 3.11 Smart Scan / OCR
ไฟล์: scan-screen.tsx, ocr-history-screen.tsx, services/{ocr,scan-save,storage}.ts, functions/src/index.ts และ parser directories
- เลือกภาพ/เอกสารตามหน้าที่รองรับ อัปโหลดและเรียก analyzeScan
- แยกชนิดใบเสร็จ/สลิป ตารางเรียน และเอกสารข้อความ เลือก pipeline/provider ตามชนิดและ fallback
- มี parser สำหรับ university course/exam/list/grid/calendar block และการอ่านข้อความทั่วไป
- อ่านยอด รายการสินค้า ร้านค้า หมวด วันที่ เวลา reference พร้อมข้อมูลความมั่นใจ/ควรตรวจ
- Preview/edit ก่อนบันทึก ไป transactions, schedules หรือ notes ตามเอกสาร
- OCR history/scanLogs เก็บผลและสถานะ; ไม่ควรเปิดเผยเอกสารของผู้ใช้อื่น
- Financial multi-image flow สูงสุด 10 รูป เป็นคิวตรวจทีละใบ ไม่ใช่เพิ่ม 10 transactions โดยไม่ตรวจ
- saveReviewedReceipt ฝั่ง server ใช้ transaction และ receipt dedupe keys; scan-save client เรียกเส้นทางนี้
- รูปเดิมห้ามสร้างยอดซ้ำ; ภาพครอป/แก้จน hash ต่างและไม่มี reference ยังมีข้อจำกัด ไม่สัญญา 100%
- PDF ข้อ 1 ตารางเรียนเป็นงานของเพื่อนที่สั่งให้ข้าม ห้ามแก้ทับโดยอ้างว่าเป็นส่วนของรอบล่าสุด
- Provider call มีค่าใช้จ่าย/ส่งไฟล์ออกนอกเครื่อง ต้องขออนุญาตใช้เอกสารจริงก่อน

### 3.12 Sleep / Burnout / Wellbeing
ไฟล์: sleep-log-card.tsx, sleep-log.ts, sleep-window.ts, sleep-baseline-remote.ts, dynamic-insights.ts, risk-meter.tsx
- ตั้งเวลานอน/ตื่นปกติ baseline; กดเข้านอน/ตื่น; จัดการเวลาที่ลืมบันทึก
- เก็บ sleep log เป็น activity หมวด sleep ไม่ได้สร้างฐานข้อมูลอีกระบบอิสระ
- ช่วงที่รับเป็นการนอนหลัก 2–14 ชั่วโมงตาม validation ไม่ใช่การประเมินทางการแพทย์ว่านอนต่ำกว่า 2 ชั่วโมงไม่มีประโยชน์
- แยกข้อมูล logged จริง / baseline ที่ผู้ใช้ตั้ง / ไม่มีข้อมูล
- ประเมินภาระวันนี้/สัปดาห์ งานค้าง งานเลยกำหนด ช่วงงานต่อเนื่อง เวลาว่าง และสัญญาณการนอน
- ส่ง score/reasons/protectiveFactors/evidenceCoverage/sleep debt ไปแสดงและประกอบ assistant
- ความเสี่ยงต่ำ/กลาง/สูง ไม่ใช่ความน่าจะเป็นของโรค และไม่ใช่แบบวัดคลินิกที่ผ่านการรับรอง
- อย่าสรุปว่าความตึงการเงินถูกบวกเข้าคะแนน Burnout โดยตรงเพียงเพราะข้อมูลสองอย่างอยู่ใน dynamic object เดียวกัน: ในส่วน score ที่ตรวจเป็นภาระและการนอน ส่วน finance pressure คำนวณแยก

### 3.13 Notifications
ไฟล์: notification-feed.ts, deadline-notifications.ts, push-notifications.ts, notifications-screen.tsx
- Feed ในแอป แยก urgent/AI/finance/schedule และสถานะอ่านตามเส้นทาง
- รวมข้อมูลแจ้งเตือนของระบบกับคำเตือนจากข้อมูลผู้ใช้ เช่น งานและงบประมาณ
- Native local reminders และ native push เป็นคนละส่วนกับ feed ใน Firestore
- คำเตือน expo-notifications บนเว็บไม่ได้พิสูจน์ว่า feed ในแอปเสียทุกชนิด
- รอบล่าสุดหลีกเลี่ยง native module import/registration บน web ไม่ใช่เพิ่ม browser Web Push
- กฎ lead-time ของ reminders มีหลาย service ต้องตรวจ call path จริง ไม่เหมาว่างาน urgent เตือนก่อนมากที่สุดทุกระบบ

### 3.14 Android Home Widget
ไฟล์: services/android-home-widget.ts, modules/smartlife-line-listener/android/.../SmartLifeWidgetProvider.kt และ res/layout/xml/drawable
- Native AppWidgetProvider + RemoteViews ไม่ใช่หน้าจอ React Native ที่ย่อบน home screen
- แสดงวัน/เลขวันที่ หัวข้อ สรุป งานโฟกัส งบ และเวลาอัปเดต
- app ส่ง snapshot ผ่าน updateHomeWidgetAsync; native เก็บ SharedPreferences แล้วอัปเดต instances
- แตะ widget เปิดแอป
- ข้อมูลอาจเก่าถ้า app ไม่ส่ง snapshot ใหม่ ไม่ควรอ้างว่า realtime background เสมอ
- ต้องตรวจการล้าง/เปลี่ยน snapshot เมื่อ logout/สลับบัญชีเพื่อไม่ให้ข้อมูลบัญชีก่อนค้าง เป็นรายการตรวจเพิ่มเติม ไม่ใช่บั๊กที่ยืนยันแล้ว
- โค้ดที่ตรวจเป็น Android; ไม่มีหลักฐาน iOS WidgetKit implementation
- MuMu อาจใช้ได้หาก launcher รองรับ widget แต่รอบนี้ไม่ได้ install/test; ไม่ยืนยันจากชื่อ APK เก่า
- ห้าม prebuild --clean หรือเอา native module ออกโดยไม่มี backup และแผนรักษา Widget

### 3.15 Admin / การดูแลระบบ
ไฟล์: src/screens/admin/admin-portal.tsx, src/services/admin*.ts, src/admin, functions/src/index.ts
- Dashboard count/overview, user list และรายละเอียดตามสิทธิ์
- มี backend สำหรับ disable user และสร้าง reset link ต้องมี role/authorization
- Monitoring AI recommendation audit, assistant telemetry, OCR logs, system health/integration probes
- Announcements และ fan-out notifications, feedback, categories และ AI knowledge ตามหน้า admin
- Seed demo data เป็นคำสั่งเปลี่ยนข้อมูลจริง ไม่ใช้เป็น read-only diagnostic
- หน้า health ไม่แทนการทดสอบใช้งานครบเส้นทาง; secrets/provider outages/quotas ต้องตรวจแยก

### 3.16 UI ร่วมและ schedule-finance
- โทนเดิม sage green/earthy, finance violet, note pink ตามหน้าจอ; ไม่เปลี่ยนสีทั้งระบบในรอบแก้
- Shared tabs/shell, toast, confirm/conflict dialogs, date-time picker แยก web/native, loading/success modal
- หน้า schedule-finance แสดงข้อมูลตารางร่วมกับคำแนะนำงบตามวัน/สัปดาห์/เดือน
- มี responsive components; การมี component ไม่แปลว่าตรวจทุกขนาดหน้าจอแล้ว

## 4. สูตร/เกณฑ์สำคัญที่ตรวจจาก source
### 4.1 งบรายเดือนและรายวัน
ให้ B = งบรายเดือน, N = จำนวนวันในเดือนตาม Bangkok, d = วันที่วันนี้, E = รายจ่ายเดือนที่ส่งเข้าเครื่องคำนวณ
- R = B - E
- จำนวนวันที่เหลือรวมวันนี้ D = max(1, N - d + 1)
- averageDailyBudget = round(B / N)
- remainingDailyBudget = R > 0 ? round(R / D) : 0
- expectedSpentByToday = B/N*d
- overspendAmount = max(0, E - expectedSpentByToday)
- net transactions ในช่วง = income - expense แยกจาก R และ daily allowance
ตัวอย่าง B=3000, N=30, วันที่1 ไม่มีรายจ่าย -> 100 บาท/วัน
ตัวอย่างเดือน31วัน -> round(3000/31)=97 บาท: “เลขกลม” ในโค้ดคือจำนวนเต็ม ไม่ได้ปัดเป็นหลักสิบ และ 97*31 ไม่เท่ากับ3000 จึงต้องอัปเดตจากยอดเหลือจริง ไม่คูณยอดแสดงเพื่อรับประกันไม่เกินงบ
สูตรนี้ไม่บวกรายรับเข้า B; จะเพิ่มเพดานต้องเป็นนโยบายใหม่/ผู้ใช้เปลี่ยนงบ
weekly share ตัดช่วงจันทร์–อาทิตย์ตามขอบเดือน; usage >=80% warning, >=100% exceeded
runway ใช้ค่าเฉลี่ยวันซึ่งมีรายจ่าย ไม่ใช่เฉลี่ยทุกวันปฏิทิน
ข้อควรระวัง: caller ต้องส่ง transactions ของช่วงเดือนที่ถูกต้อง เพราะเครื่องคำนวณ spentSoFar รวม expenses ใน input

### 4.2 Dashboard ranking (ค่าเริ่มต้น ไม่ใช่คะแนนทุกโมดูล)
คะแนนรวมโดยแนวคิด = 0.35*baseUrgency + typeSeverity + timeScore + finance/wellbeing contributions - pastPenalty แล้วใช้ overrides/clamp 0–100
- type: exam34, assignment22, class12, finance18, note8, wellbeing26
- time: <=3ชม. เพิ่ม34; <=24ชม. เพิ่ม34*0.78; หลังจากนั้นลดแบบ exponential
- past grace15นาที, past penalty70 ตามเงื่อนไขใน engine
- ใกล้สอบ24ชม.: exam floor94, assignment ที่เกี่ยวข้อง floor88; high wellbeing override100
- displayCap5, pinnedCap2; ranking ties ใช้เวลาและ createdAt
ต้องอ่าน scoringEngine.ts เพื่อใช้เงื่อนไขเต็ม ไม่บวกทุกน้ำหนักให้ทุก item พร้อมกัน

### 4.3 Burnout
คะแนน heuristic 0–100; >=65 สูง, >=35 กลาง, ต่ำกว่า35 ต่ำ
ตัวอย่างองค์ประกอบ: ภาระ >=8ชม.+25 หรือ >=6ชม.+15; ต่อเนื่อง>=4ชม.+25 หรือ >=3ชม.+15; งานค้าง>=6 +20 หรือ>=3 +10; งานเลยกำหนด +10/งาน สูงสุด20
ยังมี high-load days, sleep band/debt/late streak และช่วงว่าง; ต้องใช้สูตรเต็ม ไม่ถือว่าตัวอย่างนี้เป็นสูตรทั้งหมด
baseline ไม่เท่ากับ logged evidence; คะแนนไม่ใช่เปอร์เซ็นต์ป่วย
มี helper บางส่วนใน dynamic-insights.ts ใช้ local Date calls อยู่ จึงควร audit เวลาในส่วน wellbeing ต่อเมื่อทดสอบข้าม timezone ไม่เหมาว่า finance timezone tests ครอบคลุมทุกส่วนแล้ว

## 5. Data Retrieval / Manipulation / Storage
- Auth -> uid -> collection ของเจ้าของข้อมูลเป็นรูปแบบหลัก
- Firestore services อ่าน query/onSnapshot ตามช่วงเวลาและหน้า สร้าง/แก้/ลบข้อมูล พร้อม ownerId/createdAt/updatedAt
- Collection ที่พบ: schedules, activities, notes, noteFolders, transactions, scanLogs, bankNotifications, pendingReview, notifications, feedback, aiRecommendations
- settings รวม adaptiveScheduling/noteLock และ settings งบ/การนอนตาม service
- Adaptive: schedulingBehaviorEvents, schedulingPatterns, schedulingSuggestions, scheduleChangeHistory, productivityInsights, pushTokens
- Assistant มีประวัติ/ความจำ/การวิเคราะห์ไฟล์ตาม assistant-*; ตรวจ path จาก services จริงก่อน migration
- Storage เก็บไฟล์ OCR/attachment ตาม policy; อย่าย้ายไฟล์ผู้ใช้จริงหรือเปิด public เพื่อแก้ permission
- OCR: file -> upload -> analyzeScan -> parser/review -> user confirmation -> saveReviewedReceipt หรือ notes/schedules
- Notification: Android allowlist -> local queue -> parser -> auto-save/review -> transactions -> finance/dynamic context
- AI: retrieve context -> rules/intent + LLM ตามทางเลือก -> proposed action -> user confirmation -> server validation -> save
- Adaptive: events -> patterns -> candidate slots -> score/validate -> accept transaction -> history/notification
- ข้อมูล dedupe กับข้อความดิบไม่ใช่ transaction เดียวกันเสมอ ต้องรักษา retention และ owner scope เมื่อแก้ schema
- การไม่มี index, rule ไม่ตรง, auth ยังไม่พร้อม และ App Check ล้มเหลวให้ error ต่างกัน ไม่แสดง empty state ปกติเพื่อกลบ

## 6. API keys / security
มี secret identifiers GEMINI_API_KEY, GEMINI_OCR_API_KEY, IAPP_API_KEY ใน backend source; ใช้ Secret Manager ตาม deployment/config
Firebase public config กับ Google client IDs ไม่ใช่ server secrets แต่กฎ Auth/App Check/Firestore ยังจำเป็น
ไม่แนบ .env.local, debug token, service account, refresh token, production signing key, raw user data หรือ APK ลงเอกสารนี้
อย่าสรุปว่าการเพิ่ม LLM API key จะทำให้ ranking/finance ถูกขึ้น: คณิตศาสตร์และ validation ควร deterministic; LLM ช่วยภาษา/intent/extraction ที่ตรวจผลได้
ห้ามให้ AI แต่งยอด/วันเวลาที่ไม่อยู่ในแจ้งเตือนหรือแต่งผล OCR เพื่อให้ UX ดูสำเร็จ
ไม่ควรส่งเอกสารส่วนตัวไป provider จริงเพื่อทดสอบโดยไม่มีอนุญาต

## 7. งานแก้ PDF (12 ก.ย.) — โค้ดมีแล้ว แต่แยกระดับหลักฐาน
แหล่งสรุปเดิม docs/PDF-FEEDBACK-FIXES-2026-09-12.md; source PDF ที่ผู้ใช้ให้ D:/Dowload/เอกสารไม่มีชื่อ.pdf
| ข้อ | ปัญหา | สิ่งที่แก้ | หลักฐาน/สิ่งที่ยังขาด |
|---|---|---|---|
|1|ตารางเรียนแบบรูปอ่านไม่ได้|ข้ามตามผู้ใช้ เพื่อนทำแล้ว|ไม่ได้แก้/รับรองใหม่ในรอบนี้|
|2|เพิ่มสลิปหลายใบไม่ได้|financial picker สูงสุด10รูป มีคิว retry/skip|มีโค้ด; ยังขาด full UI/device test ของทั้งคิว|
|3|สลิปเดิมยอดซ้ำ|server transaction + scan/hash/reference keys|unit dedupe ผ่าน; ยังขาด concurrent Firestore E2E และ OCR จริง; ไม่ลบรายการซ้ำเก่า|
|4|Dashboard มียอด Finance0|แยกงบกับnet/ช่วงเวลา/error state/stale-response guard|มีโค้ด; ยังต้องเทียบข้อมูลไม่เป็นศูนย์ในบัญชีทดสอบ|
|5|AI รอนานไม่บอกสถานะ|elapsed seconds, >30s message และสถานะ scan|มี UI code; ไม่ใช่ลดเวลา AI; ยังขาด provider latency test|
|6|ตัวอักษรเล็ก|เพิ่มข้อความรองบางจุดเป็นอย่างน้อย12 คงสี|ปรับบางหน้า ไม่ใช่ audit ทุกหน้า/ทุกขนาด|
|7|หมวดผิด|whole-word matching, แยก payment channel, default ไม่มั่ว|regression categories ผ่าน; ยังขาด provider E2E|
|8|แก้วันเวลาร่างแล้วบันทึกไม่ได้|dateLocked/userSelectedTime/timezone, explicit long date validation|logic test ผ่าน; backend ต้องตรงกับ frontend จึงตรวจรับได้|
|9|แก้เวลาแล้ว AI สร้างหัวข้อใหม่|editScheduleDraft ผูก pending draft คงID/title ถามเมื่อกำกวม|regression ผ่าน; ไม่ใช่ย้ายกิจกรรมที่บันทึกแล้ว|
|10|ไม่มีรายละเอียด|ไม่เพิ่มขอบเขต|ไม่มีงานให้ตรวจ|

ไฟล์เกี่ยวข้อง: scan-screen.tsx, assistant-screen.tsx, activity-form-screen.tsx, finance-screen.tsx, dashboard-screen.tsx, user-ui.tsx, services/assistant-draft-edit.ts, assistant-tools.ts, ocr.ts, scan-save.ts, types/smartlife.ts, functions/src/index.ts, receipt-parsers/receipt-dedupe.ts, deterministic-receipt.ts, gemini-receipt.ts, adaptive-scheduling/functions.ts และ firestore.rules ตาม diff
storage.ts มีงานค้างใน working tree เช่นกัน อย่าเหมาว่าทั้งหมดสร้างในรอบนี้หรือทับทิ้งโดยไม่ตรวจ

## 8. งาน UX รอบล่าสุด (14 ก.ย.)
| ปัญหา | วิธีแก้ | พิสูจน์แล้ว | ยังไม่พิสูจน์ |
|---|---|---|---|
|AI เสนอ12:00ตอน13:14|ตัดช่วงอดีต เผื่อ1นาที ใช้Bangkok ตรวจcache/result/เลือก/ก่อนwrite|fixture actual engine 13:14 ->13:15; gapสั้นเลือกพรุ่งนี้; expiry check|providerจริงและ UI save ครบเส้นทาง|
|คำแนะนำค้างจนหมดอายุ|การ์ดบอกหมดอายุ เปิดหน้าคำนวณใหม่|source/typecheck|กดบนบัญชีจริง/รอทิ้งไว้จริง|
|copy LINE ขัดกัน|อธิบาย auto เฉพาะครบ+ผ่านตรวจ, ป้ายอ่านมั่นใจสูง, warnings|source/static assertions|pendingจริงครบทุกสาเหตุ|
|source bank ถูกระบุLINE|ส่ง item.source เดิม, แสดง origin บนreview|source/typecheck|server persisted transaction จริง|
|Finance refreshลืมช่วง|period/date/filter ในURL ใช้Router dynamic path|date validation/static route assertion/build|หลังlogin refresh/Back/Forwardเต็ม|
|ทักเช้าตอนบ่าย/ตอนตอนนี้|clock hook เวลาไทย/แก้คำซ้ำ|greeting boundaries ทดสอบ3timezone|ทุกresume/day boundaryบนnative|
|web native push warning|conditional module import + web guards|mock runtime webไม่load native, Androidload; local login bundleใหม่ไม่พบwarningใหม่|Web Pushไม่ได้เพิ่ม; native push deliveryยังไม่เทส|
|ชื่อfeatureแค่LINE|อ่านแจ้งเตือนการเงิน + consent/privacy/native notify wording|sourceตรวจ|ทุกข้อความจากbackend/nativeเก่าที่deployแล้ว|

ไฟล์เพิ่ม: src/lib/ux-time.ts, src/hooks/use-current-clock.ts, scripts/test-ux-feedback.mjs, docs/UX-FIXES-2026-09-14.md
ไฟล์แก้: smartlife-recommendations.ts, ai-activity-recommendation-card.tsx, activity-form-screen.tsx, finance-screen.tsx, dashboard-screen.tsx, notifications-screen.tsx, line-import-screen.tsx, line-bank-screen.tsx, profile-screen.tsx, push-notifications.ts, deadline-notifications.ts, line-import-service.ts
ไม่แก้ Widget ในรอบนี้

## 9. ตอบตรงๆ: แก้ได้จริงหรือยัง
ระดับหลักฐานต้องใช้คำให้ตรง:
A. พบ implementation ใน source = มีโค้ด ไม่ใช่ผลใช้งาน
B. Typecheck/build ผ่าน = ตรวจโครงสร้างและ compile ไม่ใช่ยืนยันข้อมูล/สิทธิ์/UX
C. Unit/regression/mock ผ่าน = พิสูจน์กรณีจำลองที่ระบุ ไม่ใช่ provider หรือ transaction จริงทั้งหมด
D. Browser smoke ผ่าน = หน้าโหลดและ bundle ถูกต้อง ไม่ใช่ทุกหน้าหลัง login
E. E2E + deployment match + device test = สิ่งที่ยังขาดสำหรับการรับรองเต็มระบบ

ผลรอบจัดทำเอกสาร:
- npm.cmd run typecheck: ผ่านรันใหม่
- scripts/test-pdf-feedback.mjs: ผ่านรันใหม่ (draft edits, dedupe keys, categories)
- scripts/test-ux-feedback.mjs: ผ่านรันใหม่ (future slots, greeting, dates, source/copy checks, mocked native load)
- npm.cmd test: ผ่านรันใหม่ครบชุดที่กำหนดใน script (exit 0); ไม่รวม emulator/provider tests ทุกตัว
- npm.cmd --prefix functions run lint: ผ่านรันใหม่ (tsc --noEmit, exit 0) เป็นการตรวจ TypeScript ไม่ได้ build/deploy Functions
ผลก่อนหน้าในวันที่14:
- npm test ผ่านชุดหลัก; web export ผ่าน และ runtime configครบ6ค่า
- bundle ล่าสุดที่ตรวจใน local login: entry-fa4f9de0d6c2c83e8083c832149506f8.js
- ตรวจว่ามี guard คำแนะนำหมดอายุระหว่างยืนยันใน bundle; local login เปิดได้
- ไม่พบ native push warning ใหม่จาก bundleนี้ แต่ console historyยังมีwarningจากbundleเก่า
- UX tests ด้านเวลาเคยรัน UTC/Bangkok/New_York ผ่าน
- PDF regression บางส่วน import functions/lib จึงอ้าง compiled artifacts ที่มีอยู่ ไม่ใช่หลักฐานว่าพึ่ง build backend ล่าสุดในรอบเอกสาร
ผล QA ก่อนหน้า docs/LOCAL-QA-2026-09-13.md บันทึก Functions build/parser tests ผ่านด้วย mocks ไม่ใช่ provider จริง

ดังนั้นตอบว่า “แก้ implementation แล้ว และหลาย logic tests ผ่าน” ได้
แต่ห้ามตอบว่า “ทุกระบบใช้ได้จริง100%”, “productionแก้แล้ว”, “APKล่าสุดผ่านแล้ว” หรือ “Claude cloneแล้วได้ทุกอย่าง” จากหลักฐานนี้

## 10. ผล UX production กับ local เป็นคนละชุด
docs/UX-DAY6-2026-09-14.md เป็น production read-only ตรวจประมาณ13:12–13:18ไทย ไม่ใช่ผลตรวจรับ local changes
พบ AIเสนอเวลาอดีต, copy reviewขัดกัน, finance reloadลืมช่วง, greetingผิด, คำซ้ำ และnative push warning
ผ่านในขอบเขตจำกัด: session, ตารางวันนี้บางส่วนสอดคล้อง, งบ176ตรงกัน, financeเปลี่ยนช่วง, profile/notificationsโหลด, Notes mobileบางส่วน
รายรับรายจ่ายของช่วงที่ตรวจเป็น0 จึงไม่พิสูจน์กรณีเงินจริง/ติดลบ
Adaptive latency15–16วินาทีเป็นหลักฐาน Day1 เดิม ไม่ใช่ผลจับเวลาใหม่รอบนี้
อย่าสร้างผลรายวันที่ไม่ได้ทดสอบ หรือนำ local tests แทน production tests
มี automation UX 7วันเริ่ม9ก.ย. สรุป15ก.ย.; scheduler/task history ไม่ได้ติดไปกับ git clone อัตโนมัติ

## 11. สิ่งที่ Claude ควรทำต่อเรียงลำดับ
1. ตรวจ working tree/branch/diff/untracked และอ่านเอกสารนี้ก่อน อย่า reset/clean
2. แยก source local กับ frontend build/backend deployed/APK และเลือก environmentทดสอบที่ชัดเจน
3. ให้ผู้ใช้ loginเองในบัญชีทดสอบ ห้ามขอให้ส่งpassword/tokenในแชต
4. Test Finance period/date/filter -> reload -> Back/Forward; เทียบ Dashboardด้วยรายการทดสอบและยอดติดลบ
5. Test AI13:14, ไม่มีช่องว่างพอ, midnight, timezone, ทิ้งdraft/dialogจนหมดอายุ
6. Test OCRหลายรูป cancel/retry/skip/save next; duplicate same file/reencoded/reference/สองรายการยอดเท่ากัน
7. Test receipt concurrent save บน emulator และตรวจ permission/cross-user deny
8. Test draftแก้วันไกล/พ.ศ./กำกวม/พับการ์ด/ชื่อIDเดิม/server-confirmed time
9. Test Android listener LINEข้อความครบ/ไม่ครบ/ธนาคาร/แจ้งเตือนซ้ำ/สองsources/เวลาparse/permission revoke/background
10. Test Widget install/add/update/click/process death/logout/switch account โดยไม่ลบงานเพื่อน
11. Testจริงด้วยprovider เมื่อได้อนุญาตใช้งานและส่งไฟล์ทดสอบแล้วเท่านั้น
12. แจ้งผลเป็น expected/actual/pass/fail/not tested พร้อม environment และ commit+dirty diff

สิ่งที่ไม่ควรทำเพื่อกลบปัญหา:
- เปิดFirestore rulesกว้างๆ, ใส่server secretในclient, ปิดwarningsทั้งหมด
- ใช้ยอด0แทนload error, เพิ่มfake transaction, ลบข้อมูลซ้ำจริงโดยไม่ตรวจ
- ถอดreview/dedupeเพื่อให้auto-saveทุกอัน, เดาจำนวนเงินจากข้อความไม่มีตัวเลข
- เปลี่ยนสีทั้งระบบ, แก้Widgetทับ, เปลี่ยนฐานกลับไปcodeของผู้ใช้ทั้งชุด
- Deployเพื่อให้การทดสอบผ่านโดยไม่ประสานเพื่อน

## 12. วิธีส่งให้ Claude และเก็บงานไม่ให้หาย
ส่งไฟล์เอกสารนี้และให้ Claude Code เปิดโฟลเดอร์localเดิมจะตรงที่สุด
ถ้าClaudeใช้เครื่องอื่น ต้องส่ง source snapshot ที่รวม tracked modifications และไฟล์ใหม่ ไม่ใช่แค่clone commitc45a479
ให้เจ้าของเลือกbackup/commitในbranchของตนก่อนส่ง ห้ามpushของเพื่อนเอง และห้ามgit add . เพราะในโฟลเดอร์มีAPK รูป screenshot ไฟล์ชั่วคราวและข้อมูลที่ไม่ควรส่ง
git diffปกติไม่รวมuntracked; zip/source handoffต้องรวมไฟล์ใหม่ที่เกี่ยวข้องอย่างเจาะจง
ควรส่ง package.json/lockfile, src, functions/src+package/lockfile, modules, plugins/configที่จำเป็น, Firebase rules/indexes, scripts tests, docs และAGENTS.md
ไม่ส่ง node_modules, .gitทั้งก้อนโดยไม่จำเป็น, .env.local, signing keys, service accounts, refresh tokens, private user files, APKเก่าเป็นตัวแทนsource
ไม่อ้างว่าChat history/automations/secret configอยู่ในrepository

คำสั่งอ่านสถานะใน CMD/PowerShell (ไม่deploy):
    cd C:\Users\konpo\Downloads\Final-Project
    git status --short
    git branch --show-current
    git rev-parse HEAD
    git diff --stat
    git ls-files --others --exclude-standard

คำสั่งตรวจที่ใช้ในเครื่องนี้:
    npm.cmd run typecheck
    npm.cmd --prefix functions run lint
    node --experimental-strip-types scripts/test-pdf-feedback.mjs
    node --experimental-strip-types scripts/test-ux-feedback.mjs
    npm.cmd test
    npm.cmd run build:web

npm.cmd ช่วยหลีกเลี่ยง PowerShell เรียก npm.ps1 ที่ถูก ExecutionPolicyบล็อก ไม่จำเป็นต้องปิดนโยบายทั้งเครื่อง
npm test ไม่ได้รวมทุก test script: OCR/adaptive/provider/rules/emulator tests ต้องเลือกเพิ่ม
build:web สร้างdist ไม่ใช่deploy; ตัวpreview:web ในpackageอาจdeploy Firebase preview channel อย่าใช้ถ้าขอเพียงlocal
ก่อนทดสอบrules/integration ให้อ่านscriptก่อนเพราะบางคำสั่งมีemulator:clear และต้องไม่สับสนกับproduction

## 13. เงื่อนไขก่อน deploy ในอนาคต (ยังไม่ได้อนุญาตให้ทำตอนนี้)
1. แจ้งกลุ่มและตกลงผู้deployหนึ่งคนเพื่อไม่ทับกัน
2. ตรวจGitHubbranch/commitล่าสุดจริง ไม่ยึดhashในเอกสารที่ล้าสมัย
3. รักษาlocal modificationsก่อนfetch/pull/merge ห้ามhard resetแล้วทำงานค้างหาย
4. รวมpatchในฐานล่าสุดที่ได้รับอนุมัติ ให้รุ่นที่จะdeployเป็นcommitted/tested stateตรงกับremoteที่ทีมตกลง
5. ตรวจHEADกับcommitที่ทีมอนุมัติ; ถ้าไม่ตรงหยุด ไม่แกล้งบอกว่าสะอาดทั้งที่dirty
6. สำหรับการแก้OCR/receipt/adaptiveชุดนี้ต้องเผยแพร่backendและfrontendที่เข้าคู่กัน รวม analyzeScan, saveReviewedReceipt และcreateAdaptiveActivityตามdiff และrules/indexesที่เกี่ยวข้อง
7. ใช้README/package scriptsตามขอบเขตจริง script deploy:adaptive-backendไม่ได้deployOCRทั้งหมด
8. ตรวจผลFunctionsและHostingแยกกัน แล้วทำsmoke test ไม่ถือว่าขึ้นเว็บแล้วbackendอัปเดต
9. APK/native releaseเป็นงานแยกจากเว็บ; ต้องbuild/install/testwidgetและlistenerใหม่ตามnative changes

## 14. เอกสารที่ควรอ่านต่อ
- docs/PDF-FEEDBACK-FIXES-2026-09-12.md
- docs/LOCAL-QA-2026-09-13.md
- docs/UX-DAY6-2026-09-14.md
- docs/UX-FIXES-2026-09-14.md
- README.md, docs/SCREEN_MAP.md, docs/ADAPTIVE_SCHEDULING.md
- docs/line-bank-import.md, docs/google-calendar-setup.md, docs/FIREBASE_SETUP.md, docs/AI_RELEASE_CHECKLIST.md
- src/dashboard/README.md และSCORING_PSEUDOCODE.md
ใช้เอกสารเดิมประกอบ source ไม่ให้ข้อความเก่า overrideข้อจำกัดใหม่ โดยเฉพาะ “deployแล้ว” และ “LINEเท่านั้น”

## 15. ภาคผนวก: แผนที่ไฟล์และ public symbols
### Backend exports แบบกลุ่มที่ต้องตรวจเพิ่ม

index.ts มี destructured exports จาก createAdaptiveSchedulingFunctions จึงไม่อยู่ในรายการ regex export const name ด้านล่างทั้งหมด:
acceptSchedulingSuggestion, activateAdaptiveScheduling, calculateSchedulingPatterns, chooseAlternativeSchedulingTime, createAdaptiveActivity, deleteSchedulingBehaviorHistory, deleteSchedulingPattern, generateAdaptiveSuggestion, getAdaptiveSchedulingDashboard, lockAdaptiveScheduleItem, processNaturalLanguageScheduleCommand, rebalanceUserDay, rebalanceUserWeek, recordSchedulingBehavior, registerAdaptivePushToken, rejectSchedulingSuggestion, scheduledAdaptiveOutcomeSweep, scheduledAdaptivePatternRecalculation, scheduledAutomaticAdaptiveScheduling, undoScheduleChange, updateAdaptiveSchedulingPreferences

line-import.ts: updateLineConsent, reportLineListenerStatus, enqueueLinePendingReview, confirmLineTransaction, rejectLinePendingReview, parseLineBankMessage, cleanupExpiredLinePendingReviews

Firestore service objects: schedules, activities, notes, noteFolders, noteLock, transactions, pendingReviews, scanLogs, notifications, aiRecommendations, feedback มี methods ภายใน เช่น list/watch/create/update/remove/between ตาม object จริง ไม่ใช่ทุก object มี method เท่ากัน

### File/public symbol index

สแกน 143 ไฟล์ใน services/screens/native/dashboard/hooks/components/functions/src ของworking treeนี้
รายชื่อ exportเป็นดัชนีให้Claudeไปอ่านต่อ ไม่ใช่รับรองว่าแต่ละexportถูกใช้ในUI หรือทำงานจริงผ่านแล้ว
รายการนี้รวมtypes/interfaces/constants; ไม่แสดงprivate helpers/object methodsทั้งหมด ต้องอ่านmoduleที่เกี่ยวข้องเพิ่มเติม
ชื่อpathด้านล่างอ้างอิงจากproject root เพื่อให้ย้ายเครื่องได้

- src/services/adaptive-scheduling.ts
  - exports: AdaptiveCategory, AdaptiveConfidence, AdaptivePreferences, AdaptiveSuggestion, AdaptivePattern, AdaptiveHistory, ProductivityInsight, AdaptiveDashboard, ActivateAdaptiveResult, AdaptiveProposedActivity, AdaptiveCreateConflict, AdaptiveCreateActivityResult, NaturalLanguageScheduleResult, adaptiveScheduling
- src/services/admin-cloud.ts
  - exports: AdminAuthUser, AppCheckClientReport, RecommendationContextGroup, RecommendationAudit, adminCloud
- src/services/admin-overview.ts
  - exports: AdminUserCounts, OVERVIEW_USER_LIMIT, adminOverviewCounts
- src/services/admin-user-data.ts
  - exports: AdminUserProfile, toMillis, toEventInput, toNoteInput, toTransactionInput, adminUserProfile, adminUserCalendar, adminUserNotes, adminUserTransactions, AdminScanRecord, adminUserScans
- src/services/admin.ts
  - exports: adminCategories, adminAnnouncements, adminMonitoring
- src/services/android-home-widget.ts
  - exports: updateAndroidHomeWidget
- src/services/assistant-action-intent.ts
  - exports: FinanceMutationKind, splitAssistantMessageClauses, explicitMutationClause, readOnlyClausesFromMixedMessage, isReadOnlyOrAdviceRequest, financeMutationKind, isExplicitNoteMutation
- src/services/assistant-auth-retry.ts
  - exports: withAssistantAuthRetry
- src/services/assistant-conversation.ts
  - exports: ASSISTANT_CONVERSATION_VERSION, createAssistantConversationId, createAssistantConversationState, assistantActiveConversationKey, assistantConversationHistoryKey, assistantConversationStateKey, updateAssistantConversationState, mergeAssistantConversationState, parseAssistantConversationState
- src/services/assistant-draft-edit.ts
  - exports: editScheduleDraft
- src/services/assistant-error.ts
  - exports: classifyAssistantError, assistantErrorMessage, assistantActionErrorMessage
- src/services/assistant-file.ts
  - exports: uploadAndAnalyzeAssistantFile
- src/services/assistant-financial-scenario.ts
  - exports: shouldUseDeterministicFinancialScenario, updateFinancialScenario, deterministicFinancialScenarioAnswer
- src/services/assistant-history.ts
  - exports: AssistantConversationSummary, saveAssistantMessage, updateAssistantMessagePayload, listAssistantConversations, loadAssistantConversation, deleteAssistantConversation
- src/services/assistant-intent.ts
  - exports: AssistantIntent, normalizeAssistantInput, classifyAssistantIntent, latestConversationIntent
- src/services/assistant-memory.ts
  - exports: AssistantPreferences, loadAssistantPreferences, saveAssistantPreference
- src/services/assistant-message-sanitizer.ts
  - exports: sanitizeAssistantMessages
- src/services/assistant-note-intent.ts
  - exports: isNoteLookupIntent, noteLookupTerms
- src/services/assistant-response-strategy.ts
  - exports: AssistantExecutionRoute, chooseAssistantExecutionRoute, isSavingsPlanningRequest, chooseAssistantResponseMode
- src/services/assistant-safe-fallback.ts
  - exports: isReceiptImageLookupRequest, selfContainedAssistantFallback
- src/services/assistant-task-ranking.ts
  - exports: AssistantTaskRankInput, rankAssistantTasks
- src/services/assistant-tools.ts
  - exports: assistantToolSchemas, AssistantContext, AssistantReply, recordAssistantTelemetry, scheduleCreationClarification, loadAssistantContext, proposeActionFromMessage, buildAssistantReply, confirmAssistantAction
- src/services/assistant-voice.ts
  - exports: transcribeAssistantAudio
- src/services/auth.ts
  - exports: AppRole, registerWithEmail, signInWithEmail, ensureUserProfile, signInWithGoogle, signInWithFacebook, sendResetEmail, signOutCurrentUser, getUserRole
- src/services/behavior-tracking.ts
  - exports: recordTaskCompleted, recordTaskPostponed
- src/services/budget-tension.ts
  - exports: evaluateBudgetTension
- src/services/deadline-notifications.ts
  - exports: syncDeadlineNotifications, useDeadlineNotificationNavigation
- src/services/demo-data.ts
  - exports: demoCollection, demoBetween, demoTransactionsBetween, demoNoteFolders, demoNotes, demoNotifications, demoRecommendations, demoCounts, demoPageData, demoAction, demoCreate
- src/services/document-note-text.ts
  - exports: documentNoteText
- src/services/dynamic-insights.ts
  - exports: FinanceBudgetInsight, BurnoutDynamicInsight, SmartLifeDynamicInsight, calculateFinanceBudgetInsight, DailyAllowance, calculateDailyAllowance, TensionLevel, BudgetTension, calculateBudgetTension, SLEEP_REFERENCE, SLEEP_SCORE_WEIGHTS, sleepBandScore, sleepDurationBand, isSleepActivity, calculateBurnoutDynamicInsight
- src/services/firestore.ts
  - exports: ScheduleConflict, deleteCourseSeries, schedules, activities, findScheduleConflicts, notes, noteFolders, noteLock, transactions, pendingReviews, scanLogs, notifications, aiRecommendations, feedback
- src/services/google-calendar.ts
  - exports: GoogleCalendarSyncResult, GoogleCalendarConnection, googleCalendarErrorMessage, watchGoogleCalendarConnection, preloadGoogleCalendarAuth, clearGoogleCalendarSession, disconnectGoogleCalendar, syncGoogleCalendar
- src/services/legacy-data.ts
  - exports: LegacyDataAction, loadLegacyPageData, runLegacyDataAction
- src/services/line-bank-parser.ts
  - exports: BankNotificationParsed, parseLineBankNotification
- src/services/line-bank-service.ts
  - exports: BankNotification, submitBankText, listPendingNotifications, confirmNotification, rejectNotification, autoConfirmHighConfidence
- src/services/line-import-service.ts
  - exports: NativeLineListenerState, ConfirmLineTransactionResult, LineConsentUpdateResult, getLineConsent, setLineConsentTier, getNativeLineListenerState, openLineNotificationAccessSettings, requestLineListenerReconnect, consumeSharedLineText, disableNativeLineListener, subscribeToNativeLineNotifications, linePendingReviews, enqueueLinePendingReview, enqueueAutoBankReview, confirmLineTransaction, rejectLinePendingReview, syncLineAutoImport
- src/services/line-transaction-parser-core.ts
  - exports: SupportedBank, LineParserMode, LineTransactionType, ParsedLineTransaction, toArabicDigits, normalizeLineText, maskAccountNumbers, isPotentialFinancialLineMessage, splitLineMessageBatch, parseLineMessageLocally
- src/services/line-transaction-parser.ts
  - exports: ParsedLineImportDraft, fingerprintLineText, parseLineImportMessage, parseLineImportBatch
- src/services/monthly-budget-remote.ts
  - exports: RemoteBudget, readRemoteBudget, readLatestRemoteBudgetBefore, writeRemoteBudget
- src/services/monthly-budget.ts
  - exports: MonthlyBudget, MONTHLY_BUDGET_MAX, SYNC_TIMEOUT_MS, currentMonthKey, parseBudgetAmount, isValidBudgetAmount, loadMonthlyBudget, saveMonthlyBudget
- src/services/note-lock.ts
  - exports: NoteLockState, pinProblem, getNoteLockState, setNotePin, verifyNotePin, clearNotePin, setBiometricEnabled
- src/services/note-math.ts
  - exports: MathLine, evaluateExpression, evaluateNoteBody
- src/services/notification-feed.ts
  - exports: FeedSource, FeedSeverity, FeedItem, itemsOf, string, millis, priorityScore, priorityReasons, isOpen, isRankable, isCalendarUrgent, isNoteImportant, buildNotificationFeed, unreadCount
- src/services/ocr.ts
  - exports: ScanType, ScanClassification, OcrResult, UploadedOcrResult, ReviewedReceiptPayload, saveReviewedReceipt, uploadAndAnalyzeScan
- src/services/push-notifications.ts
  - exports: registerAdaptivePushNotifications, cancelAllTaskReminders, scheduleTaskReminders
- src/services/scan-save.ts
  - exports: SavedScan, parseCurrencyAmount, saveOcrResult
- src/services/sleep-baseline-remote.ts
  - exports: RemoteSleepBaseline, SLEEP_BASELINE_SETTING_ID, readRemoteSleepBaseline, writeRemoteSleepBaseline
- src/services/sleep-log.ts
  - exports: SLEEP_LOG_TITLE, SLEEP_LOG_CATEGORY, SleepBaseline, isValidSleepBaseline, loadSleepBaseline, saveSleepBaseline, clearSleepBaseline, findOpenSleepLog, startSleepLog, FinishSleepResult, finishSleepLog, removeSleepLog, StaleSleepLog, findStaleSleepLog, resolveStaleSleepLog
- src/services/sleep-window.ts
  - exports: MINIMUM_NIGHT_HOURS, MAXIMUM_NIGHT_HOURS, SleepWindow, parseClockMinutes, formatClockMinutes, baselineNightHours, isValidSleepWindow, DEFAULT_NIGHT_HOURS, suggestedWakeTime
- src/services/smartlife-recommendations.ts
  - exports: ActivitySuggestion, NoteSuggestion, recommendationLevel, buildGroundedAcademicSuggestionsFromData, buildActivitySuggestionsFromData, buildNoteSuggestionsFromData, getActivitySuggestions, getGroundedAcademicSuggestions, getNoteSuggestions
- src/services/spending-analytics.ts
  - exports: SpendingPeriod, SpendingTransactionInput, SpendingDayPoint, SpendingCategoryPoint, SpendingAnalytics, aggregateSpending
- src/services/storage.ts
  - exports: UploadKind, localImageUriToBlob, uploadUserImage, uploadAssistantFile
- src/screens/native/user/activity-form-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/adaptive-scheduling-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/assistant-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/calendar-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/dashboard-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/finance-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/line-bank-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/line-import-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/misc-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/monthly-budget-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/note-form-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/notes-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/notifications-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/ocr-history-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/onboarding-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/planner-screen.tsx
  - exports: PlannerTab
- src/screens/native/user/profile-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/scan-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/schedule-finance-screen.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/screens/native/user/user-ui.tsx
  - exports: UserNavigate, MaterialIcon, UserGradientBackdrop, UserShell, UserHeader, Card, PrimaryButton, LoadingBlock, EmptyBlock, LegacyUserTabBar, UserTabBar, userStyles
- src/dashboard/contextBuilder.ts
  - exports: InMemoryDashboardItemRepository, buildDashboardContextFromRepository, buildDashboardContext, buildDashboardContextSummary
- src/dashboard/prioritization.routes.ts
  - exports: ExpressLikeRequest, ExpressLikeResponse, ExpressLikeNext, ExpressLikeRouter, registerPrioritizationRoutes
- src/dashboard/prioritizationService.ts
  - exports: DashboardPrioritizationService
- src/dashboard/scoringEngine.ts
  - exports: defaultPriorityScoringConfig, mergePriorityScoringConfig, prioritizeDashboardItems, scoreDashboardItem
- src/dashboard/types.ts
  - exports: DashboardItemType, DashboardVisibility, BurnoutRiskLevel, DashboardItemBase, ExamDashboardItem, AssignmentDashboardItem, ClassScheduleDashboardItem, FinanceAlertDashboardItem, WellbeingAlertDashboardItem, NoteReminderDashboardItem, DashboardItem, PrioritizedItem, DashboardContextSummary, DashboardContext, PrioritizationResponse, PriorityScoringConfig, PrioritizeDashboardOptions, PartialPriorityScoringConfig, DashboardItemRepository, PrioritizationRequest
- src/dashboard/__tests__/prioritizationService.test.ts
  - exports: runPrioritizationServiceTests
- src/dashboard/__tests__/scoringEngine.test.ts
  - exports: runScoringEngineTests
- src/hooks/use-color-scheme.ts
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/hooks/use-color-scheme.web.ts
  - exports: useColorScheme
- src/hooks/use-current-clock.ts
  - exports: useCurrentClock
- src/hooks/use-theme.ts
  - exports: useTheme
- src/components/ai-activity-recommendation-card.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/animated-icon.tsx
  - exports: AnimatedSplashOverlay, AnimatedIcon
- src/components/animated-icon.web.tsx
  - exports: AnimatedSplashOverlay, AnimatedIcon
- src/components/app-tabs.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/app-tabs.web.tsx
  - exports: TabButton, CustomTabList
- src/components/app-toast.tsx
  - exports: ToastTone, showToast, toastMessage, dismissToast
- src/components/async-action-ui.tsx
  - exports: AsyncActionStatus, SuccessCheckmarkAnimation, LoadingConfirmationButton, AsyncActionOverlay
- src/components/confirm-dialog.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/date-time-picker.tsx
  - exports: PlainDateTimeFieldProps, PlainDateTimeField
- src/components/date-time-picker.web.tsx
  - exports: PlainDateTimeField
- src/components/external-link.tsx
  - exports: ExternalLink
- src/components/google-calendar-sync-card.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/hint-row.tsx
  - exports: HintRow
- src/components/html-document-view.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/html-document-view.web.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/layout/responsive-safe-area.tsx
  - exports: ResponsiveSafeArea
- src/components/legacy/legacy-page-dom.tsx
  - exports: LegacyAuthRequest, LegacyAuthResult, LegacyScanRequest, LegacyScanResult, LegacyOcrResult
- src/components/legacy/legacy-page-dom.web.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/loading-success-modal.tsx
  - exports: FeedbackPhase
- src/components/note-picker-dialog.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/note-pin-dialog.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/risk-meter.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/schedule-conflict-dialog.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/sleep-log-card.tsx
  - exports: (ไม่มี named export แบบ declaration ที่ตรวจพบ; ตรวจ default export/JSX/object methods ในไฟล์)
- src/components/spending-charts.tsx
  - exports: SpendingCharts, SpendingDonut
- src/components/themed-text.tsx
  - exports: ThemedTextProps, ThemedText
- src/components/themed-view.tsx
  - exports: ThemedViewProps, ThemedView
- src/components/ui/collapsible.tsx
  - exports: Collapsible
- src/components/web-badge.tsx
  - exports: WebBadge
- functions/src/adaptive-scheduling/engine.ts
  - exports: DEFAULT_ADAPTIVE_PREFERENCES, parseClockMinutes, validateMovableScheduleItem, adaptiveTimePeriod, zonedDayStart, overlappingScheduleItems, validateCandidateSlot, findAdaptiveTimeSlots, calculateSchedulingPatterns, nextBangkokDayStart
- functions/src/adaptive-scheduling/functions.ts
  - exports: applyDeterministicTemporalSemantics, fallbackAdaptiveNaturalLanguageIntent, unresolvedTemporalMention, nearestAvailableSlot, createAdaptiveSchedulingFunctions
- functions/src/adaptive-scheduling/types.ts
  - exports: ADAPTIVE_ACTIVITY_CATEGORIES, AdaptiveActivityCategory, ADAPTIVE_BEHAVIOR_EVENT_TYPES, AdaptiveBehaviorEventType, AdaptivePriority, AdaptiveTimePeriod, AdaptiveConfidenceLevel, UnavailablePeriod, PreferredPeriod, AdaptiveScoreWeights, AdaptiveThresholds, AdaptiveSchedulingPreferences, AdaptiveSchedulingPattern, EngineScheduleItem, AdaptiveSlotRequest, AdaptiveSlotScoreBreakdown, AdaptiveScoredSlot, PatternBehaviorObservation, AdaptiveScheduleValidationResult
- functions/src/adaptive-scheduling/validation.ts
  - exports: ValidatedNaturalLanguageIntent, validateGeminiNaturalLanguageIntent
- functions/src/document-ocr/iapp-document.ts
  - exports: IappDocumentExtraction, IappDocumentOcrError, normalizeIappDocumentResponse, extractDocumentWithIapp
- functions/src/health/service-probes.ts
  - exports: HealthStatus, ServiceHealth, registerSecretForRedaction, redact, probeGeminiKey, probeIappOcr, probeVision, probeGoogleCalendar, AuthProbeResult, probeFirebaseAuth, signInProviderHealth, probeFirebaseStorage, probeFirebaseHosting, probeCloudMessaging, AppCheckClientReport, appCheckHealth
- functions/src/index.ts
  - exports: addReceiptReview, analyzeScan, saveReviewedReceipt, adminListUsers, adminDashboardCounts, adminSeedDemoData, assistantTelemetry, smartLifeAssistantReply, enhanceSmartLifeRecommendations, transcribeAssistantAudio, analyzeAssistantFile, adminMonitoringData, adminRecommendationAudit, adminSetUserDisabled, adminCreatePasswordResetLink, adminRefreshSystemStatus, fanOutAnnouncement, processLineBankNotification
- functions/src/line-import.ts
  - exports: updateLineConsent, reportLineListenerStatus, enqueueLinePendingReview, confirmLineTransaction, rejectLinePendingReview, parseLineBankMessage, cleanupExpiredLinePendingReviews
- functions/src/receipt-parsers/deterministic-receipt.ts
  - exports: ScanClassification, ReceiptLineItem, ScheduleStructure, scheduleStructure, detectAccountStatement, classifyScanText, extractAnchoredReceiptTotal, ReceiptTimestampEvidence, extractReceiptTimestampEvidence, parseReceiptDeterministic
- functions/src/receipt-parsers/gemini-classifier.ts
  - exports: GeminiClassification, classifyScanWithGemini
- functions/src/receipt-parsers/gemini-document-timestamp.ts
  - exports: GeminiDocumentTimestamp, extractDocumentTimestampWithGemini
- functions/src/receipt-parsers/gemini-receipt.ts
  - exports: RECEIPT_EXTRACTION_SYSTEM_PROMPT, ReceiptCategory, ReceiptDocumentType, GeminiReceiptResult, normalizeResult, extractReceiptWithGemini
- functions/src/receipt-parsers/iapp-receipt.ts
  - exports: IappReceiptExtraction, IappReceiptError, normalizeIappReceiptResponse, extractReceiptWithIapp
- functions/src/receipt-parsers/receipt-dedupe.ts
  - exports: receiptDedupeKeys
- functions/src/receipt-parsers/receipt-timestamp-resolution.ts
  - exports: ReceiptTimestampResolution, resolveReceiptTimestamp
- functions/src/schedule-parsers/calendar-block-schedule.ts
  - exports: BlockEvidence, CalendarBlockGeometry, parseCalendarBlocks, GeminiBlockCourse, BLOCK_EXTRACTION_PROMPT, extractCalendarBlocksWithGemini, CalendarCrossCheckStats, crossCheckCalendarBlocks
- functions/src/schedule-parsers/gemini-course-exam-review.ts
  - exports: COURSE_EXAM_REVIEW_SYSTEM_PROMPT, CourseExamReviewResult, reviewScheduleCoursesAndExamsWithGemini
- functions/src/schedule-parsers/gemini-fallback.ts
  - exports: SCHEDULE_TEMPORAL_REVIEW_SYSTEM_PROMPT, ScheduleTemporalReviewResult, reviewScheduleTemporalFieldsWithGemini
- functions/src/schedule-parsers/gemini-grid-crosscheck.ts
  - exports: GeminiGridCourse, CrossCheckStats, GRID_EXTRACTION_PROMPT, extractScheduleGridWithGemini, GridField, GRID_FIELD_LABELS, normalizeGridDay, ocrEvidence, textInOcr, inOcr, crossCheckScheduleEntries
- functions/src/schedule-parsers/gemini-structured.ts
  - exports: STRUCTURED_MODELS, requestStructuredJson
- functions/src/schedule-parsers/image-pixels.ts
  - exports: ScanPixels, PixelBox, decodeScanImage, colouredBlocks, ruledLines
- functions/src/schedule-parsers/list-parser.ts
  - exports: parseListSchedule
- functions/src/schedule-parsers/openai-fallback.ts
  - exports: SCHEDULE_EXTRACTION_SYSTEM_PROMPT, extractScheduleWithOpenAI
- functions/src/schedule-parsers/schedule-layout.ts
  - exports: ScheduleOrientation, ScheduleLayoutKind, DayMark, TimeMark, ScheduleLayout, detectScheduleLayout
- functions/src/schedule-parsers/schedule-strategy.ts
  - exports: ScheduleExtraction, ScheduleStrategy, calendarBlockLayout, cellGridLayout, sidewaysCalendarLayout, gridCellsCarryFields, extractSchedule
- functions/src/schedule-parsers/types.ts
  - exports: StandardScheduleEntry, ScheduleParserInput, ScheduleParserResult, ScheduleParserStrategy
- functions/src/schedule-parsers/university-router.ts
  - exports: UniversityRouter
- functions/src/schedule-parsers/vision-course-table.ts
  - exports: courseCodeKey, buildCourseTableLookup, mergeCourseTableNames
- functions/src/schedule-parsers/vision-exam-table.ts
  - exports: ExamFields, ExamTableResult, parseOptionalExamTable, mergeExamFields
- functions/src/schedule-parsers/vision-grid-table.ts
  - exports: parseSpatialScheduleGrid
- functions/src/schedule-parsers/vision-schedule-grid.ts
  - exports: Point, Word, CodeWord, GridColumn, GridRow, ScheduleGridResult, THAI_DAYS, TIME_TOKEN, TIME_RANGE, COURSE_CODE, SECTION_LABEL, ROOM_LABEL, median, hhmm, rawWords, toWord, groupLines, joinLine, dayIndex, findCodes, parseScheduleGrid
