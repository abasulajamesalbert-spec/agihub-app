// src/lib/verifyGcashReceipt.ts
import { supabase } from "./supabase";

const OFFICIAL_GCASH_LAST10 = "9560786790"; // Matches +63 956 078 6790 or 0956 078 6790
const OCR_API_KEY = "K8119789838933088957";

export interface ReceiptVerificationResult {
  isValid: boolean;
  reason?: string;
  referenceNumber?: string;
}

async function assetToDataUrl(
  uri: string,
  base64?: string | null,
  mimeType?: string | null,
): Promise<string> {
  if (base64) {
    return base64.startsWith("data:")
      ? base64
      : `data:${mimeType || "image/jpeg"};base64,${base64}`;
  }
  const res = await fetch(uri);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not read image."));
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(blob);
  });
}

async function enhanceLowLightImage(rawDataUrl: string): Promise<string> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return rawDataUrl;
  }
  try {
    return await new Promise<string>((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const maxDim = 1400;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        let minLuma = 255;
        let maxLuma = 0;

        for (let i = 0; i < data.length; i += 4) {
          const luma =
            0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          if (luma < minLuma) minLuma = luma;
          if (luma > maxLuma) maxLuma = luma;
        }

        const range = Math.max(1, maxLuma - minLuma);
        for (let i = 0; i < data.length; i += 4) {
          const luma =
            0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const stretched = Math.min(
            255,
            Math.max(0, Math.round(((luma - minLuma) / range) * 255)),
          );
          data[i] = stretched;
          data[i + 1] = stretched;
          data[i + 2] = stretched;
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(rawDataUrl);
      img.src = rawDataUrl;
    });
  } catch {
    return rawDataUrl;
  }
}

async function callOcrSpace(
  dataUrl: string,
  engine: "2" | "1",
): Promise<{ text: string; rateLimited: boolean }> {
  const formData = new FormData();
  formData.append("apikey", OCR_API_KEY);
  formData.append("base64Image", dataUrl);
  formData.append("language", "eng");
  formData.append("OCREngine", engine);
  formData.append("scale", "true");

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: formData,
  });
  if (response.status === 429 || response.status === 403) {
    return { text: "", rateLimited: true };
  }
  const result = await response.json();
  const errStr = Array.isArray(result?.ErrorMessage)
    ? result.ErrorMessage.join(" ")
    : String(result?.ErrorMessage || "");
  if (/limit|rate|quota|maximum/i.test(errStr)) {
    return { text: "", rateLimited: true };
  }
  return {
    text: result?.ParsedResults?.[0]?.ParsedText || "",
    rateLimited: false,
  };
}

export async function verifyGcashReceiptImage(
  asset: { uri: string; base64?: string | null; mimeType?: string | null },
  expectedAmount: number,
): Promise<ReceiptVerificationResult> {
  try {
    const rawDataUrl = await assetToDataUrl(
      asset.uri,
      asset.base64,
      asset.mimeType,
    );

    // 1. Scan original image first
    let scan = await callOcrSpace(rawDataUrl, "2");
    if (scan.rateLimited) {
      return {
        isValid: false,
        reason:
          "Receipt scanner is busy right now. Please wait 5 seconds and tap the receipt to try again.",
      };
    }

    let rawText = scan.text;

    // 2. If empty (e.g. dark photo of a phone screen), enhance contrast and retry
    if (!rawText.trim()) {
      const enhancedUrl = await enhanceLowLightImage(rawDataUrl);
      const retryScan = await callOcrSpace(enhancedUrl, "1");
      if (retryScan.rateLimited) {
        return {
          isValid: false,
          reason:
            "Receipt scanner is busy right now. Please wait 5 seconds and try again.",
        };
      }
      rawText = retryScan.text;
    }

    const normalizedText = rawText.replace(/\s+/g, " ").trim();
    const digitsOnly = rawText.replace(/\D/g, "");

    if (!normalizedText) {
      return {
        isValid: false,
        reason:
          "Receipt is unclear or not readable. Please upload a clearer GCash receipt screenshot.",
      };
    }

    // 3. Check if it is an official GCash receipt
    const isGcash =
      /sent\s*via\s*gcash/i.test(normalizedText) ||
      /express\s*send/i.test(normalizedText) ||
      /total\s*amount\s*sent/i.test(normalizedText) ||
      /gcash/i.test(normalizedText);
    if (!isGcash) {
      return {
        isValid: false,
        reason:
          "Receipt is not readable as a valid GCash receipt. Please upload an official GCash Express Send receipt.",
      };
    }

    // 4. Extract 12-13 digit GCash Reference Number
    const refLabelMatch = normalizedText.match(
      /Ref\.?\s*No\.?[:\s,.-]*([0-9\s]{12,18})/i,
    );
    let referenceNumber = refLabelMatch
      ? refLabelMatch[1].replace(/\D/g, "")
      : undefined;

    if (!referenceNumber || referenceNumber.length < 12) {
      const spacedDigitsMatch = normalizedText.match(
        /\b(\d{4}\s*\d{3}\s*\d{6}|\d{12,13})\b/,
      );
      if (spacedDigitsMatch) {
        const candidate = spacedDigitsMatch[1].replace(/\D/g, "");
        if (candidate.length >= 12 && candidate.length <= 13) {
          referenceNumber = candidate;
        }
      }
    }

    if (!referenceNumber || referenceNumber.length < 12) {
      return {
        isValid: false,
        reason:
          "Receipt is unclear or not readable (missing GCash Reference Number). Please upload a clearer receipt.",
      };
    }

    // 5. Check immediately if this GCash Reference Number has already been used
    const cleanRef = referenceNumber.replace(/\D/g, "");
    const { data: alreadyUsed, error: dupCheckError } = await supabase.rpc(
      "check_gcash_reference_used",
      { p_reference_number: cleanRef },
    );
    if (dupCheckError) {
      return {
        isValid: false,
        reason: `Could not verify receipt uniqueness: ${dupCheckError.message}`,
      };
    }
    if (alreadyUsed === true) {
      return {
        isValid: false,
        reason: `This GCash receipt (Ref No. ${cleanRef}) has already been used. Please upload a new payment receipt.`,
      };
    }

    // 6. Verify official recipient GCash number (+63 956 078 6790 / 0956 078 6790)
    if (!digitsOnly.includes(OFFICIAL_GCASH_LAST10)) {
      return {
        isValid: false,
        reason:
          "Wrong recipient GCash number. Please send your payment to 0956 078 6790.",
      };
    }

    // 7. Verify exact payment amount
    const formattedExpected = expectedAmount.toFixed(2);
    const amountRegex = new RegExp(
      `(?:PHP|₱|P|Amount|Sent)?\\s*${formattedExpected.replace(".", "[.,]")}`,
      "i",
    );
    if (!amountRegex.test(normalizedText)) {
      return {
        isValid: false,
        reason: `Amount does not match the required ₱${formattedExpected}. Please upload a receipt for ₱${formattedExpected}.`,
      };
    }

    return {
      isValid: true,
      referenceNumber,
    };
  } catch (error) {
    return {
      isValid: false,
      reason:
        error instanceof Error
          ? error.message
          : "Receipt is unclear or not readable. Please try again.",
    };
  }
}
