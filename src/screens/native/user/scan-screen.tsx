import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native";
import NativeDateTimePicker from "@expo/ui/community/datetime-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import LoadingAndSuccessModal, {
  type FeedbackPhase,
} from "@/components/loading-success-modal";
import { defaultTermDates, suggestedSchoolTerm } from "@/lib/term-dates";
import {
  buildReceiptHtml,
  normalizeReceiptItems,
  type ReceiptItem,
} from "@/lib/receipt-html";
import { decodeUnicodeEscapes } from "@/lib/unicode-text";
import { useInstitution } from "@/providers/institution-provider";
import { uploadAndAnalyzeScan, type OcrResult } from "@/services/ocr";
import { saveOcrResult } from "@/services/scan-save";
import type { InstitutionType, SchoolTerm } from "@/types/institution";
import {
  Card,
  MaterialIcon,
  UserHeader,
  UserShell,
  type UserNavigate,
} from "./user-ui";

type ScanPage =
  | "smartlife_scan_schedule"
  | "smartlife_scan_finance"
  | "smartlife_scan_result"
  | "smartlife_receipt_scan"
  | "smartlife_receipt_result";
type ScheduleEntry = {
  buildingName?: string;
  classTime?: string;
  courseCode?: string;
  courseName?: string;
  day?: string;
  endDate?: string;
  endTime?: string;
  finalExam?: string;
  midtermExam?: string;
  periodLabel?: string;
  raw?: string;
  room?: string;
  section?: string;
  startDate?: string;
  startTime?: string;
};
type TimePickerTarget = {
  field: "endTime" | "startTime";
  index: number;
} | null;
type Feedback = {
  phase: FeedbackPhase;
  subtitle: string;
  title: string;
} | null;

const C = {
  pine: "#2c341b",
  sage: "#6f8f6d",
  soft: "#e4ecdf",
  mist: "#f4f5ef",
  muted: "#858b80",
  note: "#bb9293",
  finance: "#9297bb",
};
const F = {
  r: "Prompt_400Regular",
  m: "Prompt_500Medium",
  s: "Prompt_600SemiBold",
  b: "Prompt_700Bold",
  x: "Prompt_800ExtraBold",
};

function textValue(value: unknown, fallback = "ยังอ่านไม่พบ") {
  const decoded = decodeUnicodeEscapes(value).trim();
  return decoded || fallback;
}

function firstPresentValue(...values: unknown[]) {
  return values.find((value) => String(value ?? "").trim().length > 0);
}
function contentTypeForAsset(asset: ImagePicker.ImagePickerAsset) {
  if (asset.mimeType && /^image\/(jpeg|png|webp)$/i.test(asset.mimeType))
    return asset.mimeType.toLowerCase();
  const name = `${asset.fileName ?? ""} ${asset.uri}`.toLowerCase();
  if (name.includes(".png")) return "image/png";
  if (name.includes(".webp")) return "image/webp";
  return "image/jpeg";
}

function bangkokDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).formatToParts(value);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function scheduleDraft(
  parsed: Record<string, unknown>,
  institutionType: InstitutionType,
  term: SchoolTerm,
) {
  const fallback = defaultTermDates(institutionType, term);
  const validDate = (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return {
    ...parsed,
    semesterEnd: validDate(parsed.semesterEnd)
      ? parsed.semesterEnd
      : fallback.semesterEnd,
    semesterStart: validDate(parsed.semesterStart)
      ? parsed.semesterStart
      : fallback.semesterStart,
  };
}

function dateFromKey(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00+07:00`)
    : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function thaiDateLabel(value: unknown) {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(dateFromKey(value));
}

function timeFromText(value: unknown) {
  const match = String(value ?? "").match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return new Date(
    2000,
    0,
    1,
    match ? Number(match[1]) : 9,
    match ? Number(match[2]) : 0,
    0,
    0,
  );
}

function timeKey(value: Date) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function touchDistance(event: GestureResponderEvent) {
  const [first, second] = event.nativeEvent.touches;
  if (!first || !second) return null;
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

function ScanImageViewer({
  onClose,
  uri,
  visible,
}: {
  onClose: () => void;
  uri: string;
  visible: boolean;
}) {
  const safeAreaInsets = useSafeAreaInsets();
  const [scale] = useState(() => new Animated.Value(1));
  const currentScale = useRef(1);
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const wasPinching = useRef(false);
  const lastTap = useRef(0);

  const applyScale = useCallback(
    (next: number, animated = false) => {
      const value = Math.min(4, Math.max(1, next));
      currentScale.current = value;
      if (animated)
        Animated.spring(scale, {
          bounciness: 5,
          speed: 20,
          toValue: value,
          useNativeDriver: true,
        }).start();
      else scale.setValue(value);
    },
    [scale],
  );

  useEffect(() => {
    if (!visible) return;
    pinchStartDistance.current = null;
    wasPinching.current = false;
    applyScale(1);
  }, [applyScale, visible]);

  const handleTouchStart = (event: GestureResponderEvent) => {
    const distance = touchDistance(event);
    if (distance === null) return;
    pinchStartDistance.current = distance;
    pinchStartScale.current = currentScale.current;
    wasPinching.current = true;
  };

  const handleTouchMove = (event: GestureResponderEvent) => {
    const distance = touchDistance(event);
    if (distance === null || pinchStartDistance.current === null) return;
    applyScale(
      pinchStartScale.current * (distance / pinchStartDistance.current),
    );
  };

  const handleTouchEnd = () => {
    if (wasPinching.current) {
      wasPinching.current = false;
      pinchStartDistance.current = null;
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < 260)
      applyScale(currentScale.current > 1 ? 1 : 2.2, true);
    lastTap.current = now;
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={localStyles.zoomOverlay}>
        <Pressable
          accessibilityLabel="ปิดภาพที่สแกน"
          onPress={onClose}
          style={[localStyles.zoomClose, { top: safeAreaInsets.top + 14 }]}
        >
          <MaterialIcon color={C.pine} name="close" size={23} />
        </Pressable>
        <View
          accessibilityLabel="ภาพที่สแกน แตะสองครั้งเพื่อซูม หรือใช้สองนิ้วขยาย"
          accessible
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onTouchStart={handleTouchStart}
          style={localStyles.zoomCanvas}
        >
          <Animated.View
            style={[localStyles.zoomImageFrame, { transform: [{ scale }] }]}
          >
            <Image
              contentFit="contain"
              source={{ uri }}
              style={localStyles.zoomImage}
            />
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

function ReceiptHtmlModal({
  html,
  onClose,
  visible,
}: {
  html: string;
  onClose: () => void;
  visible: boolean;
}) {
  const safeAreaInsets = useSafeAreaInsets();
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      visible={visible}
    >
      <View
        style={[
          localStyles.htmlModal,
          { paddingTop: Math.max(safeAreaInsets.top, 12) },
        ]}
      >
        <View style={localStyles.htmlModalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={localStyles.htmlModalTitle}>ใบเสร็จ</Text>
            <Text style={localStyles.htmlModalSubtitle}>
              สร้างจากข้อมูล OCR ที่ตรวจสอบแล้ว
            </Text>
          </View>
          <Pressable
            accessibilityLabel="ปิดใบเสร็จ"
            onPress={onClose}
            style={localStyles.htmlModalClose}
          >
            <MaterialIcon color={C.pine} name="close" size={22} />
          </Pressable>
        </View>
        <WebView
          originWhitelist={["*"]}
          source={{ html }}
          style={localStyles.htmlWebView}
        />
      </View>
    </Modal>
  );
}

function receiptInputNumber(value: string) {
  const normalized = value.replace(/,/g, "").replace(/[^\d.-]/g, "").trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0
    ? Number(number.toFixed(2))
    : null;
}

function receiptMoney(value: number | null) {
  return value === null
    ? "-"
    : new Intl.NumberFormat("th-TH", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(value);
}

function receiptPriceBeforeDiscount(item: ReceiptItem) {
  if (item.totalPrice === null) return null;
  return item.discount !== null
    ? Number((item.totalPrice + item.discount).toFixed(2))
    : item.totalPrice;
}

// Refactored UI: finance scans use a focused receipt upload and review flow.
function ReceiptScanDashboard({
  confirmAndSave,
  draft,
  imageUri,
  onDraftChange,
  onNavigate,
  pendingCount,
  pick,
  result,
  saving,
  updateReceiptItem,
}: {
  confirmAndSave: () => void;
  draft: Record<string, unknown>;
  imageUri: string;
  onDraftChange: (key: string, value: string) => void;
  onNavigate: UserNavigate;
  pendingCount: number;
  pick: (source: "camera" | "library") => Promise<void>;
  result: OcrResult | null;
  saving: boolean;
  updateReceiptItem: (
    index: number,
    key: keyof ReceiptItem,
    value: string,
  ) => void;
}) {
  const [receiptHtmlOpen, setReceiptHtmlOpen] = useState(false);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<"date" | "time" | null>(
    null,
  );
  const merchant = textValue(
    draft.merchant ?? draft.store ?? draft.vendor,
    "ร้านค้าที่สแกน",
  );
  const total = textValue(
    firstPresentValue(draft.total, draft.amount, draft.totalAmount),
    "0",
  );
  const category = textValue(draft.category, "Food / อาหาร");
  const confidenceValue = Number(
    draft.confidenceScore ?? result?.classification.confidence ?? 0,
  );
  const confidence = Number.isFinite(confidenceValue)
    ? Math.round(Math.min(1, Math.max(0, confidenceValue)) * 100)
    : 0;
  const transactionDate =
    [textValue(draft.date, ""), textValue(draft.time, "")]
      .filter(Boolean)
      .join(" · ") || "ไม่พบวันที่และเวลา";
  const items = normalizeReceiptItems(draft.items);
  const needsReview = Boolean(draft.needsReview);
  const reviewReasons = Array.isArray(draft.reviewReasons)
    ? draft.reviewReasons.filter((reason): reason is string =>
        typeof reason === "string" && Boolean(reason.trim()),
      )
    : [];
  const receiptHtml = buildReceiptHtml({
    category,
    date: draft.date,
    items,
    merchant,
    reference: draft.reference,
    time: draft.time,
    total,
  });
  const ready = Boolean(result);
  return (
    <UserShell active="smartlife_finance_day" onNavigate={onNavigate}>
      <View style={receiptStyles.page}>
        <View style={receiptStyles.header}>
          <Pressable
            onPress={() => onNavigate("smartlife_finance_day")}
            style={receiptStyles.back}
          >
            <MaterialIcon color={C.pine} name="chevron_left" size={25} />
          </Pressable>
          <Text style={receiptStyles.title}>
            {ready ? "ผลลัพธ์ใบเสร็จ" : "สแกนใบเสร็จ"}
          </Text>
          <Pressable
            onPress={() => onNavigate("smartlife_ocr_history")}
            style={receiptStyles.history}
          >
            <MaterialIcon
              color={C.pine}
              name={ready ? "check_circle" : "bookmark_border"}
              size={20}
            />
          </Pressable>
        </View>
        {!ready ? (
          <>
            <LinearGradient
              colors={["#717db2", "#9199c2"]}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={receiptStyles.hero}
            >
              <View style={receiptStyles.heroIcon}>
                <MaterialIcon color="#fff" name="receipt_long" size={27} />
              </View>
              <Text style={receiptStyles.heroTitle}>ให้ AI อ่านใบเสร็จ</Text>
              <Text style={receiptStyles.heroText}>
                ถ่ายหรืออัปโหลดใบเสร็จ แล้วระบบจะแยกรายจ่าย วันที่
                และหมวดหมู่ให้
              </Text>
            </LinearGradient>
            <Pressable
              onPress={() => pick("library")}
              style={receiptStyles.dropZone}
            >
              <MaterialIcon
                color="#a2a9c6"
                name="add_photo_alternate"
                size={29}
              />
              <Text style={receiptStyles.dropText}>
                {imageUri
                  ? "กำลังอ่านใบเสร็จ..."
                  : "วางใบเสร็จให้อยู่ในกรอบ\nแล้วกดถ่ายหรืออัปโหลด"}
              </Text>
            </Pressable>
            <View style={receiptStyles.pickRow}>
              <Pressable
                disabled={saving}
                onPress={() => pick("camera")}
                style={receiptStyles.pickButton}
              >
                <MaterialIcon color="#7684ba" name="photo_camera" size={20} />
                <Text style={receiptStyles.pickText}>ถ่ายใบเสร็จ</Text>
              </Pressable>
              <Pressable
                disabled={saving}
                onPress={() => pick("library")}
                style={receiptStyles.pickButton}
              >
                <MaterialIcon color="#7684ba" name="image" size={20} />
                <Text style={receiptStyles.pickText}>อัปโหลดรูป</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            {pendingCount > 0 ? (
              <View style={receiptStyles.batchNotice}>
                <MaterialIcon color="#6573ad" name="photo_library" size={19} />
                <Text style={receiptStyles.batchNoticeText}>
                  มีใบเสร็จรอประมวลผลอีก {pendingCount} รูป
                </Text>
              </View>
            ) : null}
            <View style={receiptStyles.sourceImageCard}>
              <View style={receiptStyles.sourceImageHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={receiptStyles.sourceImageTitle}>รูปต้นฉบับ</Text>
                  <Text style={receiptStyles.sourceImageSubtitle}>
                    ดูรูปเทียบกับข้อมูลด้านล่าง แล้วแตะช่องที่ต้องการแก้ไข
                  </Text>
                </View>
                <Pressable onPress={() => pick("library")}>
                  <MaterialIcon color={C.sage} name="refresh" size={20} />
                </Pressable>
              </View>
              <Pressable onPress={() => setImageViewerOpen(true)}>
                <Image
                  contentFit="contain"
                  source={{ uri: imageUri }}
                  style={receiptStyles.sourceImage}
                />
              </Pressable>
            </View>
            <View style={receiptStyles.editorCard}>
              <Text style={receiptStyles.editorTitle}>ตรวจและแก้ไขผล OCR</Text>
              <EditableRow
                icon="storefront"
                label="ผู้รับ / ร้านค้า"
                onChangeText={(value) => onDraftChange("merchant", value)}
                value={textValue(draft.merchant ?? draft.merchantName, "")}
              />
              <EditableRow
                icon="payments"
                keyboardType="decimal-pad"
                label="ยอดรวม (บาท)"
                onChangeText={(value) => onDraftChange("total", value)}
                value={String(firstPresentValue(draft.total, draft.amount, draft.totalAmount) ?? "")}
              />
              <EditableRow
                icon="category"
                label="หมวดหมู่"
                onChangeText={(value) => onDraftChange("category", value)}
                value={textValue(draft.category, "")}
              />
              <PickerDataRow
                icon="event"
                label="วันที่"
                onPress={() => setPickerTarget("date")}
                value={thaiDateLabel(draft.date)}
              />
              <PickerDataRow
                icon="schedule"
                label="เวลา"
                onPress={() => setPickerTarget("time")}
                value={textValue(draft.time, "แตะเพื่อเลือกเวลา")}
              />
              {pickerTarget ? (
                <NativeDateTimePicker
                  accentColor={C.sage}
                  is24Hour
                  mode={pickerTarget}
                  onDismiss={() => setPickerTarget(null)}
                  onValueChange={(_, selectedDate) => {
                    onDraftChange(
                      pickerTarget,
                      pickerTarget === "date"
                        ? bangkokDateKey(selectedDate)
                        : timeKey(selectedDate),
                    );
                    setPickerTarget(null);
                  }}
                  presentation="dialog"
                  value={pickerTarget === "date" ? dateFromKey(draft.date) : timeFromText(draft.time)}
                />
              ) : null}
              {items.length ? (
                <View style={localStyles.receiptItemsCard}>
                  <Text style={localStyles.receiptItemsTitle}>รายการสินค้า</Text>
                  {items.map((item, index) => (
                    <View key={`receipt-editor-${index}`} style={localStyles.receiptItemEditor}>
                      <TextInput
                        accessibilityLabel={`ชื่อสินค้ารายการที่ ${index + 1}`}
                        onChangeText={(value) => updateReceiptItem(index, "name", value)}
                        placeholder="ชื่อสินค้า"
                        style={localStyles.receiptItemNameInput}
                        value={item.name}
                      />
                      <View style={localStyles.receiptItemNumbers}>
                        <ReceiptItemInput
                          label="จำนวน"
                          onChangeText={(value) => updateReceiptItem(index, "quantity", value)}
                          value={item.quantity === null ? "" : String(item.quantity)}
                        />
                        <ReceiptItemInput
                          label="ราคาต่อหน่วย"
                          onChangeText={(value) => updateReceiptItem(index, "unitPrice", value)}
                          value={item.unitPrice === null ? "" : String(item.unitPrice)}
                        />
                        <ReceiptItemInput
                          label="ราคารวม"
                          onChangeText={(value) => updateReceiptItem(index, "totalPrice", value)}
                          value={item.totalPrice === null ? "" : String(item.totalPrice)}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            <View style={receiptStyles.receiptCard}>
              <View style={receiptStyles.merchantRow}>
                <View style={receiptStyles.merchantIcon}>
                  <MaterialIcon color="#c38b75" name="receipt_long" size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={receiptStyles.merchant}>{merchant}</Text>
                  <Text style={receiptStyles.merchantSub}>
                    {transactionDate}
                  </Text>
                </View>
                <View style={receiptStyles.confidence}>
                  <Text style={receiptStyles.confidenceText}>
                    มั่นใจ {confidence}%
                  </Text>
                </View>
              </View>
              {items.length ? (
                <View style={receiptStyles.productList}>
                  <View style={receiptStyles.productHeader}>
                    <MaterialIcon
                      color={C.sage}
                      name="shopping_basket"
                      size={17}
                    />
                    <Text style={receiptStyles.productTitle}>รายการสินค้า</Text>
                  </View>
                  {items.map((item, index) => (
                    <View key={index} style={receiptStyles.productRow}>
                      <View style={receiptStyles.productIndex}>
                        <Text style={receiptStyles.productIndexText}>
                          {index + 1}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={receiptStyles.productName}>{item.name}</Text>
                        {item.quantity !== null ? (
                          <Text style={receiptStyles.productMeta}>
                            {item.quantity} × ฿{receiptMoney(item.unitPrice)}
                          </Text>
                        ) : null}
                        {item.discount !== null ? (
                          <Text style={receiptStyles.productDiscount}>
                            {`ก่อนลด ฿${receiptMoney(receiptPriceBeforeDiscount(item))} · ส่วนลด ฿${receiptMoney(item.discount)}`}
                          </Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={receiptStyles.productPrice}>
                          ฿{receiptMoney(item.totalPrice)}
                        </Text>
                        {item.discount !== null ? (
                          <Text style={receiptStyles.productDiscount}>ราคาคงเหลือ</Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={receiptStyles.totalBox}>
                <Text style={receiptStyles.totalLabel}>ยอดรวม</Text>
                <Text style={receiptStyles.total}>฿{total}</Text>
              </View>
              <View style={receiptStyles.category}>
                <View style={receiptStyles.categoryDot} />
                <Text style={receiptStyles.categoryText}>{category}</Text>
                <Text style={receiptStyles.edit}>แก้ไข</Text>
              </View>
            </View>
            {needsReview ? (
              <View style={receiptStyles.reviewWarning}>
                <MaterialIcon color="#a36b28" name="warning" size={21} />
                <View style={{ flex: 1 }}>
                  <Text style={receiptStyles.reviewWarningTitle}>
                    กรุณาตรวจสอบก่อนบันทึก
                  </Text>
                  <Text style={receiptStyles.reviewWarningText}>
                    {reviewReasons.join(" · ") ||
                      "ระบบพบข้อมูลบางจุดที่ยังไม่แน่นอน"}
                  </Text>
                </View>
              </View>
            ) : null}
            <View style={receiptStyles.analysis}>
              <Text style={receiptStyles.analysisTitle}>
                Smart Expense Categorization
              </Text>
              <View style={receiptStyles.analysisRow}>
                <View style={receiptStyles.analysisIcon}>
                  <MaterialIcon color="#638263" name="receipt_long" size={18} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={receiptStyles.analysisHead}>
                    OCR อ่านใบเสร็จสำเร็จ
                  </Text>
                  <Text style={receiptStyles.analysisSub}>
                    พบยอดรวม วันที่ และเวลาจากรูปใบเสร็จ
                  </Text>
                </View>
              </View>
              <View style={receiptStyles.analysisRow}>
                <View
                  style={[
                    receiptStyles.analysisIcon,
                    { backgroundColor: "#eef0fb" },
                  ]}
                >
                  <MaterialIcon color="#7986ba" name="auto_awesome" size={18} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={receiptStyles.analysisHead}>
                    NLP วิเคราะห์ร้านค้าและจัดหมวดหมู่
                  </Text>
                  <Text style={receiptStyles.analysisSub}>
                    {merchant} ถูกเพิ่มเป็น {category} โดยอัตโนมัติ
                  </Text>
                </View>
              </View>
            </View>
            <View style={receiptStyles.detailCard}>
              <Text style={receiptStyles.detailTitle}>
                รายละเอียดที่จะบันทึก
              </Text>
              <ReceiptDetail label="ประเภท" value="รายจ่าย" />
              <ReceiptDetail label="ร้านค้า" value={merchant} />
              <ReceiptDetail label="วันที่และเวลา" value={transactionDate} />
              <ReceiptDetail label="หมวดหมู่" value={category} />
              <ReceiptDetail
                label="หมายเหตุ"
                value="นำเข้าจาก Smart Scan OCR"
              />
            </View>
            <Pressable
              onPress={() => setReceiptHtmlOpen(true)}
              style={receiptStyles.htmlButton}
            >
              <MaterialIcon color={C.sage} name="language" size={19} />
              <Text style={receiptStyles.htmlButtonText}>ดูใบเสร็จ</Text>
            </Pressable>
            <Pressable
              disabled={saving}
              onPress={confirmAndSave}
              style={[
                receiptStyles.saveShell,
                saving && receiptStyles.disabled,
              ]}
            >
              <LinearGradient
                colors={["#6573ad", "#6978b4"]}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={receiptStyles.save}
              >
                <MaterialIcon color="#fff" name="check" size={19} />
                <Text style={receiptStyles.saveText}>
                  {saving
                    ? "กำลังบันทึก..."
                    : pendingCount > 0
                      ? `บันทึกและไปใบถัดไป (เหลือ ${pendingCount})`
                      : "บันทึกรายจ่ายนี้"}
                </Text>
              </LinearGradient>
            </Pressable>
            <ReceiptHtmlModal
              html={receiptHtml}
              onClose={() => setReceiptHtmlOpen(false)}
              visible={receiptHtmlOpen}
            />
            <ScanImageViewer
              onClose={() => setImageViewerOpen(false)}
              uri={imageUri}
              visible={imageViewerOpen}
            />
          </>
        )}
      </View>
    </UserShell>
  );
}
function ReceiptDetail({ label, value }: { label: string; value: string }) {
  return (
    <View style={receiptStyles.detailRow}>
      <Text style={receiptStyles.detailLabel}>{label}</Text>
      <Text style={receiptStyles.detailValue}>{value}</Text>
    </View>
  );
}

const receiptStyles = StyleSheet.create({
  batchNotice: {
    alignItems: "center",
    backgroundColor: "#eef0fb",
    borderRadius: 14,
    flexDirection: "row",
    gap: 8,
    marginTop: 13,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  batchNoticeText: { color: "#59669d", flex: 1, fontFamily: F.s, fontSize: 12 },
  analysis: {
    backgroundColor: "#fff",
    borderRadius: 20,
    boxShadow: "0 7px 18px rgba(42,51,73,.07)",
    marginTop: 13,
    padding: 14,
  },
  editorCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    marginTop: 13,
    padding: 14,
  },
  editorTitle: { color: C.pine, fontFamily: F.x, fontSize: 13, marginBottom: 6 },
  analysisHead: { color: C.pine, fontFamily: F.b, fontSize: 11 },
  analysisIcon: {
    alignItems: "center",
    backgroundColor: "#e4efdf",
    borderRadius: 12,
    height: 37,
    justifyContent: "center",
    width: 37,
  },
  analysisRow: {
    alignItems: "center",
    backgroundColor: "#f8faf6",
    borderColor: "#e7ebe4",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    marginTop: 9,
    padding: 8,
  },
  analysisSub: { color: C.muted, fontFamily: F.r, fontSize: 8, marginTop: 1 },
  analysisTitle: { color: C.pine, fontFamily: F.x, fontSize: 13 },
  back: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    height: 43,
    justifyContent: "center",
    width: 43,
  },
  category: {
    alignItems: "center",
    backgroundColor: "#e5efdf",
    borderRadius: 99,
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  categoryDot: {
    backgroundColor: C.sage,
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  categoryText: { color: C.sage, flex: 1, fontFamily: F.b, fontSize: 9 },
  confidence: {
    backgroundColor: "#eef0fb",
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  confidenceText: { color: "#7885ba", fontFamily: F.b, fontSize: 8 },
  detailCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    boxShadow: "0 7px 18px rgba(42,51,73,.07)",
    marginTop: 13,
    padding: 14,
  },
  detailLabel: { color: C.muted, fontFamily: F.s, fontSize: 9 },
  detailRow: {
    borderBottomColor: "#edf0ea",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  detailTitle: { color: C.pine, fontFamily: F.x, fontSize: 13 },
  detailValue: { color: C.pine, fontFamily: F.b, fontSize: 9 },
  disabled: { opacity: 0.55 },
  dropText: {
    color: "#89928c",
    fontFamily: F.s,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  dropZone: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderColor: "#cbd1e1",
    borderRadius: 20,
    borderStyle: "dashed",
    borderWidth: 2,
    gap: 12,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 238,
    padding: 18,
  },
  edit: { color: "#7885ba", fontFamily: F.b, fontSize: 8 },
  header: { alignItems: "center", flexDirection: "row", gap: 10 },
  hero: { borderRadius: 20, marginTop: 14, padding: 17 },
  heroIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,.18)",
    borderRadius: 20,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  heroText: {
    color: "rgba(255,255,255,.88)",
    fontFamily: F.r,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 7,
  },
  heroTitle: { color: "#fff", fontFamily: F.x, fontSize: 19, marginTop: 17 },
  history: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    height: 43,
    justifyContent: "center",
    width: 43,
  },
  htmlButton: {
    alignItems: "center",
    backgroundColor: "#eef3eb",
    borderColor: "#dce7d8",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 49,
  },
  htmlButtonText: { color: C.sage, fontFamily: F.b, fontSize: 11 },
  merchant: { color: C.pine, fontFamily: F.x, fontSize: 14 },
  merchantIcon: {
    alignItems: "center",
    backgroundColor: "#fbeae0",
    borderRadius: 14,
    height: 43,
    justifyContent: "center",
    width: 43,
  },
  merchantRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  merchantSub: { color: C.muted, fontFamily: F.r, fontSize: 8, marginTop: 2 },
  page: { paddingBottom: 6 },
  sourceImage: { backgroundColor: "#f5f7f2", borderRadius: 14, height: 300, width: "100%" },
  sourceImageCard: { backgroundColor: "#fff", borderRadius: 20, marginTop: 13, padding: 12 },
  sourceImageHeader: { alignItems: "center", flexDirection: "row", marginBottom: 9 },
  sourceImageSubtitle: { color: C.muted, fontFamily: F.r, fontSize: 9, marginTop: 2 },
  sourceImageTitle: { color: C.pine, fontFamily: F.x, fontSize: 13 },
  pickButton: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 17,
    flex: 1,
    gap: 6,
    minHeight: 68,
    justifyContent: "center",
  },
  pickRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  pickText: { color: C.pine, fontFamily: F.b, fontSize: 10 },
  productHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginBottom: 2,
  },
  productIndex: {
    alignItems: "center",
    backgroundColor: C.soft,
    borderRadius: 10,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  productIndexText: { color: C.sage, fontFamily: F.b, fontSize: 8 },
  productList: {
    borderTopColor: "#edf0ea",
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 11,
  },
  productMeta: { color: C.muted, fontFamily: F.r, fontSize: 8, marginTop: 2 },
  productDiscount: { color: C.sage, fontFamily: F.b, fontSize: 8, marginTop: 2 },
  productName: { color: C.pine, fontFamily: F.b, fontSize: 9 },
  productPrice: { color: C.pine, fontFamily: F.b, fontSize: 10 },
  productRow: {
    alignItems: "center",
    borderBottomColor: "#edf0ea",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 9,
  },
  productTitle: { color: C.pine, fontFamily: F.b, fontSize: 10 },
  receiptCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    boxShadow: "0 7px 18px rgba(42,51,73,.07)",
    marginTop: 14,
    padding: 14,
  },
  reviewWarning: {
    alignItems: "flex-start",
    backgroundColor: "#fff5e7",
    borderColor: "#efd7b2",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    marginTop: 12,
    padding: 12,
  },
  reviewWarningText: {
    color: "#79572f",
    fontFamily: F.r,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 2,
  },
  reviewWarningTitle: { color: "#7f541f", fontFamily: F.b, fontSize: 11 },
  save: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 49,
  },
  saveShell: { borderRadius: 16, marginTop: 14, overflow: "hidden" },
  saveText: { color: "#fff", fontFamily: F.b, fontSize: 13 },
  title: { color: C.pine, flex: 1, fontFamily: F.x, fontSize: 20 },
  total: { color: C.pine, fontFamily: F.x, fontSize: 25 },
  totalBox: {
    alignItems: "center",
    backgroundColor: "#f2f5ed",
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  totalLabel: { color: C.muted, fontFamily: F.b, fontSize: 10 },
});

export default function ScanScreen({
  page,
  uid,
  onNavigate,
}: {
  page: ScanPage;
  uid: string;
  onNavigate: UserNavigate;
}) {
  const safeAreaInsets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // Keep the dismiss action clear of Android's system navigation controls.
  const pickerBottomPadding = Math.max(safeAreaInsets.bottom, 24) + 20;
  const { institutionType: storedInstitutionType } = useInstitution();
  const institutionType = storedInstitutionType ?? "university";
  const [schoolTerm, setSchoolTerm] = useState<SchoolTerm>(() =>
    suggestedSchoolTerm(),
  );
  const [result, setResult] = useState<OcrResult | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [imageUri, setImageUri] = useState("");
  const [pendingAssets, setPendingAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [imageAspectRatio, setImageAspectRatio] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<"end" | "start" | null>(
    null,
  );
  const [timePickerTarget, setTimePickerTarget] =
    useState<TimePickerTarget>(null);
  const [receiptPickerTarget, setReceiptPickerTarget] = useState<
    "date" | "time" | null
  >(null);
  const [rawOcrText, setRawOcrText] = useState("");
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [receiptHtmlOpen, setReceiptHtmlOpen] = useState(false);
  const [imageCardFrame, setImageCardFrame] = useState({ height: 0, top: 0 });
  const [isImagePinned, setIsImagePinned] = useState(false);
  const scanGeneration = useRef(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );

  const showFeedback = (next: Feedback, hideAfter?: number) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = null;
    setFeedback(next);
    if (next && hideAfter)
      feedbackTimer.current = setTimeout(() => setFeedback(null), hideAfter);
  };

  const resetCurrentScan = (clearPendingAssets: boolean) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = null;
    scanGeneration.current += 1;
    setDraft({});
    setImageUri("");
    setImageAspectRatio(1);
    setPickerOpen(false);
    setPickerTarget(null);
    setTimePickerTarget(null);
    setReceiptPickerTarget(null);
    setRawOcrText("");
    setImageViewerOpen(false);
    setReceiptHtmlOpen(false);
    setImageCardFrame({ height: 0, top: 0 });
    setIsImagePinned(false);
    setResult(null);
    setSaveComplete(false);
    setSaving(false);
    setFeedback(null);
    if (clearPendingAssets) setPendingAssets([]);
  };

  const handleClearData = () => resetCurrentScan(true);

  const analyzeAsset = async (
    asset: ImagePicker.ImagePickerAsset,
    generation: number,
  ) => {
    try {
      const contentType = contentTypeForAsset(asset);
      console.log("[SmartScan] Image selected", {
        contentType,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        height: asset.height,
        uriScheme: asset.uri.split(":")[0],
        width: asset.width,
      });
      setImageUri(asset.uri);
      setImageAspectRatio(
        asset.width && asset.height ? asset.width / asset.height : 1,
      );
      setResult(null);
      setSaveComplete(false);
      showFeedback({
        phase: "loading",
        subtitle:
          page === "smartlife_scan_finance"
            ? "iApp กำลังอ่านร้านค้า รายการสินค้า และยอดชำระ"
            : "กำลังตรวจชนิดเอกสารและแยกข้อความ",
        title: "กำลังอ่านเอกสาร",
      });

      const response = await uploadAndAnalyzeScan({
        uid,
        scanType: page === "smartlife_scan_finance" ? "receipt" : "auto",
        uri: asset.uri,
        contentType,
      });
      if (generation !== scanGeneration.current) return false;
      setResult(response);
      setRawOcrText(response.rawText ?? "");
      setDraft(
        response.scanType === "schedule"
          ? scheduleDraft(response.parsed, institutionType, schoolTerm)
          : {
              ...response.parsed,
              items: normalizeReceiptItems(response.parsed.items),
              total: firstPresentValue(
                response.parsed.total,
                response.parsed.amount,
                response.parsed.totalAmount,
              ) ?? "",
            },
      );
      showFeedback(
        {
          phase: "success",
          subtitle:
            response.scanType === "receipt"
              ? "ตรวจพบสลิปหรือใบเสร็จ"
              : `ตรวจพบตารางเรียน${institutionType === "high-school" ? "มัธยมศึกษา" : "มหาวิทยาลัย"}`,
          title: "อ่านเอกสารสำเร็จ",
        },
        950,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[SmartScan] Read, upload, or OCR failed", {error, message});
      showFeedback(null);
      Alert.alert("สแกนไม่สำเร็จ", message || "กรุณาถ่ายภาพใหม่ให้ชัดขึ้น");
      return false;
    }
  };

  const pick = async (source: "camera" | "library") => {
    handleClearData();
    const generation = scanGeneration.current;
    try {
      console.log("[SmartScan] Opening image source", { source });
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync(false);
      if (!permission.granted) {
        console.warn("[SmartScan] Permission denied", {
          canAskAgain: permission.canAskAgain,
          source,
          status: permission.status,
        });
        Alert.alert(
          "ต้องอนุญาตสิทธิ์",
          permission.canAskAgain
            ? "กรุณาอนุญาตให้ SmartLife ใช้กล้องหรือคลังรูปภาพ"
            : "กรุณาเปิดสิทธิ์ SmartLife จาก Settings > Apps > SmartLife > Permissions",
        );
        return;
      }

      const picked =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({
              allowsEditing: false,
              mediaTypes: ["images"],
              quality: 0.9,
            })
          : await ImagePicker.launchImageLibraryAsync({
              allowsEditing: false,
              allowsMultipleSelection: page === "smartlife_scan_finance",
              mediaTypes: ["images"],
              quality: 0.9,
              selectionLimit: page === "smartlife_scan_finance" ? 10 : 1,
            });
      if (picked.canceled || !picked.assets?.[0]) {
        console.log("[SmartScan] Image selection canceled", { source });
        return;
      }

      const assets = source === "library" ? picked.assets : [picked.assets[0]];
      setPendingAssets(assets.slice(1));
      await analyzeAsset(assets[0], generation);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[SmartScan] Pick, read, upload, or OCR failed", {
        error,
        message,
        source,
      });
      showFeedback(null);
      Alert.alert("สแกนไม่สำเร็จ", message || "กรุณาถ่ายภาพใหม่ให้ชัดขึ้น");
    }
  };

  const receipt = result?.scanType === "receipt" ? draft : null;
  const schedule = result?.scanType === "schedule" ? draft : null;
  const entries = Array.isArray(schedule?.entries)
    ? (schedule.entries as ScheduleEntry[])
    : [];
  const updateDraft = (key: string, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const receiptItems = normalizeReceiptItems(receipt?.items);
  const updateReceiptItem = (
    index: number,
    key: keyof ReceiptItem,
    value: string,
  ) =>
    setDraft((current) => {
      const currentItems = normalizeReceiptItems(current.items);
      return {
        ...current,
        items: currentItems.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                [key]: key === "name"
                  ? value
                  : key === "quantity" && !value.trim()
                    ? 1
                    : receiptInputNumber(value),
              }
            : item,
        ),
      };
    });
  const receiptHtml = receipt
    ? buildReceiptHtml({
        category: receipt.category,
        date: receipt.date,
        items: receipt.items,
        merchant: receipt.merchant ?? receipt.merchantName,
        reference: receipt.reference,
        time: receipt.time,
        total: firstPresentValue(
          receipt.total,
          receipt.amount,
          receipt.totalAmount,
        ),
      })
    : "";
  const updateEntry = (
    index: number,
    key: keyof ScheduleEntry,
    value: string,
  ) =>
    setDraft((current) => {
      const currentEntries = Array.isArray(current.entries)
        ? (current.entries as ScheduleEntry[])
        : [];
      return {
        ...current,
        entries: currentEntries.map((entry, entryIndex) =>
          entryIndex === index ? { ...entry, [key]: value } : entry,
        ),
      };
    });
  const selectedEntryTime = timePickerTarget
    ? entries[timePickerTarget.index]?.[timePickerTarget.field]
    : null;
  const selectEntryTime = (selectedDate: Date) => {
    if (!timePickerTarget) return;
    updateEntry(
      timePickerTarget.index,
      timePickerTarget.field,
      timeKey(selectedDate),
    );
    setTimePickerTarget(null);
  };
  const receiptDateValue = dateFromKey(receipt?.date);
  const receiptTimeValue = timeFromText(receipt?.time);
  const selectReceiptDateTime = (selectedDate: Date) => {
    if (!receiptPickerTarget) return;
    updateDraft(
      receiptPickerTarget,
      receiptPickerTarget === "date"
        ? bangkokDateKey(selectedDate)
        : timeKey(selectedDate),
    );
    setReceiptPickerTarget(null);
  };
  const semesterStartDate = dateFromKey(draft.semesterStart);
  const semesterEndDate = dateFromKey(draft.semesterEnd);
  const semesterMaximumDate = new Date(
    semesterStartDate.getTime() + 224 * 24 * 60 * 60 * 1000,
  );
  const selectSemesterDate = (selectedDate: Date) => {
    if (!pickerTarget) return;
    updateDraft(
      pickerTarget === "start" ? "semesterStart" : "semesterEnd",
      bangkokDateKey(selectedDate),
    );
    setPickerTarget(null);
  };
  const selectSchoolTerm = (term: SchoolTerm) => {
    setSchoolTerm(term);
    setDraft((current) => ({
      ...current,
      ...defaultTermDates("high-school", term),
    }));
  };

  const handleScanScroll = (offsetY: number) => {
    const shouldPin = Boolean(
      result &&
      imageUri &&
      imageCardFrame.height > 0 &&
      offsetY >= imageCardFrame.top + imageCardFrame.height,
    );
    setIsImagePinned((current) =>
      current === shouldPin ? current : shouldPin,
    );
  };

  const safeImageAspectRatio =
    Number.isFinite(imageAspectRatio) && imageAspectRatio > 0
      ? imageAspectRatio
      : 1;
  const imageContentWidth = Math.max(windowWidth - 72, 1);
  const previewHeight = Math.min(
    380,
    Math.max(190, imageContentWidth / safeImageAspectRatio),
  );
  // Receipt review needs room for editable fields, so keep a compact floating
  // source image. Schedules stay wide because table columns need more space.
  const pinnedPreviewHeight = result?.scanType === "receipt" ? 220 : previewHeight;

  const persistOcrResult = async () => {
    if (!result || saving) return;
    const nextAsset = pendingAssets[0];
    setSaving(true);
    showFeedback({
      phase: "loading",
      subtitle: "กำลังส่งข้อมูลที่ตรวจสอบแล้วไปยัง Firebase",
      title: "กำลังบันทึกข้อมูล",
    });
    try {
      const saved = await saveOcrResult({ draft, result, uid });
      console.log("[SmartScan] Structured data saved", {
        documentIds: saved.documentIds,
        scanType: result.scanType,
      });
      setSaveComplete(true);
      showFeedback({
        phase: "success",
        subtitle:
          result.scanType === "receipt"
            ? saved.duplicate
              ? "ตรวจพบรายการเดิม จึงไม่เพิ่มยอดซ้ำ"
              : "เพิ่มรายการไปยังหน้าการเงินแล้ว"
            : "เพิ่มรายวิชาไปยังปฏิทินแล้ว",
        title: saved.duplicate ? "ข้ามรายการซ้ำแล้ว" : "บันทึกสำเร็จ",
      });
      setTimeout(() => {
        if (result.scanType === "receipt" && nextAsset) {
          setPendingAssets((current) => current.slice(1));
          resetCurrentScan(false);
          void analyzeAsset(nextAsset, scanGeneration.current);
          return;
        }
        handleClearData();
        onNavigate(
          result.scanType === "receipt"
            ? "smartlife_scan_schedule"
            : saved.destination,
        );
      }, 1050);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[SmartScan] Confirm and save failed", {
        error,
        message,
        scanType: result.scanType,
      });
      setSaving(false);
      showFeedback(null);
      Alert.alert(
        "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08",
        message ||
          "\u0e01\u0e23\u0e38\u0e13\u0e32\u0e25\u0e2d\u0e07\u0e43\u0e2b\u0e21\u0e48\u0e2d\u0e35\u0e01\u0e04\u0e23\u0e31\u0e49\u0e07",
      );
    }
  };

  const confirmAndSave = () => {
    if (!result || saving) return;
    const needsReview =
      result.scanType === "receipt" && Boolean(result.parsed.needsReview);
    if (!needsReview) {
      void persistOcrResult();
      return;
    }
    const reasons = Array.isArray(result.parsed.reviewReasons)
      ? result.parsed.reviewReasons
          .filter((reason) => typeof reason === "string")
          .join("\n• ")
      : "";
    Alert.alert(
      "ตรวจสอบข้อมูลก่อนบันทึก",
      `ระบบจะไม่บันทึกข้อมูลที่ไม่แน่นอนโดยอัตโนมัติ${
        reasons ? `\n\n• ${reasons}` : ""
      }\n\nหากตรวจสอบและแก้ไขข้อมูลแล้ว จึงยืนยันบันทึกได้`,
      [
        { style: "cancel", text: "กลับไปตรวจสอบ" },
        {
          onPress: () => void persistOcrResult(),
          text: "ตรวจสอบแล้ว บันทึก",
        },
      ],
    );
  };

  if (page === "smartlife_scan_finance") {
    return (
      <ReceiptScanDashboard
        confirmAndSave={confirmAndSave}
        draft={draft}
        imageUri={imageUri}
        onDraftChange={updateDraft}
        onNavigate={onNavigate}
        pendingCount={pendingAssets.length}
        pick={pick}
        result={result}
        saving={saving}
        updateReceiptItem={updateReceiptItem}
      />
    );
  }

  return (
    <UserShell onNavigate={onNavigate} scroll={false}>
      <View style={localStyles.scanShell}>
        <ScrollView
          contentContainerStyle={localStyles.scanScroll}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onScroll={(event) =>
            handleScanScroll(event.nativeEvent.contentOffset.y)
          }
          scrollEventThrottle={32}
        >
          <UserHeader
            onNavigate={onNavigate}
            right={
              <Pressable
                accessibilityLabel="เปิดประวัติ OCR"
                accessibilityRole="button"
                onPress={() => onNavigate("smartlife_ocr_history")}
                style={({ pressed }) => [
                  localStyles.historyButton,
                  pressed && localStyles.pressed,
                ]}
              >
                <MaterialIcon color="#fff" name="history" size={21} />
              </Pressable>
            }
            title="Smart Scan"
            subtitle="ถ่ายครั้งเดียว ระบบแยกสลิปและตารางเรียนให้อัตโนมัติ"
          />
          <Card style={localStyles.hero}>
            <LinearGradient
              colors={["#eef4ea", "#e7e8f3"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={localStyles.heroGradient}
            >
              <View style={localStyles.heroIcon}>
                <MaterialIcon
                  color={C.sage}
                  name="document_scanner"
                  size={31}
                />
              </View>
              <Text style={localStyles.heroTitle}>สแกนเอกสารอัจฉริยะ</Text>
              <Text style={localStyles.heroText}>
                รองรับภาษาไทยและอังกฤษ พร้อมจำแนกประเภทและดึงข้อมูลสำคัญด้วย
                Cloud Vision OCR
              </Text>
              <Pressable
                accessibilityLabel="เพิ่มรูปเอกสาร"
                accessibilityRole="button"
                onPress={() => setPickerOpen(true)}
                style={({ pressed }) => [
                  localStyles.fab,
                  pressed && localStyles.pressed,
                ]}
              >
                <LinearGradient
                  colors={["#789a75", "#4f754c"]}
                  style={localStyles.fabGradient}
                >
                  <MaterialIcon color="#fff" name="add" size={34} />
                </LinearGradient>
              </Pressable>
              <Text style={localStyles.fabLabel}>แตะเพื่อถ่ายหรืออัปโหลด</Text>
            </LinearGradient>
          </Card>

          {imageUri ? (
            <View
              onLayout={(event) =>
                setImageCardFrame({
                  height: event.nativeEvent.layout.height,
                  top: event.nativeEvent.layout.y,
                })
              }
            >
              <Card>
              <View style={localStyles.sectionHead}>
                <View>
                  <Text style={localStyles.sectionTitle}>ภาพที่เลือก</Text>
                  <Text style={localStyles.sectionSub}>
                    ระบบจะไม่บันทึกข้อมูลจนกว่า OCR จะประมวลผลสำเร็จ
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="เลือกรูปใหม่"
                  onPress={() => setPickerOpen(true)}
                  style={localStyles.changeButton}
                >
                  <MaterialIcon color={C.sage} name="refresh" size={18} />
                </Pressable>
              </View>
              <Pressable
                accessibilityHint="แตะเพื่อเปิดภาพเต็มจอและซูม"
                accessibilityLabel="เปิดภาพที่สแกนขนาดใหญ่"
                onPress={() => setImageViewerOpen(true)}
              >
                <Image
                  contentFit="contain"
                  source={{ uri: imageUri }}
                  style={[localStyles.preview, { height: previewHeight }]}
                />
              </Pressable>
              </Card>
            </View>
          ) : null}

          {imageUri || result ? (
            <View style={localStyles.scanActions}>
              <Pressable
                accessibilityLabel="\u0e2a\u0e41\u0e01\u0e19\u0e43\u0e2b\u0e21\u0e48"
                disabled={saving}
                onPress={() => setPickerOpen(true)}
                style={({ pressed }) => [
                  localStyles.rescanButton,
                  pressed && localStyles.pressed,
                ]}
              >
                <MaterialIcon
                  color={C.sage}
                  name="document_scanner"
                  size={18}
                />
                <Text style={localStyles.rescanText}>
                  {"\u0e2a\u0e41\u0e01\u0e19\u0e43\u0e2b\u0e21\u0e48"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityHint="ล้างรูปและข้อมูล OCR ทั้งหมด"
                accessibilityLabel="\u0e25\u0e49\u0e32\u0e07\u0e1c\u0e25\u0e2a\u0e41\u0e01\u0e19"
                accessibilityRole="button"
                disabled={saving}
                onPress={handleClearData}
                style={({ pressed }) => [
                  localStyles.clearButton,
                  pressed && localStyles.pressed,
                ]}
              >
                <MaterialIcon color="#b85f60" name="delete_outline" size={18} />
                <Text style={localStyles.clearText}>
                  {
                    "\u0e25\u0e49\u0e32\u0e07\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25"
                  }
                </Text>
              </Pressable>
            </View>
          ) : null}

          {result ? (
            <Card>
              <View style={localStyles.resultHead}>
                <View
                  style={[
                    localStyles.resultIcon,
                    {
                      backgroundColor:
                        result.scanType === "receipt" ? "#ececf6" : "#e5eee1",
                    },
                  ]}
                >
                  <MaterialIcon
                    color={result.scanType === "receipt" ? C.finance : C.sage}
                    name={
                      result.scanType === "receipt"
                        ? "receipt_long"
                        : "calendar_month"
                    }
                    size={24}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={localStyles.resultEyebrow}>
                    AI จำแนกเอกสารสำเร็จ
                  </Text>
                  <Text style={localStyles.resultTitle}>
                    {result.scanType === "receipt"
                      ? "สลิป / ใบเสร็จการเงิน"
                      : institutionType === "high-school"
                        ? "ตารางเรียนมัธยมศึกษา"
                        : "ตารางเรียนมหาวิทยาลัย"}
                  </Text>
                </View>
                <View style={localStyles.confidence}>
                  <Text style={localStyles.confidenceText}>
                    {Math.round(result.classification.confidence * 100)}%
                  </Text>
                </View>
              </View>
              <View style={localStyles.editNotice}>
                <MaterialIcon color={C.sage} name="edit" size={16} />
                <Text style={localStyles.editNoticeText}>
                  แตะช่องข้อมูลเพื่อแก้ไขผล OCR ก่อนบันทึก
                </Text>
              </View>
              {receipt?.needsReview ? (
                <View style={localStyles.reviewWarning}>
                  <MaterialIcon color="#a36b28" name="warning" size={18} />
                  <Text style={localStyles.reviewWarningText}>
                    {Array.isArray(receipt.reviewReasons)
                      ? receipt.reviewReasons
                          .filter((reason) => typeof reason === "string")
                          .join(" · ")
                      : "ข้อมูลบางจุดยังไม่แน่นอน กรุณาตรวจสอบก่อนบันทึก"}
                  </Text>
                </View>
              ) : null}
              {receipt ? (
                <View style={localStyles.dataGroup}>
                  <EditableRow
                    icon="storefront"
                    label="ผู้รับ / ร้านค้า"
                    onChangeText={(value) => updateDraft("merchant", value)}
                    value={textValue(
                      receipt.merchant ?? receipt.merchantName,
                      "",
                    )}
                  />
                  {receiptItems.length ? (
                    <View style={localStyles.receiptItemsCard}>
                      <View style={localStyles.receiptItemsHeader}>
                        <MaterialIcon
                          color={C.sage}
                          name="shopping_basket"
                          size={18}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={localStyles.receiptItemsTitle}>
                            รายการสินค้า
                          </Text>
                          <Text style={localStyles.receiptItemsSubtitle}>
                            ตรวจสอบราคาของแต่ละรายการก่อนดูยอดรวม
                          </Text>
                        </View>
                      </View>
                      {receiptItems.map((item, index) => (
                        <View key={index} style={localStyles.receiptItemEditor}>
                          <View style={localStyles.receiptItemTop}>
                            <View style={localStyles.receiptItemNumber}>
                              <Text style={localStyles.receiptItemNumberText}>
                                {index + 1}
                              </Text>
                            </View>
                            <TextInput
                              accessibilityLabel={`ชื่อสินค้ารายการที่ ${index + 1}`}
                              onChangeText={(value) =>
                                updateReceiptItem(index, "name", value)
                              }
                              placeholder="ชื่อสินค้า"
                              placeholderTextColor="#a6aaa2"
                              style={localStyles.receiptItemNameInput}
                              value={item.name}
                            />
                          </View>
                          <View style={localStyles.receiptItemNumbers}>
                            <ReceiptItemInput
                              label="จำนวน"
                              onChangeText={(value) =>
                                updateReceiptItem(index, "quantity", value)
                              }
                              value={
                                item.quantity === null
                                  ? ""
                                  : String(item.quantity)
                              }
                            />
                            <ReceiptItemInput
                              label="ราคาต่อหน่วย"
                              onChangeText={(value) =>
                                updateReceiptItem(index, "unitPrice", value)
                              }
                              value={
                                item.unitPrice === null
                                  ? ""
                                  : String(item.unitPrice)
                              }
                            />
                            <ReceiptItemInput
                              label="ราคารวม"
                              onChangeText={(value) =>
                                updateReceiptItem(index, "totalPrice", value)
                              }
                              value={
                                item.totalPrice === null
                                  ? ""
                                  : String(item.totalPrice)
                              }
                            />
                          </View>
                          {item.discount !== null ? (
                            <View style={localStyles.receiptItemDiscountRow}>
                              <MaterialIcon color={C.sage} name="sell" size={13} />
                              <Text style={localStyles.receiptItemDiscountText}>
                                {`ราคาก่อนลด ฿${receiptMoney(receiptPriceBeforeDiscount(item))} · ส่วนลด ฿${receiptMoney(item.discount)} · คงเหลือ ฿${receiptMoney(item.totalPrice)}`}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <EditableRow
                    icon="payments"
                    keyboardType="decimal-pad"
                    label="ยอดรวม (บาท)"
                    onChangeText={(value) => updateDraft("total", value)}
                    value={String(
                      firstPresentValue(
                        receipt.total,
                        receipt.amount,
                        receipt.totalAmount,
                      ) ?? "",
                    )}
                  />
                  <PickerDataRow
                    icon="event"
                    label="วันที่"
                    onPress={() => setReceiptPickerTarget("date")}
                    value={thaiDateLabel(receipt.date)}
                  />
                  <PickerDataRow
                    icon="schedule"
                    label="เวลา"
                    onPress={() => setReceiptPickerTarget("time")}
                    value={textValue(receipt.time, "แตะเพื่อเลือกเวลา")}
                  />
                  {receiptPickerTarget ? (
                    <NativeDateTimePicker
                      accentColor={C.sage}
                      is24Hour
                      mode={receiptPickerTarget}
                      onDismiss={() => setReceiptPickerTarget(null)}
                      onValueChange={(_, selectedDate) =>
                        selectReceiptDateTime(selectedDate)
                      }
                      presentation="dialog"
                      value={
                        receiptPickerTarget === "date"
                          ? receiptDateValue
                          : receiptTimeValue
                      }
                    />
                  ) : null}
                  <EditableRow
                    icon="tag"
                    label="รหัสอ้างอิง"
                    onChangeText={(value) => updateDraft("reference", value)}
                    value={textValue(receipt.reference, "")}
                  />
                  <Pressable
                    accessibilityLabel="ดูใบเสร็จ"
                    onPress={() => setReceiptHtmlOpen(true)}
                    style={({ pressed }) => [
                      localStyles.receiptHtmlButton,
                      pressed && localStyles.pressed,
                    ]}
                  >
                    <MaterialIcon color={C.sage} name="language" size={19} />
                    <Text style={localStyles.receiptHtmlButtonText}>
                      ดูใบเสร็จ
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {schedule ? (
                <View>
                  <EditableRow
                    icon="school"
                    label="ปีการศึกษา"
                    onChangeText={(value) => updateDraft("academicYear", value)}
                    value={textValue(schedule.academicYear, "")}
                  />
                  {entries.length ? (
                    entries.map((entry, index) => (
                      <View
                        key={`course-${index}`}
                        style={localStyles.courseCard}
                      >
                        <View style={localStyles.courseTop}>
                          <View style={localStyles.courseNumber}>
                            <Text style={localStyles.courseNumberText}>
                              {index + 1}
                            </Text>
                          </View>
                          <TextInput
                            accessibilityLabel={`รหัสวิชารายการที่ ${index + 1}`}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            onChangeText={(value) =>
                              updateEntry(index, "courseCode", value)
                            }
                            placeholder="รหัสวิชา"
                            placeholderTextColor="#a6aaa2"
                            selectTextOnFocus
                            style={localStyles.courseCodeInput}
                            value={textValue(entry.courseCode, "")}
                          />
                          <MaterialIcon color={C.sage} name="edit" size={16} />
                        </View>
                        <SmallInput
                          label="ชื่อวิชา"
                          onChangeText={(value) =>
                            updateEntry(index, "courseName", value)
                          }
                          value={textValue(entry.courseName, "")}
                        />
                        {entry.startDate && entry.endDate ? (
                          <View style={localStyles.extractedRange}>
                            <MaterialIcon
                              color={C.sage}
                              name="date_range"
                              size={14}
                            />
                            <Text style={localStyles.extractedRangeText}>
                              {entry.startDate} - {entry.endDate}
                            </Text>
                          </View>
                        ) : null}
                        <View style={localStyles.courseFields}>
                          <SmallInput
                            label="Section"
                            onChangeText={(value) =>
                              updateEntry(index, "section", value)
                            }
                            value={textValue(entry.section, "")}
                          />
                          <SmallInput
                            label="ห้อง / อาคาร"
                            onChangeText={(value) =>
                              updateEntry(index, "buildingName", value)
                            }
                            value={textValue(
                              entry.buildingName ?? entry.room,
                              "",
                            )}
                          />
                          <SmallInput
                            label="วัน"
                            onChangeText={(value) =>
                              updateEntry(index, "day", value)
                            }
                            value={textValue(entry.day, "")}
                          />
                          {entry.periodLabel ? (
                            <SmallInput
                              label="คาบเรียน"
                              onChangeText={(value) =>
                                updateEntry(index, "periodLabel", value)
                              }
                              value={textValue(entry.periodLabel, "")}
                            />
                          ) : null}
                          <View style={localStyles.timeInputs}>
                            <TimePickerButton
                              label="เวลาเริ่ม"
                              onPress={() =>
                                setTimePickerTarget({
                                  field: "startTime",
                                  index,
                                })
                              }
                              value={textValue(entry.startTime, "")}
                            />
                            <TimePickerButton
                              label="เวลาสิ้นสุด"
                              onPress={() =>
                                setTimePickerTarget({ field: "endTime", index })
                              }
                              value={textValue(entry.endTime, "")}
                            />
                          </View>
                          {textValue(entry.midtermExam, "").trim() ||
                          textValue(entry.finalExam, "").trim() ? (
                            <>
                              <View style={localStyles.examSectionHeader}>
                                <View style={localStyles.examSectionIcon}><MaterialIcon color={C.sage} name="assignment" size={16} /></View>
                                <View style={{flex: 1}}><Text style={localStyles.examSectionTitle}>กำหนดการสอบ</Text><Text style={localStyles.examSectionSub}>แสดงเฉพาะวันสอบที่ตรวจพบจากภาพและ OCR</Text></View>
                              </View>
                              {textValue(entry.midtermExam, "").trim() ? (
                                <SmallInput
                                  label="สอบกลางภาค"
                                  onChangeText={(value) =>
                                    updateEntry(index, "midtermExam", value)
                                  }
                                  value={textValue(entry.midtermExam, "")}
                                />
                              ) : null}
                              {textValue(entry.finalExam, "").trim() ? (
                                <SmallInput
                                  label="สอบปลายภาค"
                                  onChangeText={(value) =>
                                    updateEntry(index, "finalExam", value)
                                  }
                                  value={textValue(entry.finalExam, "")}
                                />
                              ) : null}
                            </>
                          ) : null}
                        </View>
                      </View>
                    ))
                  ) : (
                    <View style={localStyles.empty}>
                      <MaterialIcon color={C.muted} name="warning" size={25} />
                      <Text style={localStyles.emptyText}>
                        อ่านพบว่าเป็นตารางเรียน แต่ยังแยกรายวิชาไม่ได้
                        กรุณาถ่ายภาพให้ตรงและชัดขึ้น
                      </Text>
                    </View>
                  )}
                  {timePickerTarget ? (
                    <NativeDateTimePicker
                      accentColor={C.sage}
                      is24Hour
                      mode="time"
                      onDismiss={() => setTimePickerTarget(null)}
                      onValueChange={(_, selectedDate) =>
                        selectEntryTime(selectedDate)
                      }
                      presentation="dialog"
                      value={timeFromText(selectedEntryTime)}
                    />
                  ) : null}
                </View>
              ) : null}
              <Pressable
                accessibilityLabel="ดูข้อความ OCR ทั้งหมด"
                onPress={() =>
                  Alert.alert(
                    "ข้อความที่ OCR อ่านได้",
                    rawOcrText.slice(0, 3000) || "ไม่มีข้อความ OCR",
                  )
                }
                style={localStyles.rawButton}
              >
                <MaterialIcon color={C.pine} name="text_snippet" size={18} />
                <Text style={localStyles.rawButtonText}>
                  ดูข้อความ OCR ทั้งหมด
                </Text>
              </Pressable>
              {schedule ? (
                <View style={localStyles.semesterCard}>
                  <View style={localStyles.semesterHead}>
                    <View style={localStyles.semesterIcon}>
                      <MaterialIcon
                        color={C.sage}
                        name="date_range"
                        size={20}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={localStyles.semesterTitle}>
                        ช่วงภาคเรียน
                      </Text>
                      <Text style={localStyles.semesterSub}>
                        ระบบจะสร้างคลาสซ้ำทุกสัปดาห์
                      </Text>
                    </View>
                  </View>
                  {institutionType === "high-school" ? (
                    <View style={localStyles.termSelector}>
                      {([1, 2] as SchoolTerm[]).map((term) => (
                        <Pressable
                          key={term}
                          onPress={() => selectSchoolTerm(term)}
                          style={[
                            localStyles.termOption,
                            schoolTerm === term && localStyles.termOptionActive,
                          ]}
                        >
                          <Text
                            style={[
                              localStyles.termOptionText,
                              schoolTerm === term &&
                                localStyles.termOptionTextActive,
                            ]}
                          >
                            ภาคเรียนที่ {term}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <View style={localStyles.semesterDates}>
                    <SemesterDateButton
                      label="วันเปิดภาค"
                      onPress={() => setPickerTarget("start")}
                      value={thaiDateLabel(draft.semesterStart)}
                    />
                    <SemesterDateButton
                      label="วันปิดภาค"
                      onPress={() => setPickerTarget("end")}
                      value={thaiDateLabel(draft.semesterEnd)}
                    />
                  </View>
                  {pickerTarget ? (
                    <NativeDateTimePicker
                      accentColor={C.sage}
                      maximumDate={
                        pickerTarget === "start"
                          ? semesterEndDate
                          : semesterMaximumDate
                      }
                      minimumDate={
                        pickerTarget === "end" ? semesterStartDate : undefined
                      }
                      mode="date"
                      onDismiss={() => setPickerTarget(null)}
                      onValueChange={(_, selectedDate) =>
                        selectSemesterDate(selectedDate)
                      }
                      presentation="dialog"
                      value={
                        pickerTarget === "start"
                          ? semesterStartDate
                          : semesterEndDate
                      }
                    />
                  ) : null}
                  <Text style={localStyles.semesterHint}>
                    {institutionType === "high-school"
                      ? "ตั้งค่าตามภาคเรียนมัธยมโดยประมาณ แตะวันที่เพื่อแก้ตามปฏิทินของโรงเรียน"
                      : "ค่าเริ่มต้น 16 สัปดาห์ แตะวันที่เพื่อแก้ให้ตรงกับปฏิทินมหาวิทยาลัย"}
                  </Text>
                </View>
              ) : null}
              <Pressable
                accessibilityLabel="\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25"
                accessibilityRole="button"
                accessibilityState={{ disabled: saving }}
                disabled={saving}
                onPress={confirmAndSave}
                style={({ pressed }) => [
                  localStyles.saveButton,
                  pressed && !saving && localStyles.pressed,
                ]}
              >
                <LinearGradient
                  colors={
                    saveComplete
                      ? ["#789a75", "#4f754c"]
                      : result.scanType === "receipt"
                        ? ["#a7aac8", "#7f85ad"]
                        : ["#789a75", "#4f754c"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={localStyles.saveGradient}
                >
                  {saving && !saveComplete ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <MaterialIcon
                      color="#fff"
                      name={saveComplete ? "check_circle" : "check"}
                      size={20}
                    />
                  )}
                  <Text style={localStyles.saveText}>
                    {saveComplete
                      ? "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08"
                      : saving
                        ? "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01..."
                        : "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25"}
                  </Text>
                </LinearGradient>
              </Pressable>
              <Text style={localStyles.saveHint}>
                {result.scanType === "receipt"
                  ? "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e41\u0e25\u0e49\u0e27\u0e44\u0e1b\u0e2b\u0e19\u0e49\u0e32\u0e01\u0e32\u0e23\u0e40\u0e07\u0e34\u0e19\u0e2d\u0e31\u0e15\u0e42\u0e19\u0e21\u0e31\u0e15\u0e34"
                  : "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e41\u0e25\u0e49\u0e27\u0e44\u0e1b\u0e2b\u0e19\u0e49\u0e32\u0e1b\u0e0f\u0e34\u0e17\u0e34\u0e19\u0e2d\u0e31\u0e15\u0e42\u0e19\u0e21\u0e31\u0e15\u0e34"}
              </Text>
            </Card>
          ) : null}

          <Modal
            animationType="fade"
            onRequestClose={() => setPickerOpen(false)}
            transparent
            visible={pickerOpen}
          >
            <Pressable
              onPress={() => setPickerOpen(false)}
              style={localStyles.overlay}
            >
              <View
                onStartShouldSetResponder={() => true}
                style={[
                  localStyles.sheet,
                  { paddingBottom: pickerBottomPadding },
                ]}
              >
                <View style={localStyles.handle} />
                <Text style={localStyles.sheetTitle}>เพิ่มเอกสาร</Text>
                <Text style={localStyles.sheetText}>
                  ระบบจะตรวจชนิดเอกสารให้อัตโนมัติ
                </Text>
                <View style={localStyles.sourceRow}>
                  <SourceButton
                    icon="photo_camera"
                    label="ถ่ายภาพ"
                    onPress={() => pick("camera")}
                  />
                  <SourceButton
                    icon="photo_library"
                    label="เลือกรูป"
                    onPress={() => pick("library")}
                  />
                </View>
                <Pressable
                  onPress={() => setPickerOpen(false)}
                  style={localStyles.cancel}
                >
                  <Text style={localStyles.cancelText}>ยกเลิก</Text>
                </Pressable>
              </View>
            </Pressable>
          </Modal>
          <LoadingAndSuccessModal
            phase={feedback?.phase ?? "loading"}
            subtitle={feedback?.subtitle ?? ""}
            title={feedback?.title ?? ""}
            visible={Boolean(feedback)}
          />
        </ScrollView>
        {isImagePinned && result ? (
          <View
            pointerEvents="box-none"
            style={[
              localStyles.pinnedPreviewLayer,
              result.scanType === "receipt" && localStyles.pinnedReceiptLayer,
            ]}
          >
            <Pressable
              accessibilityHint="แตะเพื่อเปิดภาพเต็มจอและซูม"
              accessibilityLabel="เปิดภาพที่สแกนขนาดใหญ่"
              onPress={() => setImageViewerOpen(true)}
              style={localStyles.pinnedPreview}
            >
              <Image
                contentFit="contain"
                source={{ uri: imageUri }}
                style={[
                  localStyles.pinnedPreviewImage,
                  { height: pinnedPreviewHeight },
                ]}
              />
            </Pressable>
          </View>
        ) : null}
        <ScanImageViewer
          onClose={() => setImageViewerOpen(false)}
          uri={imageUri}
          visible={imageViewerOpen}
        />
        <ReceiptHtmlModal
          html={receiptHtml}
          onClose={() => setReceiptHtmlOpen(false)}
          visible={receiptHtmlOpen}
        />
      </View>
    </UserShell>
  );
}

function ReceiptItemInput({
  label,
  onChangeText,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
  return (
    <View style={localStyles.receiptItemInputWrap}>
      <Text style={localStyles.receiptItemInputLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={`แก้ไข${label}`}
        keyboardType="decimal-pad"
        onChangeText={onChangeText}
        placeholder="-"
        placeholderTextColor="#a6aaa2"
        selectTextOnFocus
        style={localStyles.receiptItemInput}
        value={value}
      />
    </View>
  );
}

function EditableRow({
  icon,
  keyboardType = "default",
  label,
  onChangeText,
  value,
}: {
  icon: string;
  keyboardType?: "decimal-pad" | "default";
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
  return (
    <View style={localStyles.dataRow}>
      <View style={localStyles.dataIcon}>
        <MaterialIcon color={C.sage} name={icon} size={19} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={localStyles.dataLabel}>{label}</Text>
        <TextInput
          accessibilityLabel={`แก้ไข${label}`}
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          placeholder="แตะเพื่อแก้ไข"
          placeholderTextColor="#a6aaa2"
          selectTextOnFocus
          style={localStyles.dataInput}
          value={value}
        />
      </View>
      <MaterialIcon color={C.sage} name="edit" size={15} />
    </View>
  );
}

function PickerDataRow({
  icon,
  label,
  onPress,
  value,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  value: string;
}) {
  return (
    <Pressable
      accessibilityLabel={`${decodeUnicodeEscapes(label)} ${decodeUnicodeEscapes(value)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        localStyles.dataRow,
        pressed && localStyles.pressed,
      ]}
    >
      <View style={localStyles.dataIcon}>
        <MaterialIcon color={C.sage} name={icon} size={19} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={localStyles.dataLabel}>{label}</Text>
        <Text style={localStyles.dataValue}>{value}</Text>
      </View>
      <MaterialIcon color={C.sage} name="expand_more" size={18} />
    </Pressable>
  );
}

