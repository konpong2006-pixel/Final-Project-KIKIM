# App Check + เริ่มรอบทดสอบ feedback PDF — 14 กันยายน 2569

> **ไฟล์นี้มีค่า debug token อยู่ อย่า commit ขึ้น git และอย่า push ไป repo ของเพื่อน**
> ต่อจาก `docs/CLAUDE-SMARTLIFE-HANDOFF-2026-09-14.md` ใช้เกณฑ์ระดับหลักฐาน A–E ชุดเดียวกัน

---

## 0. สรุปสั้น

แก้ปัญหา Firebase App Check บน localhost ที่ทำให้ขึ้น HTTP 403 รัวๆ และเริ่มรอบทดสอบ feedback 10 ข้อ
งาน App Check ฝั่ง **web/localhost ใช้งานได้แล้ว (ระดับ D)** ฝั่ง **Android ยังไม่ได้ทดสอบเลย (ระดับ A)**
ยังมีงานค้างที่ต้องทำเอง 3 อย่าง ดูหัวข้อ 4

---

## 1. สิ่งที่เปลี่ยนไปจริง

### 1.1 reCAPTCHA Enterprise key — เพิ่ม localhost

รันผ่าน Cloud Shell:

```
gcloud recaptcha keys update 6Ldg3IgtAAAAADaQxDF_iWcbm-ZybOd6VOSWBeh0 \
  --project=smartlife-budget \
  --web \
  --domains=smartlife-budget.web.app,smartlife-budget.firebaseapp.com,localhost
```

หมายเหตุ: flag ที่ถูกต้องคือ `--domains` ไม่ใช่ `--add-domains` และ **ต้องมี `--web` ด้วย** ไม่งั้น error
`--domains` แทนที่รายการทั้งชุด จึงต้องใส่โดเมนเดิมกลับไปด้วยทุกครั้ง

ยืนยันด้วย `gcloud recaptcha keys describe` แล้ว ได้ผล:

```yaml
webSettings:
  allowAllDomains: false
  allowedDomains:
  - smartlife-budget.web.app
  - smartlife-budget.firebaseapp.com
  - localhost
  integrationType: SCORE
```

⚠️ key ตัวนี้ใช้ร่วมกับ production การแก้จึงกระทบ production ด้วย

### 1.2 `src/lib/app-check.ts` — เพิ่ม debug token ฝั่ง web

เพิ่มฟังก์ชัน `enableWebAppCheckDebugToken()` และเรียกใน `initializeBrowserAppCheck()`
ก่อน `initializeWebAppCheck()` เพราะ Firebase SDK อ่าน global ตัวนี้ตอน initialize ครั้งแรกเท่านั้น

พฤติกรรม: ตั้ง `window.FIREBASE_APPCHECK_DEBUG_TOKEN = true` ทำให้ SDK สร้าง token สุ่มเองแล้วพิมพ์ลง console
แทนการเรียก reCAPTCHA — **ไม่มีการฝัง secret ลงในบันเดิล**

guard 2 ชั้น:
1. `__DEV__` ต้องเป็น true
2. hostname ต้องเป็น `localhost` / `127.0.0.1` / `::1`

ถ้าอยากใช้ token ตัวเดียวกันหลายเครื่อง ใส่ `EXPO_PUBLIC_FIREBASE_APP_CHECK_WEB_DEBUG_TOKEN` แทนได้
และถ้ามีคนตั้ง global ไว้เองใน console แล้ว ฟังก์ชันจะไม่ทับ

### 1.3 `.env.example` — เพิ่มคำอธิบายตัวแปรใหม่

เพิ่ม `EXPO_PUBLIC_FIREBASE_APP_CHECK_WEB_DEBUG_TOKEN=` พร้อมคอมเมนต์ ไม่บังคับต้องใส่ค่า

### 1.4 `.env.local` — **ไม่ได้แก้**

เครื่องมือ remote บล็อกการเขียนไฟล์ `.env.local` ไว้ ต้องแก้เองตามหัวข้อ 4

### 1.5 Firebase Console — ลงทะเบียน debug token 2 ตัว

| แอป | ชื่อที่ตั้ง | ค่า |
|---|---|---|
| smartlife (Web App) | `KIKIM localhost (Chrome)` | `222840a8-1fce-4079-9df5-2cc0c9dbaee9` |
| SmartLife Android | `KIM Android dev (.env.local)` | `42FAF0FC-B5DC-41F5-83B1-BBFC71151DC2` |

