import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {bangkokGreeting, financeDate, futureSuggestion} from '../src/lib/ux-time.ts';

// Exercise the real deterministic engine; stub only network/auth boundaries.
const stubs = {
  '@/services/firestore': 'export const activities={},notes={},schedules={};',
  'firebase/functions': 'export const getFunctions=()=>({}),httpsCallable=()=>async()=>({data:{items:[]}});',
  '@/lib/app-check': 'export const ensureAppCheckReady=async()=>{};',
  '@/lib/firebase': 'export const auth={},firebaseApp={};',
  '@/lib/demo-mode': 'export const isDemoMode=true;',
  '@/services/assistant-auth-retry': 'export const withAssistantAuthRetry=fn=>fn();',
};
const bundle = await build({entryPoints:['src/services/smartlife-recommendations.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'offline-fixtures',setup(b){
  b.onResolve({filter:/.*/},args=>args.path in stubs ? {path:args.path,namespace:'stub'} : undefined);
  b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
}}]});
const engine = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const now = new Date('2026-09-14T13:14:00+07:00');
const task = {id:'exam',title:'สอบคณิตศาสตร์',type:'task',status:'pending',priority:'high',startAt:'2026-09-15T18:00:00+07:00',endAt:'2026-09-15T19:00:00+07:00'};
const busy = [{id:'class',title:'เรียน',startAt:'2026-09-14T08:00:00+07:00',endAt:'2026-09-14T12:00:00+07:00'}];
const result = engine.buildGroundedAcademicSuggestionsFromData(busy,[task],now);
assert.equal(result.length,1);
assert.equal(result[0].startAt,'2026-09-14T06:15:00.000Z');
assert.ok(futureSuggestion(result[0],now.getTime()));
assert.ok(new Date(result[0].endAt)-new Date(result[0].startAt)>=35*60000);
const blocked = [...busy,{id:'busy',title:'งาน',startAt:'2026-09-14T13:30:00+07:00',endAt:'2026-09-14T22:00:00+07:00'}];
const tomorrow = engine.buildGroundedAcademicSuggestionsFromData(blocked,[task],now);
assert.equal(tomorrow[0].startAt,'2026-09-15T01:00:00.000Z');
for(const suggestion of engine.buildActivitySuggestionsFromData(busy,[task],now)) assert.ok(futureSuggestion(suggestion,now.getTime()));
assert.equal(futureSuggestion(result[0],Date.parse(result[0].startAt)),false);
assert.equal(futureSuggestion({startAt:'invalid',endAt:'invalid'},now.getTime()),false);
assert.equal(bangkokGreeting(now),'สวัสดีตอนบ่าย');
for(const [time,greeting] of [['04:59','สวัสดียามดึก'],['05:00','สวัสดีตอนเช้า'],['11:59','สวัสดีตอนเช้า'],['12:00','สวัสดีตอนบ่าย'],['17:00','สวัสดีตอนเย็น']]) assert.equal(bangkokGreeting(new Date(`2026-09-14T${time}:00+07:00`)),greeting);
for(const value of ['2026-02-30','invalid',['2026-09-14'],undefined]) assert.equal(financeDate(value,now),now);
assert.equal(financeDate('2028-02-29').toISOString(),'2028-02-29T05:00:00.000Z');
const finance = readFileSync('src/screens/native/user/finance-screen.tsx','utf8');
assert.match(finance,/useLocalSearchParams/);
assert.match(finance,/period: nextPeriod, date: thailandDateKey\(nextDate\), filter: nextFilter/);
const activityForm = readFileSync('src/screens/native/user/activity-form-screen.tsx','utf8');
assert.match(activityForm,/คำแนะนำหมดอายุระหว่างยืนยัน/);
const review = readFileSync('src/screens/native/user/line-import-screen.tsx','utf8');
assert.ok(!review.includes("confirmLineTransaction(draft, 'line_auto_listener'"),'bank review preserves its real source');
assert.match(review,/confirmLineTransaction\(draft, item.source/);
assert.match(review,/อ่านข้อมูลมั่นใจสูง/);
assert.ok(!review.includes('ไม่บันทึกเป็นธุรกรรมจนกว่าคุณจะยืนยัน'));
for(const file of ['push-notifications','deadline-notifications','line-import-service']) {
  const code = readFileSync(`src/services/${file}.ts`,'utf8');
  assert.ok(!/import \* as Notifications from/.test(code),'no native push auto-registration import on web');
  assert.ok(code.indexOf("import {Platform}")<code.indexOf('const Notifications'));
}
// Runtime platform guard: native module must not execute on web, but still loads on Android.
for (const platform of ['web','android']) {
  globalThis.__uxPushLoaded = false;
  const pushStubs = {
    'react-native': `export const Platform={OS:${JSON.stringify(platform)}};`,
    'expo-device': 'export const isDevice=false;',
    'expo-notifications': 'globalThis.__uxPushLoaded=true; export const setNotificationHandler=()=>{}; export const getAllScheduledNotificationsAsync=async()=>[];',
    '@/services/adaptive-scheduling': 'export const adaptiveScheduling={};',
  };
  const compiled = await build({entryPoints:['src/services/push-notifications.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'platform-fixture',setup(b){
    b.onResolve({filter:/.*/},args=>args.path in pushStubs ? {path:args.path,namespace:'stub'} : undefined);
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:pushStubs[args.path],loader:'js'}));
  }}],logLevel:'silent'});
  const push = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  assert.equal(globalThis.__uxPushLoaded,platform==='android');
  assert.equal(await push.cancelAllTaskReminders(),0);
  assert.equal((await push.registerAdaptivePushNotifications()).registered,false);
}
delete globalThis.__uxPushLoaded;
console.log('UX regression passed: 13:14 future-only recommendations, insufficient gap, Bangkok greeting, URL dates, expiry. No network writes.');