function SmallInput({
  label,
  onChangeText,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
  return (
    <View style={localStyles.smallInputWrap}>
      <View style={localStyles.smallInputHead}>
        <Text style={localStyles.smallInputLabel}>{label}</Text>
        <MaterialIcon color={C.sage} name="edit" size={11} />
      </View>
      <TextInput
        accessibilityLabel={`แก้ไข${label}`}
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder="แตะเพื่อแก้ไข"
        placeholderTextColor="#a6aaa2"
        selectTextOnFocus
        style={localStyles.smallInput}
        value={value}
      />
    </View>
  );
}
function TimePickerButton({
  label,
  onPress,
  value,
}: {
  label: string;
  onPress: () => void;
  value: string;
}) {
  const visibleLabel = decodeUnicodeEscapes(label);
  const visibleValue = decodeUnicodeEscapes(value) || "แตะเพื่อเลือกเวลา";
  return (
    <Pressable
      accessibilityLabel={`${visibleLabel} ${visibleValue}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        localStyles.timePickerButton,
        pressed && localStyles.pressed,
      ]}
    >
      <Text style={localStyles.timePickerLabel}>{visibleLabel}</Text>
      <View style={localStyles.timePickerValue}>
        <MaterialIcon color={C.sage} name="schedule" size={16} />
        <Text style={localStyles.timePickerText}>{visibleValue}</Text>
        <MaterialIcon color={C.muted} name="expand_more" size={16} />
      </View>
    </Pressable>
  );
}
function SemesterDateButton({
  label,
  onPress,
  value,
}: {
  label: string;
  onPress: () => void;
  value: string;
}) {
  const visibleLabel = decodeUnicodeEscapes(label);
  const visibleValue = decodeUnicodeEscapes(value);
  return (
    <Pressable
      accessibilityLabel={`${visibleLabel} ${visibleValue}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        localStyles.semesterDateButton,
        pressed && localStyles.pressed,
      ]}
    >
      <Text style={localStyles.semesterDateLabel}>{visibleLabel}</Text>
      <View style={localStyles.semesterDateValue}>
        <MaterialIcon color={C.sage} name="calendar_month" size={16} />
        <Text style={localStyles.semesterDateText}>{visibleValue}</Text>
      </View>
    </Pressable>
  );
}
function SourceButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        localStyles.sourceButton,
        pressed && localStyles.pressed,
      ]}
    >
      <View style={localStyles.sourceIcon}>
        <MaterialIcon color={C.sage} name={icon} size={27} />
      </View>
      <Text style={localStyles.sourceLabel}>{label}</Text>
    </Pressable>
  );
}

