import { NativeModule, requireNativeModule } from 'expo';

import type {
  CapturedLineNotification,
  LineListenerNativeState,
  SmartLifeHomeWidgetPayload,
  SmartLifeLineListenerModuleEvents,
} from './SmartLifeLineListener.types';

declare class SmartLifeLineListenerModule extends NativeModule<SmartLifeLineListenerModuleEvents> {
  acknowledgeNotificationsAsync(ids: string[]): Promise<void>;
  clearCapturedNotificationsAsync(): Promise<void>;
  consumeSharedTextAsync(): Promise<string | null>;
  getQueuedNotificationsAsync(userId: string): Promise<CapturedLineNotification[]>;
  getStateAsync(): Promise<LineListenerNativeState>;
  openNotificationAccessSettingsAsync(): Promise<void>;
  requestRebindAsync(): Promise<void>;
  setListenerEnabledAsync(enabled: boolean, userId: string): Promise<void>;
  updateHomeWidgetAsync(
    dateLabel: string,
    dayNumber: string,
    headline: string,
    subheadline: string,
    focusTitle: string,
    budgetLabel: string,
    updatedAtLabel: string,
  ): Promise<void>;
}

export default requireNativeModule<SmartLifeLineListenerModule>('SmartLifeLineListener');
export type {SmartLifeHomeWidgetPayload};
