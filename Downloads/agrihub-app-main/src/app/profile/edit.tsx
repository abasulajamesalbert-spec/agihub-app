// src/app/profile/edit.tsx
import { useRouter } from "expo-router";
import { ArrowLeft, Save, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "../../components/KeyboardAwareScrollView";
import { Colors } from "../../constants/theme";
import { getCurrentUser } from "../../lib/authHelpers";
import { supabase } from "../../lib/supabase";

export default function EditProfileScreen() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [department, setDepartment] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [role, setRole] = useState<"buyer" | "seller" | "admin">("buyer");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function loadProfile() {
      const user = await getCurrentUser();
      if (!user) {
        router.replace("/auth/login");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select(
            "first_name, last_name, full_name, department, phone_number, store_name, store_address, role",
          )
          .eq("id", user.id)
          .maybeSingle();
        if (error) throw error;

        const existingFull = (data?.full_name || "").trim();
        const fallbackParts = existingFull.split(/\s+/);
        const fallbackFirst = fallbackParts[0] || "";
        const fallbackLast = fallbackParts.slice(1).join(" ") || "";

        setFirstName(data?.first_name || fallbackFirst);
        setLastName(data?.last_name || fallbackLast);
        setDepartment(data?.department || "");
        setPhoneNumber(data?.phone_number || "");
        setStoreName(data?.store_name || "");
        setStoreAddress(data?.store_address || "");
        setRole(data?.role || "buyer");
      } catch (error) {
        console.error("Failed to load profile for editing:", error);
        showMessage("Load Failed", "Could not load your profile.");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [router]);

  function showMessage(title: string, message: string) {
    if (Platform.OS === "web") {
      window.alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  }

  async function saveProfile() {
    const user = await getCurrentUser();
    if (!user) {
      router.replace("/auth/login");
      return;
    }

    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();
    const cleanDept = department.trim();
    const cleanPhone = phoneNumber.trim();
    const cleanStoreName = storeName.trim();
    const cleanStoreAddress = storeAddress.trim();

    if (!cleanFirst) {
      return showMessage("Required Field", "Please enter your First Name.");
    }
    if (!cleanLast) {
      return showMessage("Required Field", "Please enter your Last Name.");
    }
    if (!cleanDept) {
      return showMessage(
        "Required Field",
        "Please enter your Department / Unit.",
      );
    }
    if (!cleanPhone) {
      return showMessage("Required Field", "Please enter your Contact Number.");
    }
    if (role === "seller") {
      if (!cleanStoreName) {
        return showMessage(
          "Required Field",
          "Please enter your Store / Farm Name.",
        );
      }
      if (!cleanStoreAddress) {
        return showMessage(
          "Required Field",
          "Please enter your Store Address.",
        );
      }
    }

    setSaving(true);
    try {
      const updates = {
        first_name: cleanFirst,
        last_name: cleanLast,
        full_name: `${cleanFirst} ${cleanLast}`,
        department: cleanDept,
        phone_number: cleanPhone,
        ...(role === "seller"
          ? {
              store_name: cleanStoreName,
              store_address: cleanStoreAddress,
            }
          : {}),
      };
      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", user.id);
      if (error) throw error;
      showMessage("Profile Updated", "Your profile changes have been saved.");
      navigateBack();
    } catch (error) {
      console.error("Failed to update profile:", error);
      showMessage(
        "Update Failed",
        error instanceof Error ? error.message : "Could not save your profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function performDeleteAccount() {
    setDeleting(true);
    try {
      const { error } = await supabase.rpc("delete_own_account");
      if (error) throw error;
      await supabase.auth.signOut();
      showMessage(
        "Profile Deleted",
        "Your account and profile have been permanently deleted.",
      );
      router.replace("/auth/login");
    } catch (error: unknown) {
      console.error("Failed to delete account:", error);
      const errMsg =
        error instanceof Error
          ? error.message
          : typeof error === "object" &&
              error !== null &&
              "message" in error &&
              typeof (error as { message: unknown }).message === "string"
            ? (error as { message: string }).message
            : "Could not delete your profile.";
      showMessage("Delete Failed", errMsg);
    } finally {
      setDeleting(false);
    }
  }

  function handleDeleteAccount() {
    const title = "Delete Profile & Account";
    const msg =
      "Are you sure you want to permanently delete your profile? All your account data will be removed and this cannot be undone.";

    if (Platform.OS === "web") {
      if (window.confirm(`${title}\n\n${msg}`)) {
        void performDeleteAccount();
      }
      return;
    }

    Alert.alert(title, msg, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete Permanently",
        style: "destructive",
        onPress: () => {
          void performDeleteAccount();
        },
      },
    ]);
  }

  function navigateBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.push(
      role === "seller" ? "/seller" : role === "admin" ? "/admin" : "/buyer",
    );
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={navigateBack} accessibilityRole="button">
          <ArrowLeft size={21} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Edit Profile</Text>
      </View>

      <Text style={styles.requiredNote}>* All fields are required</Text>

      <Text style={styles.label}>First Name *</Text>
      <TextInput
        style={styles.input}
        value={firstName}
        onChangeText={setFirstName}
        placeholder="Enter first name"
        autoCapitalize="words"
        maxLength={60}
      />

      <Text style={styles.label}>Last Name *</Text>
      <TextInput
        style={styles.input}
        value={lastName}
        onChangeText={setLastName}
        placeholder="Enter last name"
        autoCapitalize="words"
        maxLength={60}
      />

      <Text style={styles.label}>Department / Unit *</Text>
      <TextInput
        style={styles.input}
        value={department}
        onChangeText={setDepartment}
        placeholder="Enter department or campus unit"
        maxLength={120}
      />

      <Text style={styles.label}>Contact Number *</Text>
      <TextInput
        style={styles.input}
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        keyboardType="phone-pad"
        maxLength={24}
        placeholder="e.g. 09171234567"
      />

      {role === "seller" ? (
        <>
          <Text style={styles.label}>Store / Farm Name *</Text>
          <TextInput
            style={styles.input}
            value={storeName}
            onChangeText={setStoreName}
            maxLength={120}
            placeholder="Enter store or farm name"
          />
          <Text style={styles.label}>Store Address *</Text>
          <TextInput
            style={styles.input}
            value={storeAddress}
            onChangeText={setStoreAddress}
            maxLength={240}
            placeholder="Enter campus stall or pickup address"
          />
        </>
      ) : null}

      <TouchableOpacity
        style={[styles.saveButton, (saving || deleting) && { opacity: 0.6 }]}
        onPress={saveProfile}
        disabled={saving || deleting}
        accessibilityRole="button"
      >
        <Save size={17} color="#FFF" />
        <Text style={styles.saveText}>
          {saving ? "Saving..." : "Save Changes"}
        </Text>
      </TouchableOpacity>

      {role !== "admin" ? (
        <TouchableOpacity
          style={[
            styles.deleteButton,
            (saving || deleting) && { opacity: 0.6 },
          ]}
          onPress={handleDeleteAccount}
          disabled={saving || deleting}
          accessibilityRole="button"
        >
          <Trash2 size={17} color={Colors.danger} />
          <Text style={styles.deleteText}>
            {deleting ? "Deleting Profile..." : "Delete Profile"}
          </Text>
        </TouchableOpacity>
      ) : null}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
  },
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 18, paddingTop: 52, paddingBottom: 36 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 8,
  },
  title: { color: Colors.text, fontSize: 21, fontWeight: "800" },
  requiredNote: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textMuted,
    marginBottom: 6,
  },
  label: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 13,
    color: Colors.text,
  },
  saveButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 24,
    padding: 15,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  saveText: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  deleteButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    padding: 15,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  deleteText: { color: Colors.danger, fontSize: 14, fontWeight: "800" },
});
