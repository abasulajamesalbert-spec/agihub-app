// src/app/auth/verify-id.tsx
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  Camera,
  CheckCircle2,
  ImagePlus,
  LogOut,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { createWorker } from "tesseract.js";
import { KeyboardAwareScrollView } from "../../components/KeyboardAwareScrollView";
import { Colors } from "../../constants/theme";
import { getCurrentUser } from "../../lib/authHelpers";
import { supabase } from "../../lib/supabase";
import {
  createImageUploadPath,
  uploadPrivateImageToSupabase,
  type UploadableImageAsset,
} from "../../lib/uploadImageToSupabase";

WebBrowser.maybeCompleteAuthSession();

interface IdScanResult {
  isValid: boolean;
  detectedIdNumber?: string;
  detectedCourse?: string;
  reason?: string;
}

interface ScannableImage {
  uri: string;
  base64?: string | null;
  mimeType?: string | null;
  width?: number;
  height?: number;
  fileName?: string | null;
}

function getReadableError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}

/**
 * Prepares a clean, high-contrast JPEG Data URL and dimensions for local OCR.
 */
async function prepareImageForOcr(asset: ScannableImage): Promise<{
  dataUrl: string;
  base64: string;
  width?: number;
  height?: number;
}> {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const origW = img.naturalWidth || asset.width || 800;
        const origH = img.naturalHeight || asset.height || 1100;
        const maxSide = 1200;
        const scale = Math.min(1, maxSide / Math.max(origW, origH));
        const targetW = Math.round(origW * scale);
        const targetH = Math.round(origH * scale);

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not prepare image canvas."));
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
        resolve({
          dataUrl,
          base64,
          width: origW,
          height: origH,
        });
      };
      img.onerror = () =>
        reject(new Error("Could not read the selected image file."));

      if (
        asset.uri.startsWith("data:") ||
        asset.uri.startsWith("blob:") ||
        asset.uri.startsWith("http")
      ) {
        img.src = asset.uri;
      } else if (asset.base64) {
        const mime =
          asset.mimeType === "image/png" ? "image/png" : "image/jpeg";
        img.src = `data:${mime};base64,${asset.base64}`;
      } else {
        img.src = asset.uri;
      }
    });
  }

  if (!asset.base64) {
    throw new Error("Could not read image data.");
  }
  const cleanBase64 = asset.base64
    .replace(/^data:image\/[^;,]+;base64,/i, "")
    .replace(/\s/g, "");
  const mimeType = asset.mimeType === "image/png" ? "image/png" : "image/jpeg";
  return {
    dataUrl: `data:${mimeType};base64,${cleanBase64}`,
    base64: cleanBase64,
    width: asset.width,
    height: asset.height,
  };
}

/**
 * Extracts text using local Tesseract.js OCR (zero API limits / zero throttling).
 */
async function runLocalTesseractOcr(imageSource: string): Promise<string> {
  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(imageSource);
    return text || "";
  } finally {
    await worker.terminate();
  }
}

/**
 * Validates that the uploaded or captured image is strictly an official ASSCAT / ADSSU ID card
 * showing:
 * 1. School Logo & Official School Name (Agusan del Sur State College of Agriculture and Technology / ADSSU)
 * 2. Official ID Number (e.g., ID No. M-008967)
 * 3. Student / Employee Name matching the registered profile
 * 4. Course / Program (e.g., BSIT, BSA, etc.)
 */
