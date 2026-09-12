import assert from 'node:assert/strict';

import {withAssistantAuthRetry} from '../src/services/assistant-auth-retry.ts';
import {
  assistantConversationHistoryKey,
  assistantConversationStateKey,
  createAssistantConversationState,
  updateAssistantConversationState,
} from '../src/services/assistant-conversation.ts';
import {assistantActionErrorMessage, classifyAssistantError} from '../src/services/assistant-error.ts';
import {sanitizeAssistantMessages} from '../src/services/assistant-message-sanitizer.ts';
import {
  deterministicFinancialScenarioAnswer,
  shouldUseDeterministicFinancialScenario,
  updateFinancialScenario,
} from '../src/services/assistant-financial-scenario.ts';
import {classifyAssistantIntent} from '../src/services/assistant-intent.ts';
import {rankAssistantTasks} from '../src/services/assistant-task-ranking.ts';
import {
  isReceiptImageLookupRequest,
  selfContainedAssistantFallback,
} from '../src/services/assistant-safe-fallback.ts';

const results = [];
function check(name, run) {
  run();
  results.push(name);
}

check('permission errors are not reported as expired sessions', () => {
  assert.equal(classifyAssistantError({code: 'firestore/permission-denied'}), 'permission');
  assert.equal(classifyAssistantError({code: 'functions/unauthenticated'}), 'authentication');
  assert.equal(classifyAssistantError({code: 'functions/unavailable'}), 'network');
  assert.equal(classifyAssistantError({
    code: 'functions/unavailable',
    details: {reason: 'gemini-model', status: 404},
  }), 'gemini');
  assert.equal(classifyAssistantError({
    code: 'functions/unavailable',
    details: {reason: 'gemini-service'},
  }), 'gemini');
  assert.equal(classifyAssistantError({code: 'functions/internal'}), 'server');
  assert.equal(classifyAssistantError({code: 'functions/unauthenticated', message: 'Firebase App Check token is missing'}), 'app_check');
});

check('action confirmation shows a safe, useful scheduling reason', () => {
  assert.equal(
    assistantActionErrorMessage({
      code: 'functions/failed-precondition',
      message: 'ช่วงเวลานี้ชนกับรายการในตาราง กรุณาวิเคราะห์และยืนยันเวลาใหม่',
    }),
    'ช่วงเวลานี้ชนกับรายการในตาราง กรุณาวิเคราะห์และยืนยันเวลาใหม่',
  );
  assert.equal(
    assistantActionErrorMessage({code: 'functions/unavailable'}),
    'ตอนนี้เชื่อมต่อบริการไม่สำเร็จครับ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง',
  );
});

check('stale build support replies and consecutive duplicate assistant replies are hidden', () => {
  const timestamp = '2026-08-16T10:00:00.000Z';
  const cleaned = sanitizeAssistantMessages([
    {content: 'แสดงข้อมูล OCR ที่บันทึกไว้ช่วงล่าสุด', id: 'u1', role: 'user', timestamp},
    {content: 'พบใบเสร็จล่าสุด ยอด 14 บาท', id: 'a1', role: 'assistant', timestamp},
    {content: 'พบใบเสร็จล่าสุด ยอด 14 บาท', id: 'a2', role: 'assistant', timestamp},
    {content: 'แอปที่เปิดอยู่ยังไม่พบระบบรับเสียง ให้ติดตั้ง app-debug.apk ล่าสุดแล้วเปิดผ่าน start-smartlife-mumu.cmd', id: 'a3', role: 'assistant', timestamp},
    {content: 'ระบบยืนยันตัวตนกับบริการ AI ไม่สำเร็จชั่วคราวครับ ลองอีกครั้ง', id: 'a4', role: 'assistant', timestamp},
    {content: 'อัปโหลดหรือวิเคราะห์ไฟล์ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่', id: 'a5', role: 'assistant', timestamp},
  ]);
  assert.deepEqual(cleaned.map((message) => message.id), ['u1', 'a1']);
});

