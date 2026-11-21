// src/app/seller/_layout.tsx
import { Tabs, useFocusEffect, useRouter } from "expo-router";
import {
  ClipboardList,
  Home,
  Package,
  PlusCircle,
  User,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../../constants/theme";
import { getCurrentUser } from "../../lib/authHelpers";
import { supabase } from "../../lib/supabase";

function withTimeout<T>(
  request: PromiseLike<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(request).then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export default function SellerLayout() {
  const insets = useSafeAreaInsets();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [canEnter, setCanEnter] = useState(false);
  const [guardError, setGuardError] = useState("");
  const [retry, setRetry] = useState(0);
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (retry > 0) setCanEnter(false);
      setCheckingAccess(true);
      setGuardError("");

      void (async () => {
        try {
          const user = await withTimeout(
            getCurrentUser(),
            15_000,
            "Checking your seller session timed out. Please try again.",
          );
          if (!user) {
            router.replace("/auth/login");
            return;
          }
          const { data: profile, error } = await withTimeout(
            supabase
              .from("profiles")
              .select("role, valid_id_url, id_document_url")
              .eq("id", user.id)
              .maybeSingle(),
            15_000,
            "Checking your seller profile timed out. Please try again.",
          );
          if (error) throw error;
          if (!profile) throw new Error("Seller profile could not be found.");
          if (profile.role !== "seller") {
            router.replace(profile.role === "admin" ? "/admin" : "/buyer");
            return;
          }
          if (!(profile.valid_id_url || profile.id_document_url)) {
            router.replace("/auth/verify-id");
            return;
          }
          if (active) setCanEnter(true);
        } catch (error) {
          console.error("Could not verify seller access.", error);
          if (active) {
            setCanEnter(false);
            setGuardError(
              error instanceof Error
                ? error.message
                : "Could not verify your seller account.",
            );
          }
        } finally {
          if (active) setCheckingAccess(false);
        }
      })();

      return () => {
        active = false;
      };
    }, [retry, router]),
  );

  if (checkingAccess || !canEnter) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
          backgroundColor: Colors.background,
        }}
      >
        {checkingAccess ? (
          <>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text
              style={{
                color: Colors.textMuted,
                textAlign: "center",
                marginTop: 12,
              }}
            >
              Checking seller access…
            </Text>
          </>
        ) : guardError ? (
          <>
            <Text
              style={{
                color: Colors.text,
                textAlign: "center",
                fontWeight: "700",
              }}
            >
              Seller access could not be verified
            </Text>
            <Text
              style={{
                color: Colors.textMuted,
                textAlign: "center",
                marginTop: 8,
              }}
            >
              {guardError}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setRetry((current) => current + 1)}
              style={{
                marginTop: 16,
                paddingHorizontal: 18,
                paddingVertical: 11,
                borderRadius: 10,
                backgroundColor: Colors.primary,
              }}
            >
              <Text style={{ color: "#FFF", fontWeight: "700" }}>
                Try again
              </Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        headerShown: false,
        animation: "fade",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarStyle: {
          width: "100%",
          height: 64 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
          backgroundColor: "#FFF",
          borderTopColor: Colors.border,
        },
        tabBarItemStyle: {
          flex: 1,
          minWidth: 0,
          alignItems: "center",
          justifyContent: "center",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <Home size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color }) => <ClipboardList size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="post-harvest"
        options={{
          title: "Post",
          tabBarIcon: ({ color }) => <PlusCircle size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: "My Harvests",
          tabBarIcon: ({ color }) => <Package size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <User size={21} color={color} />,
        }}
      />
    </Tabs>
  );
}
