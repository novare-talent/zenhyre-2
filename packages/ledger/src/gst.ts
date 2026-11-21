// GST on everything Zenhyre charges: the price plus GST at `gst.rate` (18%), shown separately. Pure; integer paise.
import type { Paise } from "@zenhyre/shared";

export interface Taxed { taxable: Paise; cgst: Paise; sgst: Paise; igst: Paise; gst: Paise; total: Paise }

/**
 * Same state for supplier and buyer → CGST + SGST, half each (an odd paisa goes to SGST); otherwise IGST.
 * GST is rounded to the paisa once, on the whole taxable amount.
 */
export function addGst(taxable: Paise, rate: number, supplierStateCode: string, buyerStateCode: string): Taxed {
  if (!Number.isInteger(taxable) || taxable < 0) throw new Error("taxable must be whole paise");
  const gst = Math.round(taxable * rate);
  const intra = supplierStateCode === buyerStateCode;
  const cgst = intra ? Math.floor(gst / 2) : 0;
  return { taxable, cgst, sgst: intra ? gst - cgst : 0, igst: intra ? 0 : gst, gst, total: taxable + gst };
}

/** Splits a gross amount (GST included) back into its taxable part and GST, e.g. for a refund's credit note. */
export function splitGross(total: Paise, rate: number, supplierStateCode: string, buyerStateCode: string): Taxed {
  const taxable = Math.round(total / (1 + rate));
  const gst = total - taxable;
  const intra = supplierStateCode === buyerStateCode;
  const cgst = intra ? Math.floor(gst / 2) : 0;
  return { taxable, cgst, sgst: intra ? gst - cgst : 0, igst: intra ? 0 : gst, gst, total };
}

/** The gateway's charge on a payment of `total`: `rate` plus GST on that charge, rounded to the paisa. */
export function estimateGatewayFee(total: Paise, rate: number, gstRate: number): Paise {
  return Math.round(total * rate * (1 + gstRate));
}

/** Indian financial year label for a date: April to March, "2026-27". */
export function financialYear(d: Date): string {
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** GSTIN: 2-digit state code, 10-char PAN, entity number, Z, checksum. Format check only. */
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** GST state codes, for the billing form and place of supply. */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland",
  "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};