ตัว web ได้มาจาก console log ของแอปเอง ตัว Android กดปุ่ม Generate token ใน Firebase Console
Android มี token เก่าอยู่ก่อนแล้ว 5 ตัว แต่ Firebase ไม่แสดงค่าย้อนหลัง เลยเอามาใส่ `.env.local` ไม่ได้ จึงต้องสร้างใหม่

---

## 2. ระดับหลักฐาน

| รายการ | ระดับ | หลักฐาน |
|---|---|---|
| localhost ไม่มี 403 แล้ว | **D** | ก่อนแก้ console มี `appCheck/fetch-status-error 403` ประมาณวินาทีละครั้ง 30+ บรรทัด หลังลงทะเบียน token แล้ว reload ไม่พบเลย |
| โค้ด web debug token | **A** | อ่าน source ยืนยัน ไม่ได้ทดสอบทุกเส้นทาง |
| เรียก Cloud Function จริงผ่าน App Check | **ยังไม่ทดสอบ** | App Check ใน `ensureAppCheckReady()` เป็น lazy init จะทำงานจริงตอนเรียก protected callable เท่านั้น การที่หน้าโหลดผ่านไม่ได้พิสูจน์ข้อนี้ |
| production web ไม่ได้รับผลกระทบ | **ยังไม่ทดสอบ** | ดูหัวข้อ 4 ข้อ 2 — สำคัญที่สุด |
| Android dev build | **A** | ยังไม่ได้ใส่ token ลง `.env.local` ยังไม่เคยรัน |

---

## 3. สิ่งที่พบระหว่างทาง (ไม่ใช่งานแก้ แต่ต้องรู้)

### 3.1 localhost ต่อ Firebase production ไม่ใช่ emulator

`src/lib/firebase.ts` เปิด emulator เฉพาะเมื่อมี `EXPO_PUBLIC_FIREBASE_EMULATOR` ซึ่ง **ไม่มีใน `.env.local`**
ทุกการทดสอบที่เขียนข้อมูลบน localhost จึงลง Firestore production จริง รวมถึงอัปรูปสลิปขึ้น Firebase Storage จริง
ต้องตัดสินใจก่อนเริ่มทดสอบข้อ 2c–2f, 3, 7, 8, 9

### 3.2 ข้อ 2a ที่คิดว่าพัง — จริงๆ เทสผิดหน้า

`src/screens/native/user/scan-screen.tsx` บรรทัด 1296 และ 1299:

```js
allowsMultipleSelection: page === "smartlife_scan_finance",
selectionLimit: page === "smartlife_scan_finance" ? 10 : 1,
```

การเลือกหลายรูปเปิดเฉพาะหน้า `smartlife_scan_finance` เท่านั้น
หน้า `smartlife_scan_schedule` ตั้งใจให้เลือกทีละรูป (ตารางเรียนใบเดียว)

รอบแรกทดสอบที่ `/user/smartlife_scan_schedule` จึงเจอว่าเลือกได้ทีละรูป — **ไม่ใช่บั๊ก**
ต้องทดสอบใหม่ที่ `/user/smartlife_scan_finance` (เข้าจากหน้าการเงิน → สแกนสลิป ตาม `finance-screen.tsx` บรรทัด 28)

### 3.3 expo-image-picker บนเว็บใช้ input ปกติ

`node_modules/expo-image-picker/src/ExponentImagePicker.web.ts` สร้าง
`<input type="file" data-testid="file-input">` ใส่ใน `document.body` แล้วค่อย dispatch click
แปลว่าทดสอบแบบอัตโนมัติได้ ไม่ต้องกดผ่าน dialog ของ Windows

---

## 4. งานค้างที่ต้องทำเอง

**1. ใส่ Android debug token ลง `.env.local`** (บรรทัดที่ 21)

```
EXPO_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN=42FAF0FC-B5DC-41F5-83B1-BBFC71151DC2
```

แล้ว restart Metro — ตัวแปร `EXPO_PUBLIC_*` อ่านตอน build ไม่ hot-reload

**2. ตรวจ production ว่าไม่หลุด debug mode** ← สำคัญที่สุด

เปิด `https://smartlife-budget.web.app` → F12 → Console → **ต้องไม่มี** บรรทัด `App Check debug token:`
ถ้าเจอ แปลว่า guard `__DEV__` ไม่ทำงานในบิลด์จริง = ใครก็ bypass App Check ได้ ให้แก้ทันที

