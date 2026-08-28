import { NativeModule, registerWebModule } from 'expo';

import type {
  CapturedLineNotification,
  LineListenerNativeState,
  SmartLifeHomeWidgetPayload,
  SmartLifeLineListenerModuleEvents,
} from './SmartLifeLineListener.types';

// SmartLifeLineListenerModule is not available on the web platform.
class SmartLifeLineListenerModule extends NativeModule<SmartLifeLineListenerModuleEvents> {
  async acknowledgeNotificationsAsync(_ids: string[]) {}
  async clearCapturedNotificationsAsync() {}
  async consumeSharedTextAsync() { return null; }
  async getQueuedNotificationsAsync(_userId: string): Promise<CapturedLineNotification[]> { return []; }
  async getStateAsync(): Promise<LineListenerNativeState> {
    return {enabled: false, lastConnectedAt: 0, lastNotificationAt: 0, permissionGranted: false, queueCount: 0};
  }
  async openNotificationAccessSettingsAsync() {}
  async requestRebindAsync() {}
  async setListenerEnabledAsync(_enabled: boolean, _userId: string) {}
  async updateHomeWidgetAsync(
    _dateLabel: SmartLifeHomeWidgetPayload['dateLabel'],
    _dayNumber: SmartLifeHomeWidgetPayload['dayNumber'],
    _headline: SmartLifeHomeWidgetPayload['headline'],
    _subheadline: SmartLifeHomeWidgetPayload['subheadline'],
    _focusTitle: SmartLifeHomeWidgetPayload['focusTitle'],
    _budgetLabel: SmartLifeHomeWidgetPayload['budgetLabel'],
    _updatedAtLabel: SmartLifeHomeWidgetPayload['updatedAtLabel'],
  ) {}
}

export default registerWebModule(SmartLifeLineListenerModule, 'SmartLifeLineListenerModule');
