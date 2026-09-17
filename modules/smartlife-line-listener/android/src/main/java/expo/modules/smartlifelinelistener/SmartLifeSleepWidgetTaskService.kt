package expo.modules.smartlifelinelistener

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Starts the `SmartLifeSleepWidgetTask` Headless JS task registered in
 * `src/tasks/sleep-widget-task.ts`. React Native boots (or reuses) a JS
 * context for this even when the app is not open, which is what lets the
 * widget's buttons write to Firestore -- the app has no native Firestore/Auth
 * SDK, only the JS one, so the write has to happen in JS either way.
 *
 * Promotes itself to a "short service" (Android 14+) the instant it starts.
 * `shortService` is the foreground-service type Android added specifically
 * for brief, user-triggered background work like this; it self-limits to a
 * few minutes, well past the 15s task timeout below.
 */
class SmartLifeSleepWidgetTaskService : HeadlessJsTaskService() {
  override fun onCreate() {
    super.onCreate()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val action = intent?.getStringExtra(SmartLifeSleepWidgetProvider.EXTRA_ACTION) ?: return null
    if (action != SmartLifeSleepWidgetProvider.ACTION_GO_TO_BED && action != SmartLifeSleepWidgetProvider.ACTION_WAKE_UP) return null
    val data = Arguments.createMap().apply {
      putString("action", action)
    }
    return HeadlessJsTaskConfig(
      "SmartLifeSleepWidgetTask",
      data,
      15000,
      // Must run whether the app happens to already be open or not -- a
      // widget tap should not depend on the app's current foreground state.
      true
    )
  }

  private fun buildNotification(): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "SmartLife Sleep Widget", NotificationManager.IMPORTANCE_MIN)
        )
      }
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("กำลังบันทึกการนอน")
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "smartlife_sleep_widget"
    private const val NOTIFICATION_ID = 8421
  }
}