check('pending-task completion shortcuts survive chat-history sanitization', () => {
  const cleaned = sanitizeAssistantMessages([{
    content: 'ยังมีงานค้าง 1 งานครับ',
    id: 'pending-task-answer',
    pendingTaskShortcuts: [{
      dueAt: '2026-09-04T10:00:00.000Z',
      id: 'activity-1',
      status: 'pending',
      title: 'ส่งรายงาน',
    }],
    role: 'assistant',
    timestamp: '2026-09-03T10:00:00.000Z',
  }]);
  assert.deepEqual(cleaned[0]?.pendingTaskShortcuts, [{
    dueAt: '2026-09-04T10:00:00.000Z',
    id: 'activity-1',
    status: 'pending',
    title: 'ส่งรายงาน',
  }]);
});

check('budget allocation uses current-message values deterministically', () => {
  const message = 'งบ 1,000 บาท/5 วัน: ออม 200 บาท เหลืออาหาร 800 บาท หรือวันละ 160 บาท พร้อมแบ่งมื้อ';
  const scenario = updateFinancialScenario(message);
  assert.deepEqual(scenario, {
    dailyBudget: 160,
    days: 5,
    foodBudget: 800,
    mealCount: 3,
    savingsAmount: 200,
    startingAmount: 1000,
    type: 'budget',
  });
  const answer = deterministicFinancialScenarioAnswer(scenario, message);
  for (const expected of ['1,000', '200', '800', '5 วัน', '160', 'เช้า 40', 'กลางวัน 60', 'เย็น 60']) {
    assert.match(answer, new RegExp(expected.replace(',', ',')));
  }
  assert.doesNotMatch(answer, /ฐานข้อมูล(?:เป็น|อยู่ที่|\s*)0 บาท|ยอด(?:คงเหลือ)?\s*0 บาท/);
});

check('savings target uses scenario values and exact gap', () => {
  const message = 'เป้าหมาย 1,000 → 3,000 บาท: ใช้ยอดจากคำถาม ไม่ใช่ยอดฐานข้อมูล 0 บาท';
  const scenario = updateFinancialScenario(message);
  assert.equal(scenario?.startingAmount, 1000);
  assert.equal(scenario?.targetAmount, 3000);
  const answer = deterministicFinancialScenarioAnswer(scenario, message);
  assert.match(answer, /2,000/);
  assert.match(answer, /ระยะเวลา/);
  assert.doesNotMatch(answer, /ตอนนี้(?:มี|คงเหลือ)?\s*0 บาท/);
});

check('real task ranking keeps overdue work and selects Data Structures', () => {
  const now = new Date('2026-08-02T08:00:00+07:00');
  const ranked = rankAssistantTasks([
    {dueAt: new Date('2026-08-05T18:00:00+07:00'), status: 'planned', title: 'Project report'},
    {dueAt: new Date('2026-08-03T09:00:00+07:00'), priority: 'high', status: 'planned', title: 'Data Structures'},
    {dueAt: new Date('2026-08-02T09:00:00+07:00'), status: 'completed', title: 'Completed urgent task'},
  ], now);
  assert.equal(ranked[0]?.title, 'Data Structures');
  assert.equal(ranked.some((task) => task.title === 'Completed urgent task'), false);
});

check('follow-up reuses structured budget state', () => {
  const first = updateFinancialScenario('ผมมีงบอาหาร 800 บาทสำหรับ 5 วัน');
  assert.equal(first?.foodBudget, 800);
  assert.equal(first?.days, 5);
  const followUp = updateFinancialScenario('แบ่งเป็นสามมื้อให้หน่อย', first);
  const answer = deterministicFinancialScenarioAnswer(followUp, 'แบ่งเป็นสามมื้อให้หน่อย');
  assert.match(answer, /วันละ 160/);
  assert.match(answer, /เช้า 40/);
  assert.match(answer, /กลางวัน 60/);
  assert.match(answer, /เย็น 60/);
});

