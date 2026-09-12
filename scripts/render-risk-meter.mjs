// Renders the real RiskMeter through react-native-web -- the same renderer the
// web build uses -- and reports the width and colour the bar actually comes out
// with at each risk band. This is render evidence rather than a code read: if
// the fill were hardcoded to one state, the three rows below would be identical.
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

import RiskMeter from '@/components/risk-meter';
import {BURNOUT_RISK_BANDS} from '@/constants/burnout-risk';

/** react-native-web emits classes plus a stylesheet; pull the inline bits out. */
function inlineStyles(html) {
  return [...html.matchAll(/style="([^"]*)"/g)].map((match) => match[1]);
}

function describe(level, score) {
  const html = renderToStaticMarkup(createElement(RiskMeter, {level, score}));
  const styles = inlineStyles(html);
  const widthDeclaration = styles.map((style) => /width:\s*([\d.]+%)/.exec(style)?.[1]).find(Boolean);
  // react-native-web normalises a hex literal to `rgba(r,g,b,a.aa)`.
  const colourDeclaration = styles
    .map((style) => /background-color:\s*(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/.exec(style)?.[1])
    .filter(Boolean);
  const label = /aria-label="([^"]*)"/.exec(html)?.[1] ?? /aria-valuenow="(\d+)"/.exec(html)?.[1];
  return {
    ariaNow: /aria-valuenow="(\d+)"/.exec(html)?.[1] ?? null,
    ariaRole: /role="([^"]*)"/.exec(html)?.[1] ?? null,
    colours: colourDeclaration,
    html,
    label,
    scaleText: [...html.matchAll(/>([^<>]*\d[^<>]*)</g)].map((match) => match[1]),
    width: widthDeclaration ?? null,
  };
}

function toHex(value) {
  const rgb = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(value);
  if (!rgb) return value.toLowerCase();
  return `#${rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
}

const cases = [
  ['low', 12],
  ['medium', 45],
  ['high', 82],
];

console.log('Rendered RiskMeter through react-native-web:\n');
const seen = new Set();
let failures = 0;
for (const [level, score] of cases) {
  const rendered = describe(level, score);
  const expected = BURNOUT_RISK_BANDS[level];
  const fillColour = rendered.colours.map(toHex).find((colour) => colour === expected.color.toLowerCase());
  const labelCarriesScore = typeof rendered.label === 'string'
    && rendered.label.includes(String(score))
    && rendered.label.includes(expected.label);
  const ok = rendered.width === `${score}%` && Boolean(fillColour)
    && rendered.ariaRole === 'progressbar' && labelCarriesScore;
  if (!ok) failures += 1;
  seen.add(`${rendered.width}|${fillColour}`);
  console.log(`  ${level.padEnd(7)} score=${String(score).padStart(3)}  fill-width=${String(rendered.width).padEnd(5)}  fill-colour=${fillColour ?? 'NOT FOUND'}  expected=${expected.color}  role=${rendered.ariaRole}`);
  console.log(`           visible text: ${JSON.stringify(rendered.scaleText)}`);
  console.log(`           aria-label:   ${rendered.label}`);
  console.log(`           ${ok ? 'OK' : 'MISMATCH'}\n`);
}

if (seen.size !== cases.length) {
  console.error(`FAIL: the three bands rendered ${seen.size} distinct bar states, expected ${cases.length} -- the bar looks hardcoded.`);
  process.exit(1);
}
if (failures) {
  console.error(`FAIL: ${failures} band(s) did not render as expected.`);
  process.exit(1);
}

// Clamping, rendered rather than reasoned about.
for (const [score, expectedWidth] of [[0, '0%'], [100, '100%'], [140, '100%'], [-20, '0%']]) {
  const rendered = describe('high', score);
  if (rendered.width !== expectedWidth) {
    console.error(`FAIL: score ${score} rendered width ${rendered.width}, expected ${expectedWidth}`);
    process.exit(1);
  }
  console.log(`  clamp: score=${String(score).padStart(4)} -> rendered width ${rendered.width}`);
}

console.log('\nRisk meter render check passed: three distinct fills and colours, clamped at both ends.');
