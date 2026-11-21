// src/app/buyer/_layout.tsx
import { Tabs } from "expo-router";
import {
  Home,
  MessageSquare,
  Search,
  ShoppingCart,
  User,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../../constants/theme";

export default function BuyerLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        headerShown: false,
        animation: "fade",
        tabBarStyle: {
          width: "100%",
          maxWidth: 720,
          alignSelf: "center",
          height: 68 + insets.bottom,
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
          paddingVertical: 4,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "700",
          lineHeight: 14,
          marginBottom: 0,
        },
        tabBarIconStyle: { alignItems: "center", justifyContent: "center" },
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
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => <Search size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarIcon: ({ color }) => <ShoppingCart size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="message"
        options={{
          title: "Messages",
          tabBarIcon: ({ color }) => <MessageSquare size={21} color={color} />,
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