**3. ทดสอบว่าเรียก Cloud Function จริงผ่าน** — อัปสลิปใน Smart Scan ให้ OCR ทำงานจนจบ หรือคุยกับ AI Assistant

### ⚠️ ข้อควรระวังตอน build release

`EXPO_PUBLIC_*` ถูกฝังลงบันเดิลตอน build ถ้า build APK release จากเครื่องที่มี token ใน `.env.local`
token จะติดไปในไฟล์ APK ด้วย (แม้โค้ดจะไม่ใช้เพราะ release ใช้ Play Integrity) ใครแกะ APK ก็เอาไป bypass ได้
ก่อน build release ให้ล้างค่าบรรทัดนั้นออก หรือ build ผ่าน EAS ที่ใช้ env ของตัวเอง

---

## 5. ไฟล์ทดสอบที่เตรียมไว้

สลิปจริง 4 ใบ อยู่ที่ `C:\Users\konpo\Downloads\สลิป\` (เลขบัญชีถูกปิดมาจากแอปธนาคารแล้ว)

| ไฟล์ | ยอด | วันที่ | รหัสอ้างอิง |
|---|---|---|---|
| 1789130861615.jpg | 50.00 | 11 ก.ย. 19:47 | A5c1fb740c4344327 |
| 1789191716599.jpg | 133.75 | 12 ก.ย. 12:41 | Aa50904131fc94f77 |
| 1789261350808.jpg | 100.00 | 13 ก.ย. 08:02 | A4c72c4470d9e4e3a |
| 1789399049494.jpg | 750.00 | 14 ก.ย. 22:17 | A196a10503ac84fa1 |

ไฟล์ที่สร้างเพิ่ม อยู่ที่ `C:\Users\konpo\Downloads\สลิป\qa\`

| ไฟล์ | ใช้ทดสอบ | สร้างจาก |
|---|---|---|
| `qa-dup-exact.jpg` | 3a ไฟล์เดิมเป๊ะ | ก็อปสลิป ฿50 byte ต่อ byte |
| `qa-dup-reencoded.jpg` | 3b hash เปลี่ยน เนื้อหาเดิม | สลิป ฿50 ย่อ 90% บีบใหม่ |
| `qa-dup-cropped.jpg` | 3c เลขอ้างอิงเดิม คนละภาพ | สลิป ฿50 ครอบขอบออก |
| `qa-bad-notareceipt.jpg` | 2d OCR ต้องไม่ผ่าน | ภาพ noise |
| `qa-filler-01..08.jpg` | 2a, 2b เติมคิวให้ครบ/เกิน 10 | ใบเสร็จจำลอง ยอด/วันที่/ref ไม่ซ้ำ |

**ทดสอบไม่ได้ด้วยของที่มี:**
- **3d** สลิปคนละใบ ยอดเท่ากัน วันเดียวกัน — สลิปทั้ง 4 ใบต่างกันหมด ต้องโอนจริงเพิ่ม 2 ครั้งยอดเท่ากันในวันเดียว
- **7a** เคส Cloud Prepay ฿200 จาก feedback — ไม่มีใบนี้ สลิปที่มีเป็นโอนบุคคลทั้งหมด ไม่มีร้านค้า
- **3e, 3f** ต้องใช้ emulator และบัญชีที่สอง

---

## 6. สถานะรอบทดสอบ feedback

ข้ามข้อ 1 (เพื่อนแก้แล้ว) ข้อ 10 ในไฟล์ว่างเปล่าไม่มีรายละเอียด ต้องกลับไปถามผู้ให้ feedback
เหลือข้อ 2–9 รวม 41 รายการทดสอบ **ยังไม่ผ่านสักข้อ** — 2a ที่ลองไปเป็นการทดสอบผิดหน้าตามหัวข้อ 3.2

เช็กลิสต์แบบติ๊กได้อยู่ใน artifact บน claude.ai (ดูใน gallery ที่ claude.ai/code/artifacts ชื่อ "เช็กลิสต์ทดสอบ SmartLife")

---

## 7. สิ่งที่ยังไม่ได้ทำ และห้ามเหมาว่าทำแล้ว

- ไม่ได้ push ไม่ได้ commit ไม่ได้แตะ git state ใดๆ
- ไม่ได้ deploy hosting / functions / rules
- ไม่ได้แตะ Widget
- ไม่ได้แก้โค้ดส่วนอื่นนอกจาก `src/lib/app-check.ts` และ `.env.example`
- ไม่ได้ทดสอบ production, APK, native push, OCR provider จริง