await (async () => {
  let attempts = 0;
  let refreshes = 0;
  const response = await withAssistantAuthRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) throw {code: 'functions/unauthenticated'};
      return 'recovered';
    },
    {
      expectedUid: 'user-a',
      getCurrentUid: () => 'user-a',
      refreshToken: async () => { refreshes += 1; },
    },
  );
  assert.equal(response, 'recovered');
  assert.equal(attempts, 2);
  assert.equal(refreshes, 1);
  results.push('expired token refreshes and retries exactly once');
})();

await (async () => {
  let refreshes = 0;
  await assert.rejects(() => withAssistantAuthRetry(
    async () => { throw {code: 'functions/unauthenticated'}; },
    {
      expectedUid: 'user-a',
      getCurrentUid: () => undefined,
      refreshToken: async () => { refreshes += 1; },
    },
  ));
  assert.equal(refreshes, 0);
  const hypothetical = updateFinancialScenario('งบอาหาร 600 บาท ใช้ 3 วัน แบ่งสามมื้อ');
  assert.match(deterministicFinancialScenarioAnswer(hypothetical, 'แบ่งสามมื้อ'), /วันละ 200/);
  results.push('signed-out private requests do not retry while safe scenarios remain calculable');
})();

check('conversation state is isolated by uid and conversation id', () => {
  assert.notEqual(
    assistantConversationHistoryKey('user-a', 'conversation-1'),
    assistantConversationHistoryKey('user-b', 'conversation-1'),
  );
  assert.notEqual(
    assistantConversationStateKey('user-a', 'conversation-1'),
    assistantConversationStateKey('user-a', 'conversation-2'),
  );
  const state = updateAssistantConversationState(
    createAssistantConversationState('conversation-1'),
    'แล้วพรุ่งนี้ล่ะ',
    'schedule',
  );
  assert.equal(state.dateReference, 'tomorrow');
  assert.equal(createAssistantConversationState('conversation-2').financialScenario, undefined);
});

check('changing the saving amount recalculates every dependent value', () => {
  const first = updateFinancialScenario('มีเงิน 1,000 บาท ต้องใช้ 5 วัน และอยากออม 200 บาท');
  const revised = updateFinancialScenario('เปลี่ยนใจ ขอออม 300 บาทแทน แล้วคำนวณใหม่', first);
  assert.equal(revised?.startingAmount, 1000);
  assert.equal(revised?.savingsAmount, 300);
  assert.equal(revised?.foodBudget, 700);
  assert.equal(revised?.dailyBudget, 140);
  const answer = deterministicFinancialScenarioAnswer(revised, 'เปลี่ยนใจ ขอออม 300 บาทแทน แล้วคำนวณใหม่');
  assert.match(answer, /700/);
  assert.match(answer, /140/);
  assert.doesNotMatch(answer, /800|160/);
});

check('a target duration reuses the savings goal and computes a monthly amount', () => {
  const goal = updateFinancialScenario('ตอนนี้มี 1,000 บาท อยากเก็บให้ถึง 3,000 บาท');
  assert.equal(goal?.type, 'savings_goal');
  const timed = updateFinancialScenario('อยากให้ถึงเป้าหมายภายใน 4 เดือน', goal);
  assert.equal(timed?.months, 4);
  assert.match(deterministicFinancialScenarioAnswer(timed, 'อยากให้ถึงเป้าหมายภายใน 4 เดือน'), /เดือนละ 500/);
});

check('a new 350-baht scenario replaces an older 2000-baht scenario', () => {
  const old = updateFinancialScenario('มีเงิน 2,000 บาท ต้องใช้ 5 วัน');
  const current = updateFinancialScenario('มีเงินเหลือ 350 บาท แต่ต้องใช้ถึงอีก 7 วัน ควรจัดการอย่างไร', old);
  assert.equal(current?.startingAmount, 350);
  assert.equal(current?.days, 7);
  assert.equal(current?.dailyBudget, 50);
  const answer = deterministicFinancialScenarioAnswer(current, 'มีเงินเหลือ 350 บาท แต่ต้องใช้ถึงอีก 7 วัน ควรจัดการอย่างไร');
  assert.match(answer, /350/);
  assert.match(answer, /วันละ 50/);
  assert.doesNotMatch(answer, /2,000|400/);
});

