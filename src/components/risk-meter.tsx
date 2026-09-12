import {StyleSheet, Text, View} from 'react-native';

import {burnoutRiskBand, RISK_METER_TRACK_COLOR, riskMeterFillPercent, type BurnoutRiskLevel} from '@/constants/burnout-risk';

/**
 * Horizontal meter for a 0-100 burnout score. The fill length is the score and
 * the fill colour is the band, both taken from the same `riskLevel` the text
 * label uses, so a glance at length and colour agrees with the words.
 *
 * Colour is never the only carrier of the level: the caller keeps its text
 * label, and the bar itself reports its value to screen readers.
 *
 * Track and fill follow the meter already used on the monthly budget screen --
 * same pill shape, same neutral track, same clamped width -- rather than
 * introducing a second meter style to the app.
 */
export default function RiskMeter({level, score, showScale = true}: {
  level: BurnoutRiskLevel;
  score: number;
  /** The 0/100 end captions. Off for tight rows where the score is adjacent. */
  showScale?: boolean;
}) {
  const band = burnoutRiskBand(level);
  const safeScore = riskMeterFillPercent(score);

  return <View
    accessibilityRole="progressbar"
    accessibilityValue={{max: 100, min: 0, now: safeScore}}
    accessible
    accessibilityLabel={`ความเสี่ยงสภาวะหมดไฟระดับ${band.label} คะแนน ${safeScore} จาก 100`}
    style={styles.wrap}
  >
    <View style={styles.track}>
      {/* `minWidth` keeps a very low but non-zero score visible as a sliver
          instead of vanishing and reading as "no data". */}
      <View style={[styles.fill, {backgroundColor: band.color, width: `${safeScore}%`}, safeScore > 0 && styles.fillVisible]} />
    </View>
    {showScale ? <View style={styles.scale}>
      <Text style={styles.scaleText}>0</Text>
      <Text style={[styles.scaleValue, {color: band.color}]}>{safeScore}/100 · {band.label}</Text>
      <Text style={styles.scaleText}>100</Text>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  fill: {borderRadius: 99, height: '100%'},
  fillVisible: {minWidth: 4},
  scale: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 4},
  scaleText: {color: '#9aa196', fontFamily: 'Prompt_500Medium', fontSize: 8},
  scaleValue: {fontFamily: 'Prompt_700Bold', fontSize: 9},
  track: {backgroundColor: RISK_METER_TRACK_COLOR, borderRadius: 99, height: 8, overflow: 'hidden', width: '100%'},
  wrap: {marginTop: 8, width: '100%'},
});
