// src/app/seller/index.tsx
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import {
  AlertCircle,
  Bell,
  Camera,
  CheckCircle2,
  Clock,
  CreditCard,
  Lock,
  Megaphone,
  MessageSquare,
  Plus,
  ShoppingBag,
  Sprout,
  Upload,
  X,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SemesterFeeCard } from "../../components/SemesterFeeCard";
import { Colors } from "../../constants/theme";
import { getCurrentUser } from "../../lib/authHelpers";
import { getSellerSemesterFeeSummary } from "../../lib/sellerSemesterPayments";
import { getCurrentSemester } from "../../lib/semesterFee";
import { supabase } from "../../lib/supabase";
import {
  createImageUploadPath,
  uploadPrivateImageToSupabase,
  type UploadableImageAsset,
} from "../../lib/uploadImageToSupabase";
import { verifyGcashReceiptImage } from "../../lib/verifyGcashReceipt";

const ADMIN_GCASH_NUMBER = "0956 078 6790";
const ADMIN_GCASH_NAME = "MA••A N•• J•• P. (ADSSU AgriHub)";

export default function SellerDashboardScreen() {
  const [unitName, setUnitName] = useState("Agri Dept - Unit 3");
  const [department, setDepartment] = useState("Agriculture Department");
  const [verificationStatus, setVerificationStatus] = useState<
    "pending" | "verified" | "rejected"
  >("pending");
  const [harvests, setHarvests] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [semesterFeePaid, setSemesterFeePaid] = useState(0);
  const [semesterFeePaymentPending, setSemesterFeePaymentPending] =
    useState(false);
  const [semesterFeeError, setSemesterFeeError] = useState<string | null>(null);

  // Semester Booth Fee GCash Payment Modal State
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPaymentAmount, setSelectedPaymentAmount] = useState<
    20 | 30 | 50
  >(30);
  const [receiptImageAsset, setReceiptImageAsset] =
    useState<UploadableImageAsset | null>(null);
  const [receiptImageUri, setReceiptImageUri] = useState<string | null>(null);
  const [verifyingReceipt, setVerifyingReceipt] = useState(false);
  const [verifiedRefNo, setVerifiedRefNo] = useState<string | null>(null);
  const [uploadingPayment, setUploadingPayment] = useState(false);
  const [paymentModalError, setPaymentModalError] = useState<string | null>(
    null,
  );

  const router = useRouter();

  function showMessage(title: string, msg: string) {
    if (Platform.OS === "web") {
      window.alert(`${title}: ${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  }

  const loadSellerData = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return;
      const feeSummaryPromise = getSellerSemesterFeeSummary(user.id)
        .then((summary) => ({ summary, error: null as string | null }))
        .catch((error: unknown) => ({
          summary: null,
          error:
            error instanceof Error
              ? error.message
              : "Could not load fee status.",
        }));
      const [
        { data: profile, error: profileError },
        { data: products, error: productsError },
        { data: orderRows, error: ordersError },
        feeResult,
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, store_name, department, verification_status")
          .eq("id", user.id)
          .single(),
        supabase.from("products").select("*").eq("seller_id", user.id),
        supabase.from("orders").select("*").eq("seller_id", user.id),
        feeSummaryPromise,
      ]);
      if (profileError) throw profileError;
      if (productsError) throw productsError;
      if (ordersError) throw ordersError;
      setUnitName(
        profile.store_name || profile.full_name || "Agri Dept - Unit 3",
      );
      setDepartment(profile.department || "Agriculture Department");
      setVerificationStatus(profile.verification_status || "pending");
      setHarvests(products || []);
      setOrders(orderRows || []);
      setSemesterFeeError(feeResult.error);
      if (feeResult.summary) {
        setSemesterFeePaid(feeResult.summary.amountPaid);
        setSemesterFeePaymentPending(feeResult.summary.pendingReview);
      }
    } catch (error) {
      console.error("Failed to load seller dashboard:", error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSellerData();
    }, [loadSellerData]),
  );

  function handleOpenPaymentModal(amount: 20 | 30 | 50) {
    setSelectedPaymentAmount(amount);
    setReceiptImageAsset(null);
    setReceiptImageUri(null);
    setVerifiedRefNo(null);
    setPaymentModalError(null);
    setShowPaymentModal(true);
  }

  async function runReceiptScan(
    asset: UploadableImageAsset,
    targetAmount: 20 | 30 | 50,
  ) {
    setVerifyingReceipt(true);
    setVerifiedRefNo(null);
    setPaymentModalError(null);
    const result = await verifyGcashReceiptImage(asset, targetAmount);
    setVerifyingReceipt(false);

    if (!result.isValid || !result.referenceNumber) {
      const msg =
        result.reason ||
        "Receipt is unclear or not readable. Please upload a valid GCash Express Send receipt.";
      setPaymentModalError(msg);
      showMessage("Invalid Receipt", msg);
      return;
    }

    setVerifiedRefNo(result.referenceNumber);
  }

  async function handleSelectAmount(amount: 20 | 30 | 50) {
    setSelectedPaymentAmount(amount);
    if (receiptImageAsset) {
      await runReceiptScan(receiptImageAsset, amount);
    }
  }

  async function takeReceiptPhoto() {
    try {
      if (Platform.OS !== "web") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setPaymentModalError(
            "Camera permission is required to take a photo of your GCash receipt.",
          );
          return;
        }
      }

      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });
      if (!res.canceled && res.assets?.length > 0) {
        const asset = res.assets[0];
        setReceiptImageAsset(asset);
        setReceiptImageUri(asset.uri);
        await runReceiptScan(asset, selectedPaymentAmount);
      }
    } catch (error) {
      setVerifyingReceipt(false);
      setPaymentModalError(
        error instanceof Error
          ? error.message
          : "Could not open camera. You can still upload from your gallery.",
      );
    }
  }

  async function pickReceiptPhoto() {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });
      if (!res.canceled && res.assets?.length > 0) {
        const asset = res.assets[0];
        setReceiptImageAsset(asset);
        setReceiptImageUri(asset.uri);
        await runReceiptScan(asset, selectedPaymentAmount);
      }
    } catch (error) {
      setVerifyingReceipt(false);
      setPaymentModalError(
        error instanceof Error
          ? error.message
          : "Could not select receipt image.",
      );
    }
  }

  async function handleSubmitPayment() {
    if (!receiptImageAsset) {
      setPaymentModalError(
        "Please take a photo or upload a screenshot of your GCash payment receipt.",
      );
      return;
    }
    if (paymentModalError || !verifiedRefNo) {
      const msg =
        paymentModalError ||
        "Invalid Receipt: Please upload a valid GCash receipt matching the required details.";
      setPaymentModalError(msg);
      showMessage("Invalid Receipt", msg);
      return;
    }

    const user = await getCurrentUser();
    if (!user) {
      router.replace("/auth/login");
      return;
    }

    setUploadingPayment(true);
    setPaymentModalError(null);
    try {
      const currentSemester = getCurrentSemester();
      const receiptPath = await uploadPrivateImageToSupabase(
        receiptImageAsset,
        "payment-receipts",
        createImageUploadPath(user.id, receiptImageAsset.mimeType),
      );

      const { error: rpcError } = await supabase.rpc(
        "auto_approve_semester_payment",
        {
          p_amount: selectedPaymentAmount,
          p_semester: currentSemester,
          p_receipt_path: receiptPath,
          p_reference_number: verifiedRefNo,
        },
      );
      if (rpcError) throw rpcError;

      setShowPaymentModal(false);
      setReceiptImageUri(null);
      setReceiptImageAsset(null);
      setVerifiedRefNo(null);
      await loadSellerData();
      showMessage(
        "Payment Auto-Approved!",
        `GCash Ref No. ${verifiedRefNo} (₱${selectedPaymentAmount}.00) has been verified and approved automatically!`,
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" &&
              err !== null &&
              "message" in err &&
              typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "Invalid Receipt: Could not verify and record your receipt.";
      setPaymentModalError(msg);
      showMessage("Invalid Receipt", msg);
    } finally {
      setUploadingPayment(false);
    }
  }

  const isVerified = verificationStatus === "verified";
  const now = new Date();
  const semesterStart = new Date(
    now.getFullYear(),
    now.getMonth() >= 7 ? 7 : 0,
    1,
  ).getTime();
  const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const revenueOrders = orders.filter(
    (order) => order.order_status !== "cancelled",
  );
  const totalRevenue = revenueOrders
    .filter(
      (order) =>
        order.created_at &&
        new Date(order.created_at).getTime() >= semesterStart,
    )
    .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const thisWeekRevenue = revenueOrders
    .filter(
      (order) =>
        order.created_at && new Date(order.created_at).getTime() >= weekStart,
    )
    .reduce((sum, order) => sum + Number(order.total_amount || 0), 0);

  const preOrderCount = harvests.filter(
    (h) => h.listing_type === "in_ground_preorder",
  ).length;
  const activeListings = harvests.filter(
    (listing) =>
      listing.status === "published" &&
      Number(listing.available_stock || 0) > 0,
  );
  const pendingOrders = orders.filter(
    (order) => order.order_status === "pending",
  );
  const lowStockListings = activeListings.filter(
    (listing) =>
      Number(listing.available_stock || 0) > 0 &&
      Number(listing.available_stock || 0) <= 5,
  );

  function handlePostPress() {
    if (!isVerified) {
      return showMessage(
        "Verification Required",
        "Your Seller / Farm Unit account is still PENDING Admin review. You can post harvests once approved by the Campus Admin.",
      );
    }
    router.push("/seller/post-harvest");
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScrollView
        contentContainerStyle={styles.dashboardContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Green Revenue Header */}
        <View style={styles.header}>
          <View style={styles.unitRow}>
            <View style={styles.unitAvatar}>
              <Sprout size={18} color="#FDE68A" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.unitName} numberOfLines={1}>
                {unitName}
              </Text>
              <Text style={styles.unitSub} numberOfLines={1}>
                {department} • Seller Dashboard
              </Text>
            </View>

            <View
              style={[
                styles.statusBadge,
                !isVerified && { backgroundColor: "#F59E0B" },
              ]}
            >
              <Text style={styles.statusBadgeText}>
                {isVerified ? "● VERIFIED" : "● PENDING"}
              </Text>
            </View>

            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.bellBtn}
                accessibilityRole="button"
                accessibilityLabel="Open chats"
                accessibilityHint="View conversations for your orders"
                onPress={() => router.push("/seller-screens/messages")}
              >
                <MessageSquare size={17} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.bellBtn}
                accessibilityRole="button"
                accessibilityLabel="Open orders"
                onPress={() => router.push("/seller/orders")}
              >
                <Bell size={16} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.revRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.revLabel}>TOTAL REVENUE THIS SEMESTER</Text>
              <Text style={styles.revAmount}>
                ₱{totalRevenue.toLocaleString()}
              </Text>
              <Text style={styles.revSub}>
                This week: ₱{thisWeekRevenue.toLocaleString()} • {orders.length}{" "}
                orders
              </Text>
            </View>

            <View style={styles.weeklyBox}>
              <Text style={styles.weeklyLabel}>THIS WEEK</Text>
              <Text style={styles.weeklyAmount}>
                ₱{thisWeekRevenue.toLocaleString()}
              </Text>
            </View>
          </View>
        </View>

        <SemesterFeeCard
          amountPaid={semesterFeePaid}
          pendingReview={semesterFeePaymentPending}
          error={semesterFeeError}
          onPay={handleOpenPaymentModal}
          onPress={() =>
            handleOpenPaymentModal(semesterFeePaid >= 30 ? 20 : 30)
          }
        />

        {!isVerified && (
          <View style={styles.pendingBanner}>
            <AlertCircle size={20} color="#B45309" />
            <View style={{ flex: 1 }}>
              <Text style={styles.pendingTitle}>
                {verificationStatus === "rejected"
                  ? "Verification Rejected"
                  : "Awaiting Admin Verification"}
              </Text>
              <Text style={styles.pendingDesc}>
                {verificationStatus === "rejected"
                  ? "Your unit registration was declined. Please update your ID in Profile."
                  : "Campus Admin is reviewing your ID. Posting harvests is locked until verified."}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickActions}
        >
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => router.push("/seller/inventory")}
          >
            <ShoppingBag size={19} color={Colors.primary} />
            <Text style={styles.quickActionTitle}>Manage Inventory</Text>
            <Text style={styles.quickActionSub}>Update stock and prices</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => router.push("/seller-screens/sponsor")}
          >
            <Megaphone size={19} color={Colors.primary} />
            <Text style={styles.quickActionTitle}>Sponsor My Store</Text>
            <Text style={styles.quickActionSub}>Request a placement</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => router.push("/seller/profile")}
          >
            <CreditCard size={19} color={Colors.primary} />
            <Text style={styles.quickActionTitle}>Store Settings</Text>
            <Text style={styles.quickActionSub}>
              Contact and pickup details
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.kpiGrid}>
          <TouchableOpacity
            style={styles.kpiCard}
            onPress={() => router.push("/seller/inventory")}
          >
            <View style={styles.kpiTop}>
              <View style={[styles.kpiIconBox, { backgroundColor: "#DCFCE7" }]}>
                <ShoppingBag size={16} color={Colors.primary} />
              </View>
              <Text style={styles.kpiBadge}>Published</Text>
            </View>
            <Text style={styles.kpiVal}>{activeListings.length}</Text>
            <Text style={styles.kpiLbl}>Active Listings</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.kpiCard}
            onPress={() => router.push("/seller/orders")}
          >
            <View style={styles.kpiTop}>
              <View style={[styles.kpiIconBox, { backgroundColor: "#DBEAFE" }]}>
                <Bell size={16} color="#2563EB" />
              </View>
              <Text style={styles.kpiBadge}>Action needed</Text>
            </View>
            <Text style={styles.kpiVal}>{pendingOrders.length}</Text>
            <Text style={styles.kpiLbl}>Pending Orders</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.kpiCard}
            onPress={() => router.push("/seller/inventory")}
          >
            <View style={styles.kpiTop}>
              <View style={[styles.kpiIconBox, { backgroundColor: "#FEF3C7" }]}>
                <AlertCircle size={16} color="#B45309" />
              </View>
              <Text style={[styles.kpiBadge, styles.warningBadge]}>
                Restock
              </Text>
            </View>
            <Text style={styles.kpiVal}>{lowStockListings.length}</Text>
            <Text style={styles.kpiLbl}>Low-Stock Alerts</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.kpiCard}
            onPress={() => router.push("/seller/inventory")}
          >
            <View style={styles.kpiTop}>
              <View style={[styles.kpiIconBox, { backgroundColor: "#DBEAFE" }]}>
                <Clock size={16} color="#2563EB" />
              </View>
              <Text style={styles.kpiBadge}>Upcoming</Text>
            </View>
            <Text style={styles.kpiVal}>{preOrderCount}</Text>
            <Text style={styles.kpiLbl}>Pre-Order Listings</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Active Listings</Text>
          <TouchableOpacity onPress={() => router.push("/seller/inventory")}>
            <Text style={styles.linkText}>Manage ›</Text>
          </TouchableOpacity>
        </View>

        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          {activeListings.length === 0 ? (
            <View style={styles.emptyBox}>
              <Sprout size={28} color={Colors.primary} />
              <Text style={styles.emptyTitle}>No Harvest Listings Yet</Text>
              <Text style={styles.emptySub}>
                {isVerified
                  ? "Tap '+ Post New Harvest' below to list your fresh crops."
                  : "Once verified by Admin, you can start posting harvests here."}
              </Text>
            </View>
          ) : (
            activeListings.slice(0, 5).map((item) => {
              const total = Number(item.total_stock || 1);
              const avail = Number(item.available_stock || 0);
              const pct = Math.min(100, Math.round((avail / total) * 100));
              const isLow = pct <= 25;

              return (
                <View key={item.id} style={styles.harvestRow}>
                  <Image
                    source={{
                      uri: item.image_url?.startsWith("http")
                        ? item.image_url
                        : "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=200",
                    }}
                    style={styles.thumb}
                  />
                  <View style={{ flex: 1 }}>
                    <View style={styles.hTopLine}>
                      <Text style={styles.hTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <View
                        style={[
                          styles.typeBadge,
                          isLow && { backgroundColor: "#FEF2F2" },
                          item.listing_type === "in_ground_preorder" && {
                            backgroundColor: "#DBEAFE",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.typeText,
                            isLow && { color: Colors.danger },
                            item.listing_type === "in_ground_preorder" && {
                              color: "#1D4ED8",
                            },
                          ]}
                        >
                          {item.listing_type === "in_ground_preorder"
                            ? "Pre-Order"
                            : isLow
                              ? `${avail} left`
                              : "Selling fast"}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.hMeta}>
                      ₱{item.price_per_unit}/{item.unit} • {avail}/{total}{" "}
                      {item.unit} available
                    </Text>

                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${pct}%`,
                            backgroundColor: isLow ? "#F59E0B" : Colors.primary,
                          },
                        ]}
                      />
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Floating + Post New Harvest Button */}
      <TouchableOpacity
        style={[styles.fab, !isVerified && { backgroundColor: "#6B7280" }]}
        onPress={handlePostPress}
      >
        {isVerified ? (
          <Plus size={18} color="#FFF" />
        ) : (
          <Lock size={16} color="#FFF" />
        )}
        <Text style={styles.fabText}>
          {isVerified ? "Post New Harvest" : "Verification Pending"}
        </Text>
      </TouchableOpacity>

      {/* Direct GCash Booth Fee Payment Modal */}
      <Modal
        visible={showPaymentModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!uploadingPayment) setShowPaymentModal(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Semester Booth Fee</Text>
                <Text style={styles.modalSubtitle}>
                  Auto-Verified GCash Payment • {getCurrentSemester()}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowPaymentModal(false)}
                disabled={uploadingPayment}
                style={styles.modalCloseBtn}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalScrollContent}
              bounces={false}
              keyboardShouldPersistTaps="handled"
            >
              {semesterFeePaid === 0 ? (
                <View style={styles.amountToggleRow}>
                  <TouchableOpacity
                    style={[
                      styles.amountToggleBtn,
                      selectedPaymentAmount === 30 &&
                        styles.amountToggleBtnActive,
                    ]}
                    onPress={() => void handleSelectAmount(30)}
                  >
                    <Text
                      style={[
                        styles.amountToggleText,
                        selectedPaymentAmount === 30 &&
                          styles.amountToggleTextActive,
                      ]}
                    >
                      ₱30 Installment
                    </Text>
                    <Text
                      style={[
                        styles.amountToggleSub,
                        selectedPaymentAmount === 30 && { color: "#D8F3DC" },
                      ]}
                    >
                      Unlock posting
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.amountToggleBtn,
                      selectedPaymentAmount === 50 &&
                        styles.amountToggleBtnActive,
                    ]}
                    onPress={() => void handleSelectAmount(50)}
                  >
                    <Text
                      style={[
                        styles.amountToggleText,
                        selectedPaymentAmount === 50 &&
                          styles.amountToggleTextActive,
                      ]}
                    >
                      ₱50 Full Fee
                    </Text>
                    <Text
                      style={[
                        styles.amountToggleSub,
                        selectedPaymentAmount === 50 && { color: "#D8F3DC" },
                      ]}
                    >
                      Full semester
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.amountPillFixed}>
                  <Text style={styles.amountPillFixedText}>
                    Paying Remaining Balance: ₱{selectedPaymentAmount}
                  </Text>
                </View>
              )}

              <View style={styles.adminGcashBox}>
                <View style={styles.gcashBadge}>
                  <Text style={styles.gcashG}>G</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.adminGcashLabel}>
                    Send Payment To (Official ADSSU GCash):
                  </Text>
                  <Text style={styles.adminGcashNumber}>
                    {ADMIN_GCASH_NUMBER}
                  </Text>
                  <Text style={styles.adminGcashName}>{ADMIN_GCASH_NAME}</Text>
                </View>
              </View>

              <Text style={styles.modalInstructionText}>
                1. Open GCash and send{" "}
                <Text style={{ fontWeight: "800", color: Colors.primary }}>
                  ₱{selectedPaymentAmount}.00
                </Text>{" "}
                to {ADMIN_GCASH_NUMBER}.{"\n"}
                2. Take a photo or screenshot of your Express Send receipt.
                {"\n"}
                3. Upload below (tap Retake or Choose File anytime to replace).
              </Text>

              {receiptImageUri ? (
                <View
                  style={[
                    styles.modalReceiptUploadBox,
                    paymentModalError && {
                      borderColor: Colors.danger,
                      backgroundColor: "#FEF2F2",
                    },
                  ]}
                >
                  <Image
                    source={{ uri: receiptImageUri }}
                    style={styles.modalReceiptPreview}
                    accessibilityLabel="Selected GCash receipt"
                  />
                  <View style={styles.receiptActionChipsRow}>
                    <TouchableOpacity
                      style={styles.changeReceiptChip}
                      onPress={takeReceiptPhoto}
                      disabled={verifyingReceipt || uploadingPayment}
                    >
                      <Camera size={13} color="#FFF" />
                      <Text style={styles.changeReceiptChipText}>Retake</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.changeReceiptChip}
                      onPress={pickReceiptPhoto}
                      disabled={verifyingReceipt || uploadingPayment}
                    >
                      <Upload size={13} color="#FFF" />
                      <Text style={styles.changeReceiptChipText}>
                        Choose File
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.uploadOptionsRow}>
                  <TouchableOpacity
                    style={styles.uploadOptionCard}
                    onPress={takeReceiptPhoto}
                    disabled={verifyingReceipt || uploadingPayment}
                  >
                    <View style={styles.uploadOptionIcon}>
                      <Camera size={22} color={Colors.primary} />
                    </View>
                    <Text style={styles.uploadOptionTitle}>Take Photo</Text>
                    <Text style={styles.uploadOptionSub}>Use camera</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.uploadOptionCard}
                    onPress={pickReceiptPhoto}
                    disabled={verifyingReceipt || uploadingPayment}
                  >
                    <View style={styles.uploadOptionIcon}>
                      <Upload size={22} color={Colors.primary} />
                    </View>
                    <Text style={styles.uploadOptionTitle}>Upload Receipt</Text>
                    <Text style={styles.uploadOptionSub}>From gallery</Text>
                  </TouchableOpacity>
                </View>
              )}

              {verifyingReceipt ? (
                <View style={styles.scanningBanner}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={styles.scanningText}>
                    Scanning receipt automatically...
                  </Text>
                </View>
              ) : paymentModalError ? (
                <View style={styles.modalErrorBanner}>
                  <AlertCircle size={18} color={Colors.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalErrorTitle}>Invalid Receipt</Text>
                    <Text style={styles.modalErrorText}>
                      {paymentModalError}
                    </Text>
                  </View>
                </View>
              ) : verifiedRefNo ? (
                <View style={styles.validReceiptBanner}>
                  <CheckCircle2 size={18} color="#15803D" />
                  <Text style={styles.validReceiptText}>
                    Valid GCash Receipt • Ref No. {verifiedRefNo}
                  </Text>
                </View>
              ) : null}

              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowPaymentModal(false)}
                  disabled={uploadingPayment}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalSubmitBtn,
                    (!verifiedRefNo ||
                      verifyingReceipt ||
                      uploadingPayment) && {
                      opacity: 0.45,
                    },
                  ]}
                  onPress={handleSubmitPayment}
                  disabled={
                    !verifiedRefNo || verifyingReceipt || uploadingPayment
                  }
                >
                  {uploadingPayment ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Text style={styles.modalSubmitText}>
                      Confirm ₱{selectedPaymentAmount} Payment
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  dashboardContent: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    paddingBottom: 100,
  },
  header: {
    backgroundColor: Colors.primary,
    paddingTop: 52,
    paddingBottom: 24,
    paddingHorizontal: 18,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  unitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  unitAvatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.16)",
    justifyContent: "center",
    alignItems: "center",
  },
  unitName: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  unitSub: { color: "#D8F3DC", fontSize: 10, marginTop: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBadge: {
    backgroundColor: "#22C55E",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusBadgeText: { color: "#FFF", fontSize: 9, fontWeight: "800" },
  bellBtn: {
    backgroundColor: "rgba(255,255,255,0.16)",
    padding: 8,
    borderRadius: 10,
  },
  revRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  revLabel: { color: "#A7F3D0", fontSize: 10, fontWeight: "700" },
  revAmount: { color: "#FFF", fontSize: 32, fontWeight: "800", marginTop: 2 },
  revSub: { color: "#D8F3DC", fontSize: 11, marginTop: 2 },
  weeklyBox: {
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: "center",
  },
  weeklyLabel: { color: "#D8F3DC", fontSize: 9, fontWeight: "700" },
  weeklyAmount: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFBEB",
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  pendingTitle: { fontSize: 13, fontWeight: "800", color: "#92400E" },
  pendingDesc: { fontSize: 11, color: "#B45309", marginTop: 2 },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 16,
    gap: 10,
  },
  quickActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  quickAction: {
    width: 190,
    padding: 14,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#FFF",
    gap: 7,
  },
  quickActionTitle: { color: Colors.text, fontSize: 12, fontWeight: "800" },
  quickActionSub: { color: Colors.textMuted, fontSize: 10 },
  kpiCard: {
    width: "48%",
    minWidth: 138,
    flexGrow: 1,
    backgroundColor: "#FFF",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  kpiTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kpiIconBox: {
    width: 30,
    height: 30,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
  },
  kpiBadge: {
    fontSize: 10,
    fontWeight: "800",
    color: Colors.success,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  warningBadge: { color: "#B45309", backgroundColor: "#FFFBEB" },
  kpiVal: {
    fontSize: 22,
    fontWeight: "800",
    color: Colors.text,
    marginTop: 10,
  },
  kpiLbl: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: "600",
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: Colors.text },
  linkText: { fontSize: 12, fontWeight: "700", color: Colors.primary },
  harvestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFF",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  thumb: { width: 50, height: 50, borderRadius: 12 },
  hTopLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
  },
  hTitle: { fontSize: 14, fontWeight: "800", color: Colors.text, flex: 1 },
  hMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.background,
    marginTop: 7,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3 },
  typeBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  typeText: { fontSize: 10, fontWeight: "800", color: Colors.primary },
  emptyBox: {
    alignItems: "center",
    padding: 28,
    backgroundColor: "#FFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.text,
    marginTop: 8,
  },
  emptySub: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: 4,
  },
  fab: {
    position: "absolute",
    right: 18,
    bottom: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
    elevation: 4,
  },
  fabText: { color: "#FFF", fontSize: 13, fontWeight: "800" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "90%",
    paddingTop: 18,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 17, fontWeight: "800", color: Colors.text },
  modalSubtitle: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  modalCloseBtn: { padding: 6 },
  modalScrollContent: { padding: 18, paddingBottom: 32 },
  amountToggleRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  amountToggleBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: "#FFF",
  },
  amountToggleBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  amountToggleText: { fontSize: 14, fontWeight: "800", color: Colors.text },
  amountToggleTextActive: { color: "#FFF" },
  amountToggleSub: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  amountPillFixed: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
    marginBottom: 14,
  },
  amountPillFixedText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#92400E",
    textAlign: "center",
  },
  adminGcashBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#EFF6FF",
    padding: 14,
    borderRadius: 14,
    marginBottom: 14,
  },
  gcashBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    justifyContent: "center",
    alignItems: "center",
  },
  gcashG: { color: "#FFF", fontSize: 18, fontWeight: "900" },
  adminGcashLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: "600" },
  adminGcashNumber: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.text,
    letterSpacing: 1,
  },
  adminGcashName: { fontSize: 12, color: Colors.textMuted, fontWeight: "600" },
  modalInstructionText: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 20,
    marginBottom: 14,
  },
  uploadOptionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  uploadOptionCard: {
    flex: 1,
    paddingVertical: 22,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.primary,
    backgroundColor: "#F0FDF4",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  uploadOptionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadOptionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.primary,
  },
  uploadOptionSub: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  modalReceiptUploadBox: {
    height: 180,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.primary,
    backgroundColor: "#F0FDF4",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  modalReceiptPreview: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  receiptActionChipsRow: {
    position: "absolute",
    bottom: 8,
    flexDirection: "row",
    gap: 8,
    alignSelf: "center",
  },
  changeReceiptChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(17,24,39,0.78)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  changeReceiptChipText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
  },
  scanningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#F0FDF4",
  },
  scanningText: { fontSize: 12, fontWeight: "700", color: Colors.primary },
  modalErrorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  modalErrorTitle: { fontSize: 13, fontWeight: "800", color: Colors.danger },
  modalErrorText: { fontSize: 12, color: "#991B1B", marginTop: 2 },
  validReceiptBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#DCFCE7",
  },
  validReceiptText: { fontSize: 12, fontWeight: "800", color: "#15803D" },
  modalActionsRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  modalCancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },
  modalCancelText: { fontSize: 13, fontWeight: "700", color: Colors.text },
  modalSubmitBtn: {
    flex: 2,
    padding: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSubmitText: { fontSize: 13, fontWeight: "800", color: "#FFF" },
});
