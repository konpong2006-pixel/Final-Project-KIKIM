package expo.modules.smartlifelinelistener

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import android.service.notification.NotificationListenerService
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmartLifeLineListenerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SmartLifeLineListener")

    Events("onLineNotification")

    OnStartObserving("onLineNotification") {
      LineImportEventBus.listener = { payload ->
        sendEvent("onLineNotification", payload)
      }
    }

    OnStopObserving("onLineNotification") {
      LineImportEventBus.listener = null
    }

    OnDestroy {
      LineImportEventBus.listener = null
    }

    AsyncFunction("getStateAsync") {
      val context = requireNotNull(appContext.reactContext)
      val store = LineNotificationStore(context)
      mapOf(
        "enabled" to store.isEnabled(),
        "lastConnectedAt" to store.lastConnectedAt(),
        "lastNotificationAt" to store.lastNotificationAt(),
        "permissionGranted" to NotificationManagerCompat
          .getEnabledListenerPackages(context)
          .contains(context.packageName),
        "queueCount" to store.notificationCount()
      )
    }

    AsyncFunction("openNotificationAccessSettingsAsync") {
      val context = requireNotNull(appContext.reactContext)
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }

    AsyncFunction("setListenerEnabledAsync") { enabled: Boolean, userId: String ->
      val context = requireNotNull(appContext.reactContext)
      val store = LineNotificationStore(context)
      store.setEnabled(enabled, userId)
      if (enabled && NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)) {
        NotificationListenerService.requestRebind(
          ComponentName(context, SmartLifeLineNotificationService::class.java)
        )
      }
    }

    AsyncFunction("requestRebindAsync") {
      val context = requireNotNull(appContext.reactContext)
      NotificationListenerService.requestRebind(
        ComponentName(context, SmartLifeLineNotificationService::class.java)
      )
    }

    AsyncFunction("getQueuedNotificationsAsync") { userId: String ->
      val context = requireNotNull(appContext.reactContext)
      LineNotificationStore(context).listNotifications(userId).map { captured ->
        mapOf(
          "capturedAt" to captured.capturedAt,
          "id" to captured.id,
          "sourcePackage" to captured.sourcePackage,
          "text" to captured.text,
          "title" to captured.title
        )
      }
    }

    AsyncFunction("acknowledgeNotificationsAsync") { ids: List<String> ->
      val context = requireNotNull(appContext.reactContext)
      LineNotificationStore(context).acknowledge(ids.toSet())
    }

    AsyncFunction("clearCapturedNotificationsAsync") {
      val context = requireNotNull(appContext.reactContext)
      LineNotificationStore(context).clearNotifications()
    }

    AsyncFunction("consumeSharedTextAsync") {
      val context = requireNotNull(appContext.reactContext)
      LineNotificationStore(context).consumeSharedText()
    }

    AsyncFunction("updateHomeWidgetAsync") {
      dateLabel: String,
      dayNumber: String,
      headline: String,
      subheadline: String,
      focusTitle: String,
      budgetLabel: String,
      updatedAtLabel: String ->
      val context = requireNotNull(appContext.reactContext)
      SmartLifeWidgetProvider.saveWidgetData(
        context = context,
        dateLabel = dateLabel,
        dayNumber = dayNumber,
        headline = headline,
        subheadline = subheadline,
        focusTitle = focusTitle,
        budgetLabel = budgetLabel,
        updatedAtLabel = updatedAtLabel
      )
      SmartLifeWidgetProvider.updateAllWidgets(context)
    }
  }
}