async function validateOfficialSchoolId(
  asset: ScannableImage,
  registeredFullName: string,
): Promise<IdScanResult> {
  try {
    const prepared = await prepareImageForOcr(asset);

    // 1. Check portrait ID card proportions (standard vertical ID card)
    if (prepared.width && prepared.height) {
      const ratio = prepared.width / prepared.height;
      if (ratio > 1.4 || ratio < 0.4) {
        return {
          isValid: false,
          reason:
            "Verification Declined: Please provide a clear, upright photo of your School ID card only (showing the school logo at the top, school name, ID number, your name, and course).",
        };
      }
    }

    // Run local Tesseract OCR directly on the image
    const rawText = await runLocalTesseractOcr(prepared.dataUrl);
    const parsedText = rawText.toUpperCase();

    if (!parsedText.trim()) {
      return {
        isValid: false,
        reason:
          "Verification Declined: No readable text detected. Please upload or take a clear photo of your School ID showing the school logo, school name, your name, ID number, and course.",
      };
    }

    // 2. Verify School Name (ASSCAT / ADSSU)
    const hasSchoolName =
      parsedText.includes("AGUSAN DEL SUR") ||
      parsedText.includes("STATE COLLEGE") ||
      parsedText.includes("AGRICULTURE AND TECHNOLOGY") ||
      parsedText.includes("ADSSU") ||
      parsedText.includes("ASSCAT") ||
      parsedText.includes("BUNAWAN");

    if (!hasSchoolName) {
      return {
        isValid: false,
        reason:
          "Verification Declined: Official ADSSU / ASSCAT school name not found. Only valid ASSCAT / ADSSU IDs are automatically approved.",
      };
    }

    // 3. Verify Official ID Number (matches formats like "ID No. M-008967", "M-008967", "2023-00123")
    const idMatch = parsedText.match(
      /(?:ID\s*NO\.?\s*)?([A-Z]\s*-\s*\d{5,7}|\d{2,4}\s*-\s*\d{4,6})/,
    );
    if (!idMatch) {
      return {
        isValid: false,
        reason:
          "Verification Declined: Valid ID Number (e.g., ID No. M-008967) is not visible. Make sure your ID number is clear.",
      };
    }
    const detectedIdNumber = idMatch[1].replace(/\s+/g, "");

    // 4. Verify Student / Employee Name is visible on the ID
    const cleanNameParts = registeredFullName
      .toUpperCase()
      .split(/\s+/)
      .filter((part) => part.length >= 2);
    if (cleanNameParts.length > 0) {
      const hasMatchingName = cleanNameParts.some((part) =>
        parsedText.includes(part),
      );
      if (!hasMatchingName) {
        return {
          isValid: false,
          reason:
            "Verification Declined: The name on the ID does not match your registered name, or your name is not clearly visible on the ID.",
        };
      }
    }

    // 5. Verify Course / Program (e.g., BSIT, BSA, BSCS, BSED, BEED, BSCE, BSABE, etc.)
    const courseMatch = parsedText.match(
      /\b(BS[A-Z]{1,5}|BE[A-Z]{1,4}|BA[A-Z]{1,4}|AB[A-Z]{1,4}|DIT|DAT|FACULTY|STAFF|ADMIN)\b/,
    );
    if (!courseMatch) {
      return {
        isValid: false,
        reason:
          "Verification Declined: Course / Program (e.g., BSIT, BSA) is not clearly visible on the ID. Please provide a clearer photo of your School ID.",
      };
    }
    const detectedCourse = courseMatch[1];

    return {
      isValid: true,
      detectedIdNumber,
      detectedCourse,
    };
  } catch (error) {
    console.error("School ID OCR validation error:", error);
    return {
      isValid: false,
      reason:
        "Could not verify the School ID image. Please try uploading or capturing a clear photo of your ID.",
    };
  }
}

