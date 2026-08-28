package expo.modules.smartlifelinelistener

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

class SmartLifeWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetIds.forEach { appWidgetId ->
      appWidgetManager.updateAppWidget(appWidgetId, buildRemoteViews(context))
    }
  }

  companion object {
    private const val PREFS = "smartlife_home_widget"
    private const val KEY_DATE_LABEL = "dateLabel"
    private const val KEY_DAY_NUMBER = "dayNumber"
    private const val KEY_HEADLINE = "headline"
    private const val KEY_SUBHEADLINE = "subheadline"
    private const val KEY_FOCUS_TITLE = "focusTitle"
    private const val KEY_BUDGET_LABEL = "budgetLabel"
    private const val KEY_UPDATED_AT_LABEL = "updatedAtLabel"

    fun saveWidgetData(
      context: Context,
      dateLabel: String,
      dayNumber: String,
      headline: String,
      subheadline: String,
      focusTitle: String,
      budgetLabel: String,
      updatedAtLabel: String
    ) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_DATE_LABEL, dateLabel)
        .putString(KEY_DAY_NUMBER, dayNumber)
        .putString(KEY_HEADLINE, headline)
        .putString(KEY_SUBHEADLINE, subheadline)
        .putString(KEY_FOCUS_TITLE, focusTitle)
        .putString(KEY_BUDGET_LABEL, budgetLabel)
        .putString(KEY_UPDATED_AT_LABEL, updatedAtLabel)
        .apply()
    }

    fun updateAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, SmartLifeWidgetProvider::class.java)
      val ids = manager.getAppWidgetIds(component)
      ids.forEach { appWidgetId ->
        manager.updateAppWidget(appWidgetId, buildRemoteViews(context))
      }
    }

    private fun buildRemoteViews(context: Context): RemoteViews {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val views = RemoteViews(context.packageName, R.layout.smartlife_home_widget)
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent(Intent.ACTION_MAIN).apply {
          setPackage(context.packageName)
          addCategory(Intent.CATEGORY_LAUNCHER)
        }
      val pendingIntent = PendingIntent.getActivity(
        context,
        0,
        launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      views.setOnClickPendingIntent(R.id.smartlife_widget_root, pendingIntent)
      views.setTextViewText(R.id.smartlife_widget_date_label, prefs.getString(KEY_DATE_LABEL, "วันนี้"))
      views.setTextViewText(R.id.smartlife_widget_day_number, prefs.getString(KEY_DAY_NUMBER, "--"))
      views.setTextViewText(R.id.smartlife_widget_headline, prefs.getString(KEY_HEADLINE, "SmartLife"))
      views.setTextViewText(
        R.id.smartlife_widget_subheadline,
        prefs.getString(KEY_SUBHEADLINE, "เปิดแอปเพื่ออัปเดตข้อมูลวันนี้")
      )
      views.setTextViewText(
        R.id.smartlife_widget_focus,
        prefs.getString(KEY_FOCUS_TITLE, "ยังไม่มีงานที่ต้องโฟกัส")
      )
      views.setTextViewText(R.id.smartlife_widget_budget, prefs.getString(KEY_BUDGET_LABEL, "งบวันนี้ —"))
      views.setTextViewText(R.id.smartlife_widget_updated, prefs.getString(KEY_UPDATED_AT_LABEL, "ยังไม่อัปเดต"))
      return views
    }
  }
}
