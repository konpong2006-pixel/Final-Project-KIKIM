# คู่มือติดตั้ง SmartLife สำหรับเพื่อน

คู่มือนี้ใช้สำหรับเชื่อมเครื่องของเพื่อนเข้ากับ Firebase project `smartlife-budget`
และ backend ชุดเดียวกับทีม ไม่ต้องสร้าง Firebase project ใหม่ และไม่ต้องขอ Gemini,
iApp OCR หรือ Google Cloud Vision API key แยก เพราะ API เหล่านี้ทำงานผ่าน Cloud Functions
และ Secret Manager ที่ deploy ไว้แล้ว

## สิ่งที่เจ้าของโปรเจกต์ต้องทำครั้งเดียว

เพิ่มอีเมล Google ของเพื่อนเป็นสมาชิกใน Firebase/Google Cloud project
`smartlife-budget` ด้วยสิทธิ์ที่อนุญาตให้ลงทะเบียน Firebase App Check debug token
ห้ามส่ง service-account JSON, Gemini key, iApp key หรือไฟล์ `.env.local` ให้กันทางแชต

## ติดตั้งด้วยคำสั่งเดียวบน Windows

เครื่องเพื่อนต้องมี Git, Android Studio พร้อม Android SDK และเปิด Emulator
หรือเชื่อมโทรศัพท์ Android ที่เปิด USB debugging ไว้ จากนั้นเปิด **CMD** แล้วรัน:

```cmd
git clone https://github.com/natgamol/Final-Project.git && cd Final-Project && setup-smartlife.cmd -RunAndroid
```

ตัวติดตั้งจะทำงานต่อไปนี้ให้อัตโนมัติ:

- ติดตั้ง Node.js LTS หากยังไม่มี (ผ่าน `winget`)
- ติดตั้ง package ของแอปและ Cloud Functions
- สร้าง `.env.local` จาก Firebase client configuration ของทีม
- สร้าง `google-services.json` สำหรับแอป Android
- เปิดหน้าเข้าสู่ระบบ Firebase เมื่อจำเป็น
- ลงทะเบียน App Check token เฉพาะเครื่องและเก็บไว้ในไฟล์ที่ Git ไม่ติดตาม
- ตรวจค่าระบบและสร้าง Development Build บน Android

เมื่อมีหน้าต่าง Firebase เปิดขึ้น ให้เพื่อนล็อกอินด้วยอีเมลที่เจ้าของโปรเจกต์เพิ่มไว้
จากนั้นตัวติดตั้งจะทำงานต่อเอง

## ถ้าต้องการติดตั้งก่อน แต่ยังไม่เปิด Android

```cmd
git clone https://github.com/natgamol/Final-Project.git && cd Final-Project && setup-smartlife.cmd
```

เมื่อติดตั้งเสร็จแล้ว เปิด Emulator/ต่อโทรศัพท์ และรัน:

```cmd
npm run android
```

ถ้ามี SmartLife Development Build ติดตั้งอยู่แล้ว สามารถเปิด Metro ด้วย:

```cmd
npm start
```

## อัปเดตงานล่าสุดในครั้งถัดไป

เปิด CMD ในโฟลเดอร์ `Final-Project` แล้วรัน:

```cmd
git pull origin main && setup-smartlife.cmd
```

จากนั้นรัน `npm start` หรือ `npm run android` ตามต้องการ

## API และ Firebase ทำงานอย่างไร

- Firebase client ID ใน `.env.example` และ `config/google-services.team.json`
  เป็นค่าระบุตัวแอปฝั่ง client ไม่ใช่ server secret
- Gemini, iApp OCR และ API ฝั่ง server อยู่ใน Firebase Secret Manager
  โทรศัพท์ของเพื่อนเรียกผ่าน Cloud Functions จึงไม่ต้องมี key เหล่านี้ในเครื่อง
- Firestore, Authentication, Storage, rules, indexes และ functions ใช้ backend
  `smartlife-budget` ชุดเดียวกัน
- App Check debug token เป็นคนละค่าต่อเครื่อง ตัวติดตั้งจะสร้างให้และจะนำค่าเดิมกลับมาใช้
  เมื่อรันตัวติดตั้งซ้ำ

## ข้อจำกัดที่ทำอัตโนมัติแทนไม่ได้

1. เจ้าของ project ต้องเพิ่มบัญชี Google ของเพื่อนก่อน เพราะ GitHub ไม่สามารถมอบสิทธิ์
   Firebase ให้บุคคลอื่นได้เอง
2. Google Sign-In บน Android ตรวจ package name และ SHA-1 ของไฟล์ที่เซ็นแอป
   หาก build จากเครื่องใหม่แล้ว Google Login ไม่ผ่าน ให้ใช้ Development Build ของทีม
   หรือให้ผู้ดูแลเพิ่ม SHA-1 ของเครื่องนั้นใน Android OAuth client
3. ห้าม commit `.env.local`, App Check token, service-account JSON, signing key
   หรือ API secret ขึ้น GitHub

## ตรวจสอบเมื่อพบปัญหา

```cmd
npm run doctor
npm run typecheck
npm run lint
```

หากขึ้นว่าไม่มีสิทธิ์ ให้ตรวจว่า Firebase CLI ล็อกอินด้วยอีเมลที่ถูกเพิ่มใน
`smartlife-budget` แล้ว หาก Android หาอุปกรณ์ไม่พบ ให้เปิด Emulator หรือเชื่อมโทรศัพท์
ก่อนรัน `npm run android` อีกครั้ง
