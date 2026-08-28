import {Platform} from 'react-native';

type SmartLifeHomeWidgetPayload = {
  budgetLabel: string;
  dateLabel: string;
  dayNumber: string;
  focusTitle: string;
  headline: string;
  subheadline: string;
  updatedAtLabel: string;
};

type SmartLifeLineListenerModule = {
  updateHomeWidgetAsync(
    dateLabel: string,
    dayNumber: string,
    headline: string,
    subheadline: string,
    focusTitle: string,
    budgetLabel: string,
    updatedAtLabel: string,
  ): Promise<void>;
};

let nativeModulePromise: Promise<SmartLifeLineListenerModule | null> | null = null;

async function nativeModule() {
  if (Platform.OS !== 'android') return null;
  if (!nativeModulePromise) {
    nativeModulePromise = import('../../modules/smartlife-line-listener')
      .then((module) => module.default as SmartLifeLineListenerModule)
      .catch(() => null);
  }
  return nativeModulePromise;
}

export async function updateAndroidHomeWidget(payload: SmartLifeHomeWidgetPayload) {
  const native = await nativeModule();
  if (!native) return;
  await native.updateHomeWidgetAsync(
    payload.dateLabel,
    payload.dayNumber,
    payload.headline,
    payload.subheadline,
    payload.focusTitle,
    payload.budgetLabel,
    payload.updatedAtLabel,
  );
}