const shadow = {
  shadowColor: C.pine,
  shadowOffset: { height: 8, width: 0 },
  shadowOpacity: 0.12,
  shadowRadius: 18,
};
const localStyles = StyleSheet.create({
  academicLabel: { color: C.muted, fontFamily: F.r, fontSize: 10 },
  academicRow: {
    alignItems: "center",
    backgroundColor: "#f2f5ef",
    borderRadius: 13,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    padding: 12,
  },
  academicValue: { color: C.pine, fontFamily: F.b, fontSize: 11 },
  cancel: { alignItems: "center", marginTop: 12, padding: 12 },
  cancelText: { color: C.muted, fontFamily: F.s, fontSize: 11 },
  changeButton: {
    alignItems: "center",
    backgroundColor: C.soft,
    borderRadius: 17,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  clearButton: {
    alignItems: "center",
    backgroundColor: "#f8ecea",
    borderColor: "#efd2ce",
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 43,
  },
  clearText: { color: "#a95758", fontFamily: F.s, fontSize: 9 },
  confidence: {
    alignItems: "center",
    backgroundColor: C.soft,
    borderRadius: 15,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  confidenceText: { color: C.sage, fontFamily: F.b, fontSize: 10 },
  courseCard: {
    backgroundColor: "#f6f8f4",
    borderColor: "#e4e9e1",
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  courseCode: { color: C.pine, fontFamily: F.b, fontSize: 13 },
  courseCodeInput: {
    color: C.pine,
    flex: 1,
    fontFamily: F.b,
    fontSize: 13,
    minHeight: 34,
    paddingHorizontal: 8,
  },
  courseFields: { gap: 7, marginTop: 9 },
  courseMeta: { gap: 5, marginTop: 9 },
  courseNumber: {
    alignItems: "center",
    backgroundColor: C.sage,
    borderRadius: 11,
    height: 23,
    justifyContent: "center",
    width: 23,
  },
  courseNumberText: { color: "#fff", fontFamily: F.b, fontSize: 9 },
  courseTop: { alignItems: "center", flexDirection: "row", gap: 8 },
  dataGroup: { gap: 7 },
  dataIcon: {
    alignItems: "center",
    backgroundColor: C.soft,
    borderRadius: 13,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  dataInput: {
    color: C.pine,
    fontFamily: F.s,
    fontSize: 11,
    marginTop: 1,
    minHeight: 28,
    padding: 0,
  },
  dataLabel: { color: C.muted, fontFamily: F.r, fontSize: 8 },
  dataRow: {
    alignItems: "center",
    backgroundColor: "#f6f8f4",
    borderRadius: 14,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  dataValue: { color: C.pine, fontFamily: F.s, fontSize: 11, marginTop: 1 },
  empty: { alignItems: "center", gap: 8, padding: 22 },
  emptyText: {
    color: C.muted,
    fontFamily: F.r,
    fontSize: 9,
    textAlign: "center",
  },
  fab: {
    ...shadow,
    borderColor: "#fff",
    borderRadius: 38,
    borderWidth: 5,
    marginTop: 18,
  },
  fabGradient: {
    alignItems: "center",
    borderRadius: 32,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  fabLabel: { color: C.sage, fontFamily: F.s, fontSize: 9, marginTop: 8 },
  handle: {
    alignSelf: "center",
    backgroundColor: "#d1d6cd",
    borderRadius: 3,
    height: 5,
    marginBottom: 17,
    width: 44,
  },
  hero: { overflow: "hidden", padding: 0 },
  heroGradient: { alignItems: "center", borderRadius: 18, padding: 20 },
  heroIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,.86)",
    borderRadius: 20,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  heroText: {
    color: C.muted,
    fontFamily: F.r,
    fontSize: 9,
    lineHeight: 15,
    marginTop: 5,
    maxWidth: 280,
    textAlign: "center",
  },
  heroTitle: { color: C.pine, fontFamily: F.b, fontSize: 17, marginTop: 10 },
  htmlModal: { backgroundColor: "#f1f4ed", flex: 1 },
  htmlModalClose: {
    alignItems: "center",
    backgroundColor: C.soft,
    borderRadius: 19,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  htmlModalHeader: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderBottomColor: "#e3e9df",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  htmlModalSubtitle: { color: C.muted, fontFamily: F.r, fontSize: 9, marginTop: 2 },
  htmlModalTitle: { color: C.pine, fontFamily: F.b, fontSize: 16 },
  htmlWebView: { backgroundColor: "#f1f4ed", flex: 1 },
  meta: { alignItems: "center", flexDirection: "row", gap: 5 },
  metaText: { color: C.muted, fontFamily: F.r, fontSize: 8 },
  overlay: {
    backgroundColor: "rgba(31,42,25,.42)",
    flex: 1,
    justifyContent: "flex-end",
  },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  preview: {
    backgroundColor: C.mist,
    borderRadius: 15,
    height: 220,
    marginTop: 12,
    width: "100%",
  },
  rawButton: {
    alignItems: "center",
    backgroundColor: "#eef2e9",
    borderRadius: 13,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    marginTop: 13,
    minHeight: 44,
  },
  rawButtonText: { color: C.pine, fontFamily: F.s, fontSize: 10 },
  receiptHtmlButton: {
    alignItems: "center",
    backgroundColor: "#eef3eb",
    borderColor: "#dce7d8",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 47,
  },
  receiptHtmlButtonText: { color: C.sage, fontFamily: F.s, fontSize: 10 },
  receiptItemEditor: {
    backgroundColor: "#fff",
    borderColor: "#e4e9e1",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    padding: 9,
  },
  receiptItemInput: {
    color: C.pine,
    fontFamily: F.s,
    fontSize: 9,
    minHeight: 25,
    padding: 0,
  },
  receiptItemInputLabel: { color: C.muted, fontFamily: F.r, fontSize: 7 },
  receiptItemInputWrap: {
    backgroundColor: "#f6f8f4",
    borderRadius: 9,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  receiptItemDiscountRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: 7,
  },
  receiptItemDiscountText: {
    color: C.sage,
    flex: 1,
    fontFamily: F.s,
    fontSize: 8,
  },
  receiptItemNameInput: {
    color: C.pine,
    flex: 1,
    fontFamily: F.s,
    fontSize: 10,
    minHeight: 30,
    padding: 0,
  },
  receiptItemNumber: {
    alignItems: "center",
    backgroundColor: C.sage,
    borderRadius: 10,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  receiptItemNumbers: { flexDirection: "row", gap: 6, marginTop: 7 },
  receiptItemNumberText: { color: "#fff", fontFamily: F.b, fontSize: 8 },
  receiptItemsCard: {
    backgroundColor: "#f6f8f4",
    borderColor: "#e4e9e1",
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
  },
  receiptItemsHeader: { alignItems: "center", flexDirection: "row", gap: 8 },
  receiptItemsSubtitle: { color: C.muted, fontFamily: F.r, fontSize: 8, marginTop: 1 },
  receiptItemsTitle: { color: C.pine, fontFamily: F.b, fontSize: 11 },
  receiptItemTop: { alignItems: "center", flexDirection: "row", gap: 8 },
  rescanButton: {
    alignItems: "center",
    backgroundColor: "#eef3eb",
    borderColor: "#dce7d8",
    borderRadius: 13,
    borderWidth: 1,
    flex: 1.2,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 43,
  },
  rescanText: { color: C.sage, fontFamily: F.s, fontSize: 9 },
  resultEyebrow: { color: C.sage, fontFamily: F.s, fontSize: 8 },
  resultHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 13,
  },
  resultIcon: {
    alignItems: "center",
    borderRadius: 16,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  resultTitle: { color: C.pine, fontFamily: F.b, fontSize: 12, marginTop: 1 },
  scanActions: { flexDirection: "row", gap: 8 },
  sectionHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionSub: { color: C.muted, fontFamily: F.r, fontSize: 8, marginTop: 2 },
  sectionTitle: { color: C.pine, fontFamily: F.b, fontSize: 13 },
  sheet: {
    ...shadow,
    backgroundColor: "#fbfcf8",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 26,
  },
  sheetText: { color: C.muted, fontFamily: F.r, fontSize: 9, marginTop: 3 },
  sheetTitle: { color: C.pine, fontFamily: F.b, fontSize: 17 },
  smallInput: {
    color: C.pine,
    fontFamily: F.s,
    fontSize: 9,
    minHeight: 26,
    padding: 0,
  },
  smallInputLabel: { color: C.muted, fontFamily: F.r, fontSize: 7 },
  smallInputWrap: {
    backgroundColor: "#fff",
    borderRadius: 10,
    flex: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  sourceButton: {
    alignItems: "center",
    backgroundColor: "#f1f5ee",
    borderRadius: 17,
    flex: 1,
    minHeight: 106,
    padding: 16,
  },
  sourceIcon: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 18,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  sourceLabel: { color: C.pine, fontFamily: F.s, fontSize: 11, marginTop: 8 },
  sourceRow: { flexDirection: "row", gap: 10, marginTop: 17 },
  timeInputs: { flexDirection: "row", gap: 7 },
  historyButton: {
    ...shadow,
    alignItems: "center",
    backgroundColor: C.sage,
    borderColor: "#fff",
    borderRadius: 21,
    borderWidth: 3,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  editNotice: {
    alignItems: "center",
    backgroundColor: "#eef4ea",
    borderColor: "#dce8d7",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    marginBottom: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  editNoticeText: { color: "#587156", flex: 1, fontFamily: F.s, fontSize: 9 },
  reviewWarning: {
    alignItems: "flex-start",
    backgroundColor: "#fff5e7",
    borderColor: "#efd7b2",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    marginBottom: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  reviewWarningText: {
    color: "#79572f",
    flex: 1,
    fontFamily: F.s,
    fontSize: 9,
    lineHeight: 14,
  },
  extractedRange: {
    alignItems: "center",
    backgroundColor: "#edf3ea",
    borderRadius: 9,
    flexDirection: "row",
    gap: 5,
    marginTop: 7,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  extractedRangeText: { color: "#60705d", fontFamily: F.m, fontSize: 8 },
  smallInputHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  semesterCard: {
    backgroundColor: "#eef3eb",
    borderColor: "#dfe8da",
    borderRadius: 15,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  semesterDateButton: {
    backgroundColor: "#fff",
    borderColor: "#dfe7da",
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    minHeight: 58,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  semesterDateLabel: { color: C.muted, fontFamily: F.r, fontSize: 7 },
  semesterDateText: { color: C.pine, fontFamily: F.s, fontSize: 9 },
  semesterDateValue: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: 5,
  },
  semesterDates: { flexDirection: "row", gap: 7, marginTop: 10 },
  semesterHead: { alignItems: "center", flexDirection: "row", gap: 9 },
  semesterHint: {
    color: C.muted,
    fontFamily: F.r,
    fontSize: 8,
    lineHeight: 13,
    marginTop: 8,
  },
  semesterIcon: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 13,
    height: 39,
    justifyContent: "center",
    width: 39,
  },
  semesterSub: { color: C.muted, fontFamily: F.r, fontSize: 8, marginTop: 1 },
  semesterTitle: { color: C.pine, fontFamily: F.b, fontSize: 12 },
  examSectionHeader: {alignItems: 'center', backgroundColor: '#f2f6ef', borderRadius: 12, flexDirection: 'row', gap: 8, marginTop: 7, padding: 9},
  examSectionIcon: {alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 10, height: 31, justifyContent: 'center', width: 31},
  examSectionSub: {color: C.muted, fontFamily: F.r, fontSize: 7, marginTop: 1},
  examSectionTitle: {color: C.pine, fontFamily: F.b, fontSize: 10},
  termOption: {
    alignItems: "center",
    borderRadius: 10,
    flex: 1,
    minHeight: 34,
    justifyContent: "center",
  },
  termOptionActive: {
    backgroundColor: "#fff",
    shadowColor: C.pine,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 7,
  },
  termOptionText: { color: C.muted, fontFamily: F.s, fontSize: 9 },
  termOptionTextActive: { color: C.sage },
  termSelector: {
    backgroundColor: "#dde8d9",
    borderRadius: 13,
    flexDirection: "row",
    gap: 4,
    marginTop: 10,
    padding: 4,
  },
  saveButton: {
    ...shadow,
    borderRadius: 14,
    marginTop: 10,
    overflow: "hidden",
  },
  saveGradient: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 16,
  },
  saveHint: {
    color: C.muted,
    fontFamily: F.r,
    fontSize: 8,
    marginTop: 7,
    textAlign: "center",
  },
  saveText: { color: "#fff", fontFamily: F.b, fontSize: 11 },
  timePickerButton: {
    backgroundColor: "#fff",
    borderColor: "#dfe7da",
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    minHeight: 57,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  timePickerLabel: { color: C.muted, fontFamily: F.r, fontSize: 7 },
  timePickerText: { color: C.pine, flex: 1, fontFamily: F.b, fontSize: 11 },
  timePickerValue: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: 5,
  },
  pinnedPreview: {
    backgroundColor: "#fff",
    borderColor: "rgba(255,255,255,.8)",
    borderRadius: 15,
    borderWidth: 1,
    boxShadow: "0 8px 18px rgba(44, 52, 27, 0.12)",
    overflow: "hidden",
  },
  pinnedPreviewImage: { backgroundColor: C.mist, height: 112, width: "100%" },
  pinnedPreviewLayer: {
    left: 18,
    position: "absolute",
    right: 18,
    top: 0,
    zIndex: 10,
  },
  pinnedReceiptLayer: {
    left: undefined,
    right: 12,
    top: 8,
    width: 176,
  },
  scanScroll: { flexGrow: 1, paddingBottom: 18 },
  scanShell: { flex: 1 },
  zoomCanvas: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
    padding: 22,
  },
  zoomClose: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    position: "absolute",
    right: 20,
    width: 40,
    zIndex: 2,
  },
  zoomImage: { height: "100%", width: "100%" },
  zoomImageFrame: { height: "100%", width: "100%" },
  zoomOverlay: { backgroundColor: "rgba(20, 28, 18, .92)", flex: 1 },
});
