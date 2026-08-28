export type SmartLifeLineListenerModuleEvents = {
  onLineNotification: (params: LineNotificationEventPayload) => void;
};

export type LineNotificationEventPayload = {
  capturedAt: number;
  queueCount: number;
  sourcePackage?: string;
  text: string;
  title: string;
};

export type CapturedLineNotification = {
  capturedAt: number;
  id: string;
  sourcePackage?: string;
  text: string;
  title: string;
};

export type LineListenerNativeState = {
  enabled: boolean;
  lastConnectedAt: number;
  lastNotificationAt: number;
  permissionGranted: boolean;
  queueCount: number;
};

export type SmartLifeHomeWidgetPayload = {
  budgetLabel: string;
  dateLabel: string;
  dayNumber: string;
  focusTitle: string;
  headline: string;
  subheadline: string;
  updatedAtLabel: string;
};