check('English budget input replaces Thai state and answers in English', () => {
  const old = updateFinancialScenario('มีเงิน 2,000 บาท ต้องใช้ 5 วัน');
  const current = updateFinancialScenario('I have 1,200 baht for six days and want to save 300 baht. Create a realistic daily food budget.', old);
  assert.equal(current?.startingAmount, 1200);
  assert.equal(current?.savingsAmount, 300);
  assert.equal(current?.foodBudget, 900);
  assert.equal(current?.days, 6);
  assert.equal(current?.dailyBudget, 150);
  const answer = deterministicFinancialScenarioAnswer(current, 'I have 1,200 baht for six days and want to save 300 baht. Create a realistic daily food budget.');
  assert.match(answer, /1,200 baht/i);
  assert.match(answer, /900 baht/i);
  assert.match(answer, /150 baht per day/i);
  assert.doesNotMatch(answer, /2,000|400/);
});

check('old finance state cannot hijack unrelated or cross-domain turns', () => {
  const old = updateFinancialScenario('มีเงิน 2,000 บาท ต้องใช้ 5 วัน');
  const unrelated = [
    'ฉันมีสอบอีก 5 วัน แต่ยังอ่านไม่เริ่มเลย ช่วยวางตารางอ่านที่ทำได้จริงให้หน่อย',
    'ช่วยดูทั้งตารางเรียน งานที่ใกล้ส่ง และงบที่เหลือ แล้ววางแผนพรุ่งนี้ให้ฉัน',
    'ดูสลิปล่าสุดของฉัน แล้วบอกวันที่ เวลา จำนวนเงิน และร้านค้า',
    'ไม่ต้องดูข้อมูลในแอป ช่วยแนะนำเทคนิคอ่านหนังสือก่อนสอบแบบทั่วไปให้หน่อย',
    'มีวิธีออมเงินสำหรับนักศึกษาอย่างไรบ้าง',
  ];
  unrelated.forEach((message) => {
    assert.equal(shouldUseDeterministicFinancialScenario(message, old), false, message);
  });
  assert.equal(shouldUseDeterministicFinancialScenario('แบ่งค่าอาหารเป็นสามมื้อให้หน่อย', old), true);
  assert.equal(classifyAssistantIntent('ดูสลิปล่าสุดและบอกจำนวนเงิน', 'finance'), 'finance');
});

check('safe fallback answers self-contained study requests without app data', () => {
  const plan = selfContainedAssistantFallback('ฉันมีสอบอีก 5 วัน แต่ยังอ่านไม่เริ่มเลย ช่วยวางตารางอ่านที่ทำได้จริงให้หน่อย');
  assert.match(plan, /วันที่ 1/);
  assert.match(plan, /วันที่ 5/);
  assert.doesNotMatch(plan, /ไม่พบ.*สอบ|App Check/);

  const techniques = selfContainedAssistantFallback('ไม่ต้องดูข้อมูลในแอป ช่วยแนะนำเทคนิคอ่านหนังสือก่อนสอบแบบทั่วไปให้หน่อย');
  assert.match(techniques, /Active Recall/);
  assert.match(techniques, /Spaced Repetition/);
  assert.doesNotMatch(techniques, /ไม่พบตารางสอบ/);
});

check('receipt lookup is routed to recent OCR context instead of a static refusal', () => {
  const message = 'ดูสลิปล่าสุดของฉัน แล้วบอกวันที่ เวลา จำนวนเงิน และร้านค้า ถ้าไม่มั่นใจตรงไหนให้บอกด้วย';
  assert.equal(isReceiptImageLookupRequest(message), true);
  const answer = selfContainedAssistantFallback(message);
  assert.equal(answer, '');
});

console.log(`SmartLife runtime regression tests: ${results.length}/${results.length}`);
results.forEach((name) => console.log(`- ${name}`));
