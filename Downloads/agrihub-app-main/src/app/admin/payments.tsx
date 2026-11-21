// src/app/admin/payments.tsx
import { useFocusEffect, useRouter } from "expo-router";
import { ArrowLeft, CheckCircle2, Eye, X } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Colors } from "../../constants/theme";
import { supabase } from "../../lib/supabase";
import { getImageUrl } from "../../lib/uploadImageToSupabase";

type PaidRow = {
  id: string;
  seller_id: string;
  seller_name: string;
  department: string;
  amount: number;
  semester: string;
  reference_number: string | null;
  created_at: string;
  receipt_url: string;
};

export default function AdminPaymentsScreen() {
  const [rows, setRows] = useState<PaidRow[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const router = useRouter();

  const loadPayments = useCallback(async () => {
    try {
      setLoadError("");
      const { data, error } = await supabase
        .from("seller_semester_payments")
        .select(
          "id, seller_id, semester, amount, receipt_path, reference_number, status, created_at",
        )
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const sellerIds = [
        ...new Set((data || []).map((payment) => payment.seller_id)),
      ];
      const { data: profiles, error: profileError } = sellerIds.length
        ? await supabase
            .from("profiles")
            .select("id, first_name, last_name, full_name, department")
            .in("id", sellerIds)
        : { data: [], error: null };
      if (profileError) throw profileError;

      const profileMap = new Map(
        (profiles || []).map((p) => {
          const name =
            p.first_name && p.last_name
              ? `${p.first_name} ${p.last_name}`
              : p.full_name || "Seller";
          return [p.id, { name, department: p.department || "ADSSU" }];
        }),
      );

      const formatted: PaidRow[] = await Promise.all(
        (data || []).map(async (payment) => {
          const sellerInfo = profileMap.get(payment.seller_id);
          return {
            id: payment.id,
            seller_id: payment.seller_id,
            seller_name: sellerInfo?.name || "Seller",
            department: sellerInfo?.department || "ADSSU",
            amount: Number(payment.amount || 0),
            semester: payment.semester,
            reference_number: payment.reference_number,
            created_at: payment.created_at,
            receipt_url:
              (await getImageUrl("payment-receipts", payment.receipt_path)) ||
              "",
          };
        }),
      );

      setRows(formatted);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load verified payments.",
      );
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPayments();

      const channel = supabase
        .channel("admin-verified-payments")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "seller_semester_payments",
          },
          () => {
            void loadPayments();
          },
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    }, [loadPayments]),
  );

  const totalCollected = rows.reduce((sum, item) => sum + item.amount, 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.push("/admin");
          }}
        >
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Verified Booth Payments</Text>
          <Text style={styles.subtitle}>
            Auto-approved GCash receipts • Total Collected: ₱
            {totalCollected.toLocaleString()}
          </Text>
        </View>
      </View>

      {loadError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              No auto-approved seller booth payments yet.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sellerName}>{item.seller_name}</Text>
                <Text style={styles.metaText}>
                  {item.department} • ₱{item.amount} installment •{" "}
                  {item.semester}
                </Text>
                <Text style={styles.dateText}>
                  Paid {new Date(item.created_at).toLocaleString()}
                  {item.reference_number
                    ? ` • GCash Ref: ${item.reference_number}`
                    : ""}
                </Text>
              </View>

              <View style={styles.autoBadge}>
                <CheckCircle2 size={13} color="#15803D" />
                <Text style={styles.autoBadgeText}>PAID (AUTO)</Text>
              </View>
            </View>

            {item.receipt_url ? (
              <TouchableOpacity
                style={styles.viewReceiptBtn}
                onPress={() => setSelectedImage(item.receipt_url)}
              >
                <Eye size={16} color={Colors.primary} />
                <Text style={styles.viewReceiptText}>View GCash Receipt</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      />

      <Modal
        visible={Boolean(selectedImage)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedImage(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <TouchableOpacity
              style={styles.closeModalBtn}
              onPress={() => setSelectedImage(null)}
            >
              <X size={20} color={Colors.text} />
            </TouchableOpacity>
            {selectedImage ? (
              <Image
                source={{ uri: selectedImage }}
                style={styles.fullReceiptImg}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: Platform.OS === "android" ? 48 : 52,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFF",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: { fontSize: 20, fontWeight: "800", color: Colors.text },
  subtitle: { fontSize: 12, color: Colors.textMuted, fontWeight: "600" },
  errorBox: {
    margin: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
  },
  errorText: { color: Colors.danger, fontSize: 12, fontWeight: "700" },
  emptyBox: {
    padding: 32,
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyText: { color: Colors.textMuted, fontSize: 13, fontWeight: "600" },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  sellerName: { fontSize: 15, fontWeight: "800", color: Colors.text },
  metaText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.text,
    marginTop: 2,
  },
  dateText: { fontSize: 11, color: Colors.textMuted, marginTop: 3 },
  autoBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  autoBadgeText: { fontSize: 10, fontWeight: "800", color: "#15803D" },
  viewReceiptBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  viewReceiptText: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.primary,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 14,
    alignItems: "flex-end",
  },
  closeModalBtn: {
    padding: 6,
    marginBottom: 6,
  },
  fullReceiptImg: {
    width: "100%",
    height: 460,
    resizeMode: "contain",
  },
});
