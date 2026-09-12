/**
 * Browser entry for the screenshot harness. It mounts the REAL SleepLogCard and
 * RiskMeter -- not copies -- so what Playwright photographs is the component
 * that ships. Only the Firestore/AsyncStorage layer underneath is swapped for
 * an in-memory fake (see `fake-sleep-store.ts`), which is what lets the three
 * sleep states be reached by actually clicking the buttons.
 */
import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Text, View} from 'react-native';

import RiskMeter from '@/components/risk-meter';
import SleepLogCard from '@/components/sleep-log-card';
import {calculateBurnoutDynamicInsight} from '@/services/dynamic-insights';
import {burnoutRiskBand} from '@/constants/burnout-risk';
import {__seedStaleNight, __resetStore} from './fake-sleep-store';

const UID = 'screenshot-user';

function Panel({children, id, title}: {children: React.ReactNode; id: string; title: string}) {
  return <View nativeID={id} style={{backgroundColor: '#f6f8f3', borderRadius: 16, marginBottom: 18, padding: 16, width: 380}}>
    <Text style={{color: '#2c341b', fontFamily: 'system-ui', fontSize: 12, fontWeight: '700', marginBottom: 10}}>{title}</Text>
    {children}
  </View>;
}

/** Mirrors the real burnout panel's layout so the meter is shot in context. */
function BurnoutPanel({score}: {score: number}) {
  const level = score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low';
  const band = burnoutRiskBand(level);
  return <View style={{alignItems: 'flex-start', backgroundColor: '#f0f1dc', borderColor: '#d9dcad', borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 13}}>
    <View style={{alignItems: 'center', backgroundColor: '#e8e9cc', borderRadius: 13, height: 34, justifyContent: 'center', width: 34}}>
      <Text style={{fontSize: 16}}>⚠️</Text>
    </View>
    <View style={{flex: 1}}>
      <Text style={{color: '#35402d', fontFamily: 'system-ui', fontSize: 11, fontWeight: '700'}}>ความเสี่ยงสภาวะหมดไฟ: {band.label}</Text>
      <Text style={{color: '#727560', fontFamily: 'system-ui', fontSize: 10, lineHeight: 15, marginTop: 2}}>
        คะแนน {score}/100 · เรียน/งาน 9 ชม. · งานค้าง 3 · นอนจริงเฉลี่ย 8 ชม. จาก 1 คืนที่บันทึก
      </Text>
      <RiskMeter level={level} score={score} />
    </View>
  </View>;
}

function App() {
  const [ready, setReady] = useState(false);
  const [scores, setScores] = useState<number[]>([]);
  // Remounting the card re-runs its loader. A page reload would also do that,
  // but it would wipe the in-memory store the harness just seeded.
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    Object.assign(window as object, {__remount: () => setNonce((value) => value + 1)});
  }, []);

  useEffect(() => {
    // Real scores from the real model, so the meters below are not hand-picked
    // numbers but what the scorer actually produces.
    const now = new Date('2026-08-19T12:00:00+07:00');
    const ts = (value: string) => ({toDate: () => new Date(value), toMillis: () => new Date(value).getTime()});
    const schedule = (title: string, start: string, end: string) => ({
      color: '#fff', courseCode: '', createdAt: ts(start), endAt: ts(end), id: `${title}-${start}`,
      location: '', ownerId: 'u1', source: 'manual', startAt: ts(start), title, updatedAt: ts(start),
    }) as never;
    const activity = (title: string, start: string, end: string, extra: object = {}) => ({
      color: '#fff', createdAt: ts(start), endAt: ts(end), id: `${title}-${start}`, location: '',
      ownerId: 'u1', source: 'manual', startAt: ts(start), status: 'planned', title,
      type: 'activity', updatedAt: ts(start), ...extra,
    }) as never;
    const week = [
      schedule('จ', '2026-08-17T08:00:00+07:00', '2026-08-17T15:00:00+07:00'),
      schedule('อ', '2026-08-18T08:00:00+07:00', '2026-08-18T15:00:00+07:00'),
      schedule('พ', '2026-08-19T08:00:00+07:00', '2026-08-19T15:00:00+07:00'),
    ];
    const tasks = [0, 1, 2, 3].map((index) => activity(
      `งาน ${index}`, `2026-08-2${index}T09:00:00+07:00`, `2026-08-2${index}T10:00:00+07:00`, {type: 'task'},
    ));
    const shortNights = [
      activity('นอน', '2026-08-18T01:30:00+07:00', '2026-08-18T06:30:00+07:00'),
      activity('นอน', '2026-08-19T02:00:00+07:00', '2026-08-19T07:00:00+07:00'),
    ];
    // A genuinely low but non-zero day, so the green fill is visible rather
    // than an empty track (score 0 renders no bar at all, by design).
    const lightDay = schedule('สั้น', '2026-08-19T09:00:00+07:00', '2026-08-19T12:00:00+07:00');
    const low = calculateBurnoutDynamicInsight({activities: [], now, pendingTasks: tasks, schedules: [lightDay], weekActivities: [], weekSchedules: [lightDay]});
    const medium = calculateBurnoutDynamicInsight({activities: [], now, pendingTasks: tasks, schedules: [week[2]], weekActivities: [], weekSchedules: [week[2]]});
    const high = calculateBurnoutDynamicInsight({activities: [], now, pendingTasks: tasks, schedules: [week[2]], weekActivities: shortNights, weekSchedules: week});
    setScores([low.score, medium.score, high.score]);
    (window as unknown as {__scores: number[]}).__scores = [low.score, medium.score, high.score];
    setReady(true);
  }, []);

  if (!ready) return <Text>loading</Text>;

  return <View style={{backgroundColor: '#fff', flexDirection: 'row', gap: 20, padding: 20}}>
    <View>
      <Panel id="panel-sleep" title="Sleep log card (drive with the buttons)">
        <SleepLogCard key={nonce} uid={UID} variant="full" />
      </Panel>
    </View>
    <View>
      {scores.map((score, index) => <Panel
        id={`panel-meter-${['low', 'medium', 'high'][index]}`}
        key={score}
        title={`Risk meter — ${['low', 'medium', 'high'][index]} (real model score ${score})`}
      >
        <BurnoutPanel score={score} />
      </Panel>)}
    </View>
  </View>;
}

// Hooks Playwright uses to put the store into a given state between shots.
Object.assign(window as object, {
  __resetStore,
  __seedStaleNight,
});

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
