import {Pressable, StyleSheet, Text, View} from 'react-native';

import {useInstitution} from '@/providers/institution-provider';
import type {InstitutionType} from '@/types/institution';
import {Card, MaterialIcon, PrimaryButton, UserHeader, UserShell, type UserNavigate, userStyles as styles} from './user-ui';
import {showToast} from '@/components/app-toast';

const OPTIONS: {description: string; icon: string; label: string; value: InstitutionType}[] = [
  {description: 'ตารางรายวิชาและภาคเรียนประมาณ 16 สัปดาห์', icon: 'school', label: 'มหาวิทยาลัย', value: 'university'},
  {description: 'ตารางแบบคาบเรียน ภาคเรียนที่ 1 และ 2', icon: 'local_library', label: 'มัธยมศึกษา', value: 'high-school'},
];

function InstitutionTypeSelector({onChange, value}: {onChange: (value: InstitutionType) => void; value: InstitutionType | null}) {
  return <View accessibilityLabel="เลือกประเภทสถานศึกษา" accessibilityRole="radiogroup" style={localStyles.optionList}>
    {OPTIONS.map((option) => {
      const selected = value === option.value;
      return <Pressable
        accessibilityLabel={option.label}
        accessibilityRole="radio"
        accessibilityState={{checked: selected}}
        key={option.value}
        onPress={() => onChange(option.value)}
        style={({pressed}) => [localStyles.option, selected && localStyles.optionSelected, pressed && localStyles.pressed]}
      >
        <View style={[localStyles.icon, selected && localStyles.iconSelected]}><MaterialIcon color={selected ? '#fff' : '#668d65'} name={option.icon} size={24} /></View>
        <View style={localStyles.optionCopy}><Text style={localStyles.optionTitle}>{option.label}</Text><Text style={localStyles.optionDescription}>{option.description}</Text></View>
        <View style={[localStyles.radio, selected && localStyles.radioSelected]}>{selected ? <View style={localStyles.radioDot} /> : null}</View>
      </Pressable>;
    })}
  </View>;
}

export default function OnboardingScreen({page, onNavigate}: {page: string; onNavigate: UserNavigate}) {
  const {institutionType, setInstitutionType} = useInstitution();
  const step = page.includes('step_3') ? 3 : page.includes('step_2') ? 2 : 1;
  const content = step === 1
    ? ['เริ่มจัดชีวิตการเรียน', 'เลือกประเภทสถานศึกษาเพื่อให้ SmartLife ตั้งภาคเรียนและอ่านตารางได้เหมาะสม']
    : step === 2
      ? ['นำเข้าตารางได้อย่างรวดเร็ว', 'ถ่ายรูปตารางเรียนหรือเชื่อม Google Calendar เพื่อเริ่มต้น']
      : ['พร้อมใช้งานแล้ว', 'เริ่มจากแดชบอร์ด แล้ว SmartLife จะช่วยสรุปสิ่งสำคัญให้คุณ'];
  const next = step === 1 ? 'smartlife_onboarding_step_2' : step === 2 ? 'smartlife_onboarding_step_3' : 'index';
  const continueOnboarding = () => {
    if (step === 1 && !institutionType) {
      showToast('เลือกประเภทสถานศึกษา', 'กรุณาเลือกมหาวิทยาลัยหรือมัธยมศึกษาก่อนดำเนินการต่อ');
      return;
    }
    onNavigate(next);
  };

  return <UserShell onNavigate={onNavigate}>
    <UserHeader onNavigate={onNavigate} title="ยินดีต้อนรับ" subtitle={`ขั้นตอน ${step} จาก 3`} />
    <View style={{paddingTop: 34}}>
      <Card style={localStyles.card}>
        <Text style={[styles.sectionTitle, {fontSize: 28}]}>{content[0]}</Text>
        <Text style={[styles.bodyText, {fontSize: 14, lineHeight: 22}]}>{content[1]}</Text>
        {step === 1 ? <InstitutionTypeSelector onChange={(value) => setInstitutionType(value).catch(() => showToast('บันทึกไม่สำเร็จ', 'กรุณาลองเลือกประเภทสถานศึกษาอีกครั้ง'))} value={institutionType} /> : null}
        <View style={localStyles.progress}>{[1, 2, 3].map((item) => <View key={item} style={[localStyles.progressItem, {backgroundColor: item <= step ? '#668d65' : '#cbd6c7'}]} />)}</View>
      </Card>
      <PrimaryButton disabled={step === 1 && !institutionType} label={step === 3 ? 'เข้าสู่ SmartLife' : 'ถัดไป'} onPress={continueOnboarding} />
      {step > 1 ? <Pressable onPress={() => onNavigate('index')} style={localStyles.skip}><Text style={styles.rowSide}>ข้ามไปหน้าหลัก</Text></Pressable> : null}
    </View>
  </UserShell>;
}

const localStyles = StyleSheet.create({
  card: {backgroundColor: '#e0ebdd', minHeight: 340},
  icon: {alignItems: 'center', backgroundColor: '#edf3ea', borderRadius: 15, height: 48, justifyContent: 'center', width: 48},
  iconSelected: {backgroundColor: '#668d65'},
  option: {alignItems: 'center', backgroundColor: 'rgba(255,255,255,.78)', borderColor: 'transparent', borderRadius: 17, borderWidth: 2, flexDirection: 'row', gap: 11, padding: 12},
  optionCopy: {flex: 1},
  optionDescription: {color: '#758171', fontFamily: 'Prompt_400Regular', fontSize: 10, lineHeight: 15, marginTop: 2},
  optionList: {gap: 10, marginTop: 20},
  optionSelected: {backgroundColor: '#fff', borderColor: '#668d65'},
  optionTitle: {color: '#29351f', fontFamily: 'Prompt_700Bold', fontSize: 14},
  pressed: {opacity: .78, transform: [{scale: .98}]},
  progress: {flexDirection: 'row', gap: 8, marginTop: 26},
  progressItem: {borderRadius: 6, flex: 1, height: 7},
  radio: {alignItems: 'center', borderColor: '#9caa98', borderRadius: 10, borderWidth: 2, height: 20, justifyContent: 'center', width: 20},
  radioDot: {backgroundColor: '#fff', borderRadius: 4, height: 8, width: 8},
  radioSelected: {backgroundColor: '#668d65', borderColor: '#668d65'},
  skip: {alignItems: 'center', marginTop: 18},
});
