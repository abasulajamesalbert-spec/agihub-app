// src/app/harvest/[id].tsx
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  BadgeCheck,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Heart,
  MapPin,
  MessageSquare,
  Star,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Colors } from "../../constants/theme";
import { useCart } from "../../context/CartContext";
import { getCurrentUser } from "../../lib/authHelpers";
import { supabase } from "../../lib/supabase";

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=500";

export default function HarvestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<any>(null);
  const [loadingItem, setLoadingItem] = useState(true);
  const [itemError, setItemError] = useState("");
  const [qty, setQty] = useState(1);
  const [isLiked, setIsLiked] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const { addToCart } = useCart();
  const router = useRouter();

  useEffect(() => {
    if (!id) return;
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (active && data) {
          setItem(data);
          setActivePhotoIndex(0);
          setItemError("");
        } else if (active) {
          setItemError("This harvest is no longer available.");
        }
      } catch (error) {
        console.error("Could not load product details.", error);
        if (active) {
          setItemError(
            error instanceof Error
              ? error.message
              : "Could not load this harvest.",
          );
        }
      } finally {
        if (active) setLoadingItem(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          const user = await getCurrentUser();
          if (!user || !id) {
            if (active) setIsLiked(false);
            return;
          }
          const { data, error } = await supabase
            .from("buyer_favorites")
            .select("product_id")
            .eq("buyer_id", user.id)
            .eq("product_id", id)
            .maybeSingle();
          if (error) throw error;
          if (active) setIsLiked(Boolean(data));
        } catch (error) {
          console.error("Could not load product favorite state.", error);
        }
      })();
      return () => {
        active = false;
      };
    }, [id]),
  );

  // Build clean array of 1–5 product photos from image_urls (fallback to image_url)
  const galleryPhotos = useMemo(() => {
    if (!item) return [FALLBACK_IMAGE];

    const rawArray: unknown[] = Array.isArray(item.image_urls)
      ? item.image_urls
      : [];

    const validUrls = rawArray.filter(
      (url): url is string =>
        typeof url === "string" && url.trim().startsWith("http"),
    );

    if (validUrls.length > 0) {
      return validUrls.slice(0, 5);
    }

    if (
      typeof item.image_url === "string" &&
      item.image_url.trim().startsWith("http")
    ) {
      return [item.image_url.trim()];
    }

    return [FALLBACK_IMAGE];
  }, [item]);

  const safePhotoIndex =
    activePhotoIndex < galleryPhotos.length ? activePhotoIndex : 0;
  const activePhotoUri = galleryPhotos[safePhotoIndex] || FALLBACK_IMAGE;

  function showMessage(title: string, msg: string) {
    if (Platform.OS === "web") {
      window.alert(`${title}: ${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  }

  async function toggleFavorite() {
    try {
      const user = await getCurrentUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }
      if (isLiked) {
        const { error } = await supabase
          .from("buyer_favorites")
          .delete()
          .eq("buyer_id", user.id)
          .eq("product_id", item.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("buyer_favorites")
          .insert({ buyer_id: user.id, product_id: item.id });
        if (error) throw error;
      }
      setIsLiked(!isLiked);
    } catch (error) {
      showMessage(
        "Favorites Unavailable",
        error instanceof Error ? error.message : "Could not update favorite.",
      );
    }
  }

  if (!item) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={styles.loadingText}>
          {!id
            ? "This harvest is no longer available."
            : loadingItem
              ? "Loading harvest details..."
              : itemError}
        </Text>
        {(!loadingItem || !id) && (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.replace("/buyer")}
          >
            <Text style={styles.loadingText}>Back to harvests</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const isPreOrder = item.listing_type === "in_ground_preorder";
  const maxStock = Math.max(0, Number(item.available_stock) || 0);
  const canOrder = maxStock >= 1;
  const totalStock = Number(item.total_stock) || maxStock;
  const stockPct =
    totalStock > 0
      ? Math.min(100, Math.round((maxStock / totalStock) * 100))
      : 50;
  const subtotal = (Number(item.price_per_unit || 0) * qty).toFixed(2);

  const sellerInitials = (item.seller_name || "Agri Unit")
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0])
    .join("")
    .toUpperCase();

  function handleAdd(goCheckout = false) {
    addToCart({
      harvestId: item.id,
      title: item.title,
      pricePerUnit: Number(item.price_per_unit),
      unit: item.unit,
      quantity: qty,
      availableStock: maxStock,
      sellerId: item.seller_id,
      sellerName: item.seller_name || "Agri Dept - Unit 3",
      imageUrl: galleryPhotos[0] || item.image_url,
      listingType: item.listing_type,
    });
    if (goCheckout) {
      router.push("/checkout");
    } else {
      showMessage(
        "Added to Cart",
        `${qty} ${item.unit} of ${item.title} added to your cart!`,
      );
    }
  }

  async function handleChat() {
    try {
      const user = await getCurrentUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }
      const { data: chatId, error } = await supabase.rpc("get_or_create_chat", {
        p_order_id: null,
        p_product_id: item.id,
        p_seller_id: item.seller_id,
      });
      if (error) throw error;
      router.push({
        pathname: "/chat/[orderId]",
        params: { orderId: chatId },
      });
    } catch (error) {
      showMessage(
        "Chat Unavailable",
        error instanceof Error ? error.message : "Could not open this chat.",
      );
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#FFF" }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* Hero Image Gallery (1 to 5 Photos) */}
        <View style={styles.heroWrap}>
          <Image
            source={{ uri: activePhotoUri }}
            style={styles.heroImg}
            resizeMode="cover"
          />

          <TouchableOpacity
            style={styles.backCircle}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.push("/buyer");
            }}
          >
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.heartCircle}
            onPress={() => void toggleFavorite()}
            accessibilityRole="button"
            accessibilityLabel={
              isLiked ? "Remove from favorites" : "Add to favorites"
            }
          >
            <Heart
              size={18}
              color={isLiked ? Colors.danger : Colors.textMuted}
              fill={isLiked ? Colors.danger : "transparent"}
            />
          </TouchableOpacity>

          {/* Left/Right Navigation Arrows & Counter Badge when > 1 photo */}
          {galleryPhotos.length > 1 && (
            <>
              <TouchableOpacity
                style={[styles.navArrowBtn, { left: 16 }]}
                accessibilityRole="button"
                accessibilityLabel="Previous photo"
                onPress={() =>
                  setActivePhotoIndex((prev) =>
                    prev === 0 ? galleryPhotos.length - 1 : prev - 1,
                  )
                }
              >
                <ChevronLeft size={20} color="#FFF" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.navArrowBtn, { right: 16 }]}
                accessibilityRole="button"
                accessibilityLabel="Next photo"
                onPress={() =>
                  setActivePhotoIndex((prev) =>
                    prev === galleryPhotos.length - 1 ? 0 : prev + 1,
                  )
                }
              >
                <ChevronRight size={20} color="#FFF" />
              </TouchableOpacity>

              <View style={styles.photoCounterPill}>
                <Text style={styles.photoCounterText}>
                  {safePhotoIndex + 1} / {galleryPhotos.length}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Thumbnail Strip when multiple photos exist */}
        {galleryPhotos.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbStrip}
          >
            {galleryPhotos.map((uri, index) => {
              const isSelected = index === safePhotoIndex;
              return (
                <TouchableOpacity
                  key={`${uri}-${index}`}
                  onPress={() => setActivePhotoIndex(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`View photo ${index + 1}`}
                  style={[
                    styles.thumbItem,
                    isSelected && styles.thumbItemActive,
                  ]}
                >
                  <Image source={{ uri }} style={styles.thumbImg} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.body}>
          {/* Status & Harvest Time Badges */}
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.readyBadge,
                isPreOrder && { backgroundColor: "#DBEAFE" },
              ]}
            >
              <Text
                style={[styles.readyText, isPreOrder && { color: "#1D4ED8" }]}
              >
                {isPreOrder ? "🌱 IN-GROUND PRE-ORDER" : "✓ READY NOW"}
              </Text>
            </View>
            <View style={styles.timeBadge}>
              <Calendar size={11} color="#B45309" />
              <Text style={styles.timeText}>
                {isPreOrder
                  ? `Est. Harvest: ${item.expected_harvest || "In 5 days"}`
                  : "Harvested today • 6:30 AM"}
              </Text>
            </View>
          </View>

          {/* Title, Price & Rating */}
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.price}>
                ₱{item.price_per_unit}{" "}
                <Text style={styles.unit}>/ {item.unit}</Text>
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <View style={{ flexDirection: "row", gap: 2 }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    size={13}
                    color={Colors.accent}
                    fill={Colors.accent}
                  />
                ))}
              </View>
              <Text style={styles.reviewCount}>4.9 (128 reviews)</Text>
            </View>
          </View>

          {/* Verified Seller Card */}
          <View style={styles.sellerCard}>
            <View style={styles.sellerAvatar}>
              <Text style={styles.sellerInit}>{sellerInitials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.sellerNameRow}>
                <Text style={styles.sellerName} numberOfLines={1}>
                  {item.seller_name || "Agri Dept - Unit 3"}
                </Text>
                <BadgeCheck size={15} color="#2563EB" />
              </View>
              <Text style={styles.sellerSub}>
                {item.seller_department || "Verified Student Seller"} • 342
                sales
              </Text>
            </View>
            <TouchableOpacity style={styles.chatBtn} onPress={handleChat}>
              <MessageSquare size={15} color={Colors.primary} />
              <Text style={styles.chatBtnText}>Chat</Text>
            </TouchableOpacity>
          </View>

          {/* Stock Remaining Progress */}
          <View style={styles.stockRow}>
            <Text style={styles.stockLabel}>
              {isPreOrder ? "Pre-order allocation left" : "Stock remaining"}
            </Text>
            <Text style={styles.stockVal}>
              {maxStock} / {totalStock} {item.unit}
            </Text>
          </View>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${stockPct}%` }]} />
          </View>
          <Text style={styles.urgencyText}>
            ⚡ Selling fast — 7 buyers viewing now
          </Text>

          {/* Quantity Stepper */}
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Quantity ({item.unit})</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setQty(Math.max(1, Math.min(maxStock, qty - 1)))}
                disabled={!canOrder || qty <= 1}
              >
                <Text style={styles.stepText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyNum}>{qty}</Text>
              <TouchableOpacity
                style={[styles.stepBtn, { backgroundColor: Colors.primary }]}
                onPress={() => setQty(Math.min(maxStock, qty + 1))}
                disabled={!canOrder || qty >= maxStock}
              >
                <Text style={[styles.stepText, { color: "#FFF" }]}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* About Harvest */}
          <Text style={styles.aboutTitle}>About this harvest</Text>
          <Text style={styles.aboutDesc}>
            {item.description ||
              "Vine-ripened fresh campus produce grown in the ADSSU Agriculture demo farm. Pesticide-free and harvested fresh for campus pick-up."}
          </Text>
          <View style={styles.pickupRow}>
            <MapPin size={14} color={Colors.primary} />
            <Text style={styles.pickupNote}>
              Pick-up:{" "}
              {Array.isArray(item.pickup_venues) && item.pickup_venues.length
                ? item.pickup_venues.join(", ")
                : "See available options at checkout"}
            </Text>
          </View>
          {Array.isArray(item.available_dates) &&
            item.available_dates.length > 0 && (
              <Text style={styles.availabilityNote}>
                Dates: {item.available_dates.join(", ")}
              </Text>
            )}
          {Array.isArray(item.pickup_times) && item.pickup_times.length > 0 && (
            <Text style={styles.availabilityNote}>
              Times: {item.pickup_times.join(", ")}
            </Text>
          )}
          <Text style={styles.availabilityNote}>
            Payment:{" "}
            {[
              item.accepts_gcash ? "GCash" : null,
              item.accepts_cash ? "Cash on Pick-up" : null,
            ]
              .filter(Boolean)
              .join(" • ") || "Options shown at checkout"}
          </Text>
        </View>
      </ScrollView>

      {/* Bottom Sticky Action Bar */}
      <View style={styles.bottomBar}>
        <View>
          <Text style={styles.subLabel}>Subtotal</Text>
          <Text style={styles.subTotal}>₱{subtotal}</Text>
        </View>
        <TouchableOpacity
          style={[styles.addCartBtn, !canOrder && styles.disabledAction]}
          onPress={() => handleAdd(false)}
          disabled={!canOrder}
        >
          <Text style={styles.addCartText}>
            {canOrder ? "Add to Cart" : "Unavailable"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.buyNowBtn, !canOrder && styles.disabledAction]}
          onPress={() => handleAdd(true)}
          disabled={!canOrder}
        >
          <Text style={styles.buyNowText}>
            {!canOrder
              ? "Unavailable"
              : isPreOrder
                ? "Pre-Order Now"
                : "Order Now"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { fontSize: 13, fontWeight: "700", color: Colors.textMuted },
  heroWrap: { position: "relative", height: 280, backgroundColor: "#F3F4F6" },
  heroImg: { width: "100%", height: "100%" },
  backCircle: {
    position: "absolute",
    top: 48,
    left: 16,
    backgroundColor: "#FFF",
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center",
    alignItems: "center",
  },
  heartCircle: {
    position: "absolute",
    top: 48,
    right: 16,
    backgroundColor: "#FFF",
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center",
    alignItems: "center",
  },
  navArrowBtn: {
    position: "absolute",
    top: "50%",
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  photoCounterPill: {
    position: "absolute",
    bottom: 12,
    right: 16,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  photoCounterText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "800",
  },
  thumbStrip: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 2,
  },
  thumbItem: {
    width: 60,
    height: 60,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    opacity: 0.7,
  },
  thumbItemActive: {
    borderColor: Colors.primary,
    opacity: 1,
  },
  thumbImg: {
    width: "100%",
    height: "100%",
  },
  body: { padding: 18 },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  readyBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  readyText: { fontSize: 10, fontWeight: "800", color: Colors.primary },
  timeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  timeText: { fontSize: 10, fontWeight: "700", color: "#B45309" },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: { fontSize: 21, fontWeight: "800", color: Colors.text },
  price: {
    fontSize: 20,
    fontWeight: "800",
    color: Colors.primary,
    marginTop: 2,
  },
  unit: { fontSize: 13, fontWeight: "500", color: Colors.textMuted },
  reviewCount: { fontSize: 11, color: Colors.textMuted, marginTop: 3 },
  sellerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.background,
    padding: 12,
    borderRadius: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sellerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  sellerInit: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  sellerNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  sellerName: { fontSize: 14, fontWeight: "800", color: Colors.text },
  sellerSub: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  chatBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFF",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chatBtnText: { fontSize: 12, fontWeight: "700", color: Colors.primary },
  stockRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
  },
  stockLabel: { fontSize: 13, fontWeight: "700", color: Colors.text },
  stockVal: { fontSize: 13, fontWeight: "800", color: "#EA580C" },
  progressBg: {
    height: 7,
    backgroundColor: "#E5E7EB",
    borderRadius: 4,
    marginTop: 6,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#F97316" },
  urgencyText: {
    fontSize: 11,
    color: "#EA580C",
    fontWeight: "600",
    marginTop: 5,
  },
  qtyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 18,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  qtyLabel: { fontSize: 14, fontWeight: "700", color: Colors.text },
  stepper: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.background,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepText: { fontSize: 18, fontWeight: "700" },
  qtyNum: { fontSize: 16, fontWeight: "800" },
  aboutTitle: { fontSize: 14, fontWeight: "800", marginTop: 16 },
  aboutDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 18,
    marginTop: 4,
  },
  pickupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  pickupNote: { fontSize: 12, fontWeight: "700", color: Colors.primary },
  availabilityNote: { fontSize: 11, color: Colors.textMuted, marginTop: 5 },
  disabledAction: { opacity: 0.45 },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderTopWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#FFF",
  },
  subLabel: { fontSize: 11, color: Colors.textMuted },
  subTotal: { fontSize: 17, fontWeight: "800", color: Colors.text },
  addCartBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: "center",
  },
  addCartText: { fontSize: 13, fontWeight: "700", color: Colors.primary },
  buyNowBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: "center",
  },
  buyNowText: { fontSize: 13, fontWeight: "700", color: "#FFF" },
});