export default function VerifyIdScreen() {
  const [role, setRole] = useState<"buyer" | "seller">("buyer");
  const [fullName, setFullName] = useState("");
  const [schoolIdNumber, setSchoolIdNumber] = useState("");
  const [scannedIdNumber, setScannedIdNumber] = useState("");
  const [courseYear, setCourseYear] = useState("");
  const [idImage, setIdImage] = useState<string | null>(null);
  const [idImageAsset, setIdImageAsset] = useState<UploadableImageAsset | null>(
    null,
  );
  const [idFileName, setIdFileName] = useState("School_ID_front.jpg");
  const [detectedSummary, setDetectedSummary] = useState("");
  const [isIdVerified, setIsIdVerified] = useState(false);
  const [verifyingId, setVerifyingId] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Live Web Camera state
  const [webCameraOpen, setWebCameraOpen] = useState(false);
  const [webCameraReady, setWebCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const router = useRouter();

  function showMessage(title: string, message: string) {
    if (Platform.OS === "web") {
      window.alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  }

  // Start / stop browser webcam stream when modal opens/closes
  useEffect(() => {
    if (Platform.OS !== "web" || !webCameraOpen) return;

    let cancelled = false;
    setWebCameraReady(false);

    async function startWebcam() {
      try {
        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia
        ) {
          throw new Error(
            "Your browser does not support webcam access. Please click Upload Photo instead.",
          );
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setWebCameraReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setWebCameraOpen(false);
          setErrorMessage(
            getReadableError(
              err,
              "Could not access your webcam. Allow camera permission in your browser or use Upload Photo.",
            ),
          );
        }
      }
    }

    void startWebcam();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setWebCameraReady(false);
    };
  }, [webCameraOpen]);

  useEffect(() => {
    let active = true;
    async function loadUserProfile() {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          router.replace("/auth/login");
          return;
        }
        const { data, error } = await supabase
          .from("profiles")
          .select("role, full_name, course_year, id_number")
          .eq("id", currentUser.id)
          .maybeSingle();
        if (error) throw error;
        if (!data || (data.role !== "buyer" && data.role !== "seller")) {
          throw new Error(
            "A buyer or seller profile is required for ID verification.",
          );
        }
        if (!active) return;
        setRole(data.role);
        setFullName(data.full_name || "");
        setCourseYear(data.course_year || "");
        setSchoolIdNumber(data.id_number || "");
      } catch (err) {
        console.error("Failed to load profile:", err);
        if (active) {
          setErrorMessage(
            getReadableError(
              err,
              "Could not load your profile. Please try again.",
            ),
          );
        }
      } finally {
        if (active) setLoadingProfile(false);
      }
    }
    void loadUserProfile();
    return () => {
      active = false;
    };
  }, [router]);

  async function processSelectedIdAsset(
    asset: ScannableImage,
    fallbackName: string,
  ) {
    setVerifyingId(true);
    setIsIdVerified(false);
    setDetectedSummary("");

    const scanResult = await validateOfficialSchoolId(asset, fullName);
    setVerifyingId(false);

    if (!scanResult.isValid) {
      const declineReason =
        scanResult.reason ||
        "Verification Declined: Only valid ASSCAT / ADSSU School IDs are accepted.";
      setIdImage(null);
      setIdImageAsset(null);
      setIsIdVerified(false);
      setScannedIdNumber("");
      setErrorMessage(declineReason);
      showMessage("ID Declined", declineReason);
      return;
    }

    if (scanResult.detectedIdNumber) {
      setScannedIdNumber(scanResult.detectedIdNumber);
      setSchoolIdNumber(scanResult.detectedIdNumber);
    }

    if (!courseYear.trim() && scanResult.detectedCourse) {
      setCourseYear(scanResult.detectedCourse);
    }

    setIdImage(asset.uri);
    setIdImageAsset({
      uri: asset.uri,
      base64: asset.base64,
      mimeType: asset.mimeType || "image/jpeg",
    });
    setIdFileName(asset.fileName || fallbackName);
    setDetectedSummary(
      `ID No. ${scanResult.detectedIdNumber} • ${scanResult.detectedCourse}`,
    );
    setIsIdVerified(true);
  }

  async function pickIdFromGallery() {
    setErrorMessage("");
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.9,
        base64: true,
      });
      if (!res.canceled && res.assets?.length > 0) {
        await processSelectedIdAsset(res.assets[0], "ADSSU_School_ID.jpg");
      }
    } catch (error) {
      setVerifyingId(false);
      setErrorMessage(
        getReadableError(error, "Could not open your photo library."),
      );
    }
  }

  async function takeIdWithCamera() {
    setErrorMessage("");

    // On Web (desktop/mobile browser), open live webcam capture modal
    if (Platform.OS === "web") {
      setWebCameraOpen(true);
      return;
    }

    // On iOS / Android native app, use native camera
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setErrorMessage(
          "Camera permission is required to take a photo of your School ID.",
        );
        return;
      }

      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.9,
        base64: true,
        cameraType: ImagePicker.CameraType.back,
      });

      if (!res.canceled && res.assets?.length > 0) {
        await processSelectedIdAsset(
          res.assets[0],
          "ADSSU_School_ID_Camera.jpg",
        );
      }
    } catch (error) {
      setVerifyingId(false);
      setErrorMessage(
        getReadableError(
          error,
          "Could not open the camera. Please allow camera access or upload a photo instead.",
        ),
      );
    }
  }

  async function captureWebCameraFrame() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setErrorMessage("Camera is still warming up. Please try again.");
      return;
    }

    // Crop the center vertical ID card frame so proportions are upright portrait
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const targetHeight = srcH;
    const targetWidth = Math.min(srcW, Math.round(srcH * 0.72));
    const sx = Math.max(0, Math.round((srcW - targetWidth) / 2));
    const sy = 0;

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setErrorMessage("Could not capture image from webcam.");
      return;
    }

    ctx.drawImage(
      video,
      sx,
      sy,
      targetWidth,
      targetHeight,
      0,
      0,
      targetWidth,
      targetHeight,
    );

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");

    setWebCameraOpen(false);

    await processSelectedIdAsset(
      {
        uri: dataUrl,
        base64,
        mimeType: "image/jpeg",
        width: targetWidth,
        height: targetHeight,
        fileName: "ADSSU_School_ID_Webcam.jpg",
      },
      "ADSSU_School_ID_Webcam.jpg",
    );
  }

  async function handleSubmitId() {
    setErrorMessage("");
    let currentUser;
    try {
      currentUser = await getCurrentUser();
    } catch (error) {
      showMessage(
        "Account Error",
        getReadableError(error, "Could not read your session."),
      );
      return;
    }
    if (!currentUser) {
      router.replace("/auth/login");
      return;
    }

    const cleanIdNumber = schoolIdNumber.trim().toUpperCase();
    if (!idImageAsset || !isIdVerified) {
      return setErrorMessage(
        "Please upload or capture your official ADSSU School ID showing the school logo, school name, your name, ID number, and course.",
      );
    }
    if (!cleanIdNumber) {
      return setErrorMessage(
        "School ID Number is required for both Buyers and Sellers.",
      );
    }
    if (
      scannedIdNumber &&
      cleanIdNumber !== scannedIdNumber.trim().toUpperCase()
    ) {
      return setErrorMessage(
        `ID Number mismatch: The ID number entered (${cleanIdNumber}) does not match the ID number on your School ID (${scannedIdNumber}).`,
      );
    }
    if (role === "seller" && !courseYear.trim()) {
      return setErrorMessage(
        "Course & Year is required for seller verification.",
      );
    }

    setSubmitting(true);
    try {
      const validIdPath = await uploadPrivateImageToSupabase(
        idImageAsset,
        "valid-ids",
        createImageUploadPath(currentUser.id, idImageAsset.mimeType),
      );

      // Auto-approves verified ADSSU ID and saves image path for Admin viewing
      const { error } = await supabase.rpc("submit_valid_id", {
        p_path: validIdPath,
        p_course_year: courseYear.trim() || null,
      });
      if (error) throw error;

      // Save the School ID Number (and Course & Year) to the profile
      const { error: profileUpdateError } = await supabase
        .from("profiles")
        .update({
          id_number: cleanIdNumber,
          course_year: courseYear.trim() || null,
        })
        .eq("id", currentUser.id);
      if (profileUpdateError) throw profileUpdateError;

      showMessage(
        "School ID Auto-Approved!",
        "Your ADSSU School ID has been verified automatically. Welcome to AgriHub!",
      );

      if (role === "seller") router.replace("/seller");
      else router.replace("/buyer");
    } catch (uploadErr: unknown) {
      const message = getReadableError(
        uploadErr,
        "Could not upload the selected ID image.",
      );
      setErrorMessage(`Submission failed: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSwitchAccount() {
    await supabase.auth.signOut();
    router.replace("/auth/login");
  }

  if (loadingProfile) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const canSubmit =
    Boolean(idImage) &&
    isIdVerified &&
    Boolean(schoolIdNumber.trim()) &&
    !verifyingId &&
    !submitting &&
    (role === "buyer" || Boolean(courseYear.trim()));

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingTop: 52, paddingBottom: 42 }}
    >
      {/* Top Header */}
      <View style={styles.topRow}>
        <View style={{ width: 38 }} />
        <Text style={styles.headerTitle}>ID Verification</Text>
        <Text style={styles.stepPill}>Auto-Check</Text>
      </View>

      {errorMessage ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <ShieldAlert size={18} color="#991B1B" />
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      ) : null}

      {/* Info Banner */}
      <View style={styles.infoCard}>
        <View style={styles.shieldCircle}>
          <ShieldCheck size={24} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.infoTitle}>
            {fullName ? `Almost done, ${fullName}!` : "Almost done!"}
          </Text>
          <Text style={styles.infoDesc}>
            Upload or take a clear photo of your official ADSSU / ASSCAT School
            ID. Valid ADSSU IDs are automatically approved by the system and
            archived for Admin inspection.
          </Text>
        </View>
      </View>

      {/* ID Upload Header */}
      <View style={styles.idHeaderRow}>
        <Text style={styles.label}>Front of School ID *</Text>
        <View style={styles.reqBadge}>
          <Text style={styles.reqBadgeText}>Required for Buyers & Sellers</Text>
        </View>
      </View>

      {/* Upload / Take Photo / Verifying / Preview Box */}
      {verifyingId ? (
        <View style={styles.idBox}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.idUploadTitle}>Checking ADSSU School ID...</Text>
          <Text style={styles.idUploadSub}>
            Verifying school logo & name, your name, ID number, and course.
          </Text>
        </View>
      ) : idImage && isIdVerified ? (
        <View style={styles.idUploadedCard}>
          <Image source={{ uri: idImage }} style={styles.idThumb} />
          <View style={{ flex: 1 }}>
            <Text style={styles.idFileName} numberOfLines={1}>
              {idFileName}
            </Text>
            <Text style={styles.idUploadedMeta}>
              {detectedSummary || "Official ADSSU School ID Verified"}
            </Text>
            <View style={styles.clearRow}>
              <CheckCircle2 size={13} color={Colors.success} />
              <Text style={styles.idClearText}>
                Verified ADSSU ID • Ready for Auto-Approval
              </Text>
            </View>
          </View>
          <View style={styles.changeActionsCol}>
            <TouchableOpacity
              style={styles.retakeBtn}
              onPress={pickIdFromGallery}
              disabled={submitting}
            >
              <RotateCcw size={13} color={Colors.primary} />
              <Text style={styles.retakeText}>Upload</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.retakeBtn}
              onPress={takeIdWithCamera}
              disabled={submitting}
            >
              <Camera size={13} color={Colors.primary} />
              <Text style={styles.retakeText}>Camera</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.idBox}>
          <Text style={styles.idUploadTitle}>
            Provide Front Photo of Your ADSSU School ID
          </Text>
          <Text style={styles.idUploadSub}>
            Must clearly show the school logo, school name, your name, ID
            number, and course. Non-ADSSU IDs are automatically declined.
          </Text>

          <View style={styles.captureActionRow}>
            <TouchableOpacity
              style={styles.uploadOptionBtn}
              onPress={pickIdFromGallery}
              disabled={submitting}
              accessibilityRole="button"
            >
              <ImagePlus size={18} color={Colors.primary} />
              <Text style={styles.uploadOptionText}>Upload Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cameraOptionBtn}
              onPress={() => void takeIdWithCamera()}
              disabled={submitting}
              accessibilityRole="button"
            >
              <Camera size={18} color="#FFF" />
              <Text style={styles.cameraOptionText}>Take a Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* School ID Number (Required for Both Buyers and Sellers) */}
      <Text style={[styles.label, styles.fieldLabel]}>School ID Number *</Text>
      <TextInput
        style={styles.textInput}
        placeholder="e.g., M-008967"
        autoCapitalize="characters"
        value={schoolIdNumber}
        onChangeText={setSchoolIdNumber}
        editable={!submitting && !verifyingId}
        accessibilityLabel="School ID Number"
        returnKeyType="next"
      />

      {/* Course & Year */}
      <Text style={[styles.label, styles.fieldLabel]}>
        Course & Year {role === "seller" ? "(required)" : "(optional)"}
      </Text>
      <TextInput
        style={styles.textInput}
        placeholder="e.g., BSIT - 3rd Year"
        value={courseYear}
        onChangeText={setCourseYear}
        editable={!submitting && !verifyingId}
        accessibilityLabel="Course and year"
        returnKeyType="done"
      />

      {/* Single Mandatory Submit Button for Both Buyers and Sellers */}
      <TouchableOpacity
        style={[styles.submitBtn, !canSubmit && styles.disabledButton]}
        onPress={() => void handleSubmitId()}
        disabled={!canSubmit}
        accessibilityRole="button"
      >
        <Text style={styles.submitText}>
          {submitting
            ? "Verifying & Saving..."
            : "Verify & Complete Registration"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.footerHint}>
        Valid ADSSU School IDs are automatically approved upon submission.
        Campus Admin can view your ID record at any time.
      </Text>

      <TouchableOpacity
        style={styles.logoutLink}
        onPress={handleSwitchAccount}
        disabled={submitting || verifyingId}
      >
        <LogOut size={14} color={Colors.textMuted} />
        <Text style={styles.logoutLinkText}>Sign out / Switch account</Text>
      </TouchableOpacity>

      {/* Live Web Camera Capture Modal (Desktop / Mobile Web) */}
      {Platform.OS === "web" && (
        <Modal
          visible={webCameraOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setWebCameraOpen(false)}
        >
          <View style={styles.camModalOverlay}>
            <View style={styles.camModalCard}>
              <View style={styles.camModalHeader}>
                <Text style={styles.camModalTitle}>
                  Position Front of ADSSU ID Inside Frame
                </Text>
                <TouchableOpacity
                  style={styles.camCloseBtn}
                  onPress={() => setWebCameraOpen(false)}
                >
                  <X size={18} color={Colors.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.camViewport}>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
                {/* Upright ID Card Alignment Guide */}
                <View pointerEvents="none" style={styles.idGuideOverlay}>
                  <View style={styles.idGuideFrame} />
                </View>

                {!webCameraReady && (
                  <View style={styles.camLoadingOverlay}>
                    <ActivityIndicator size="large" color="#FFF" />
                    <Text style={styles.camLoadingText}>
                      Starting camera...
                    </Text>
                  </View>
                )}
              </View>

              <Text style={styles.camHintText}>
                Hold your ADSSU School ID upright inside the green box so the
                logo, your name, ID number, and course are sharp and readable.
              </Text>

              <View style={styles.camFooterBtns}>
                <TouchableOpacity
                  style={styles.camCancelBtn}
                  onPress={() => setWebCameraOpen(false)}
                >
                  <Text style={styles.camCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.camCaptureBtn,
                    !webCameraReady && { opacity: 0.5 },
                  ]}
                  disabled={!webCameraReady}
                  onPress={() => void captureWebCameraFrame()}
                >
                  <Camera size={18} color="#FFF" />
                  <Text style={styles.camCaptureText}>Capture ID Photo</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFF",
  },
  container: { flex: 1, backgroundColor: "#FFF" },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  headerTitle: { fontSize: 20, fontWeight: "800", color: Colors.text },
  stepPill: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.primary,
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  errorBannerText: {
    flex: 1,
    color: "#991B1B",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
  },
  shieldCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#DCFCE7",
    justifyContent: "center",
    alignItems: "center",
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.text,
    marginBottom: 4,
  },
  infoDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  idHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.text,
  },
  fieldLabel: { marginTop: 18, marginBottom: 8 },
  textInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: Colors.text,
    backgroundColor: "#FFF",
    fontSize: 13,
  },
  reqBadge: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  reqBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#B45309",
  },
  idBox: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.primary,
    borderRadius: 16,
    backgroundColor: "#F0FDF4",
    paddingVertical: 26,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  idUploadTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.primary,
    textAlign: "center",
  },
  idUploadSub: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 17,
  },
  captureActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
    justifyContent: "center",
  },
  uploadOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF",
    borderWidth: 1.5,
    borderColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
  },
  uploadOptionText: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.primary,
  },
  cameraOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
  },
  cameraOptionText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFF",
  },
  idUploadedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  idThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: "#E5E7EB",
  },
  idFileName: { fontSize: 13, fontWeight: "700", color: Colors.text },
  idUploadedMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  clearRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  idClearText: { fontSize: 11, fontWeight: "700", color: Colors.success },
  changeActionsCol: {
    gap: 6,
  },
  retakeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: "#FFF",
  },
  retakeText: { fontSize: 11, fontWeight: "700", color: Colors.primary },
  submitBtn: {
    backgroundColor: Colors.primary,
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 24,
  },
  disabledButton: { opacity: 0.55 },
  submitText: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  footerHint: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: 14,
  },
  logoutLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 18,
  },
  logoutLinkText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textMuted,
  },

  // Live Web Camera Modal Styles
  camModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.78)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  camModalCard: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#FFF",
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  camModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  camModalTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: Colors.text,
  },
  camCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  camViewport: {
    width: "100%",
    height: 360,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#111827",
    position: "relative",
  },
  idGuideOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  idGuideFrame: {
    width: 220,
    height: 310,
    borderRadius: 14,
    borderWidth: 2.5,
    borderStyle: "dashed",
    borderColor: "#4ADE80",
    backgroundColor: "rgba(74, 222, 128, 0.06)",
  },
  camLoadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  camLoadingText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
  },
  camHintText: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 17,
  },
  camFooterBtns: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  camCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },
  camCancelText: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.text,
  },
  camCaptureBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  camCaptureText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFF",
  },
});
