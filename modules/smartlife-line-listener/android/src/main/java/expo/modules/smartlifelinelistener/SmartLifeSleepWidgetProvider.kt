package expo.modules.smartlifelinelistener

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.widget.RemoteViews

/**
 * A second, separate widget from [SmartLifeWidgetProvider]: just the two
 * "เข้านอน"/"ตื่นนอน" buttons, so a user can log sleep without unlocking into
 * the app at all.
 *
 * Each button's `PendingIntent` starts [SmartLifeSleepWidgetTaskService]
 * directly, as a foreground service. Confirmed by testing on a real device
 * that the more obvious design -- the button broadcasts to this provider,
 * which then starts the service -- is rejected outright on Android 12+:
 * `BackgroundServiceStartNotAllowedException`/`ForegroundServiceStartNotAllowedException`,
 * because a `BroadcastReceiver` reacting to an arbitrary custom action carries
 * no background-start exemption. A widget's own `PendingIntent`, redeemed
 * directly by the OS in response to the tap, does carry that exemption --
 * the same mechanism a notification's action buttons rely on -- so the
 * service has to be the `PendingIntent`'s direct target, with no
 * receiver/broadcast hop in between.
 */
class SmartLifeSleepWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetIds.forEach { appWidgetId ->
      appWidgetManager.updateAppWidget(appWidgetId, buildRemoteViews(context))
    }
  }

  companion object {
    const val ACTION_GO_TO_BED = "go_to_bed"
    const val ACTION_WAKE_UP = "wake_up"
    const val EXTRA_ACTION = "action"

    private const val PREFS = "smartlife_sleep_widget"
    private const val KEY_STATUS = "status"

    fun saveWidgetData(context: Context, statusText: String) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_STATUS, statusText)
        .apply()
    }

    fun updateAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, SmartLifeSleepWidgetProvider::class.java)
      val ids = manager.getAppWidgetIds(component)
      ids.forEach { appWidgetId ->
        manager.updateAppWidget(appWidgetId, buildRemoteViews(context))
      }
    }

    private fun pendingTaskService(context: Context, action: String, requestCode: Int): PendingIntent {
      val intent = Intent(context, SmartLifeSleepWidgetTaskService::class.java)
        .putExtra(EXTRA_ACTION, action)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        PendingIntent.getForegroundService(context, requestCode, intent, flags)
      } else {
        PendingIntent.getService(context, requestCode, intent, flags)
      }
    }

    private fun buildRemoteViews(context: Context): RemoteViews {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val views = RemoteViews(context.packageName, R.layout.smartlife_sleep_widget)
      views.setTextViewText(
        R.id.smartlife_sleep_widget_status,
        prefs.getString(KEY_STATUS, "พร้อมบันทึกการนอนคืนนี้")
      )
      views.setOnClickPendingIntent(
        R.id.smartlife_sleep_widget_bed_button,
        pendingTaskService(context, ACTION_GO_TO_BED, 1001)
      )
      views.setOnClickPendingIntent(
        R.id.smartlife_sleep_widget_wake_button,
        pendingTaskService(context, ACTION_WAKE_UP, 1002)
      )
      return views
    }
  }
}
