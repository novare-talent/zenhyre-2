import PDFDocument from "pdfkit";
import type { Invoice } from "./service";
import { GST_STATES } from "./gst";

/** Extra lines under the totals, e.g. "Less: deposit adjusted" and "Balance payable" on a fee invoice. */
export interface InvoiceExtras { roleTitle: string; reference?: string; adjustments?: Array<{ label: string; amount: number }>; status?: string }

// The built-in PDF fonts have no ₹ glyph, so amounts read "INR 1,23,456.00".
const inr = (paise: number) => `INR ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** Renders a GST tax invoice or credit note to a PDF buffer. */
export function renderInvoicePdf(inv: Invoice, extras: InvoiceExtras): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `${inv.number}`, Author: inv.supplier.legalName } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const s = inv.supplier, b = inv.billing;
    const title = inv.kind === "credit_note" ? "CREDIT NOTE" : "TAX INVOICE";
    doc.font("Helvetica-Bold").fontSize(18).text(title, { align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor("#555").text("Original for recipient", { align: "right" }).fillColor("#000");
    doc.moveDown(0.5);

    doc.font("Helvetica-Bold").fontSize(11).text(s.legalName);
    doc.font("Helvetica").fontSize(9).text(s.address || "Address to be set in invoice.supplier");
    doc.text(`GSTIN: ${s.gstin || "(not set)"}   State: ${s.state} (${s.stateCode})`);
    doc.text(s.email);
    doc.moveDown();

    const top = doc.y;
    doc.font("Helvetica-Bold").text("Billed to", 48, top);
    doc.font("Helvetica").text(b.legalName).text(b.address).text(`State: ${b.state} (${b.stateCode})`)
      .text(`GSTIN: ${b.gstin || "Unregistered"}`).text(`${b.email} · ${b.phone}`);
    const left = doc.y;
    doc.font("Helvetica-Bold").text(inv.kind === "credit_note" ? "Credit note no." : "Invoice no.", 330, top);
    doc.font("Helvetica").text(inv.number, 330);
    doc.font("Helvetica-Bold").text("Date", 330).font("Helvetica").text(date(inv.issuedAt), 330);
    doc.font("Helvetica-Bold").text("Place of supply", 330).font("Helvetica").text(`${GST_STATES[b.stateCode] ?? b.state} (${b.stateCode})`, 330);
    if (extras.reference) doc.font("Helvetica-Bold").text("Reference", 330).font("Helvetica").text(extras.reference, 330);
    doc.y = Math.max(left, doc.y) + 16;
    doc.x = 48;

    // Lines
    const col = { desc: 48, sac: 330, amt: 420 };
    const rule = () => { doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor("#999").lineWidth(0.5).stroke(); doc.moveDown(0.3); };
    rule();
    let y = doc.y;
    doc.font("Helvetica-Bold").text("Description", col.desc, y).text("SAC", col.sac, y).text("Taxable value", col.amt, y, { width: 127, align: "right" });
    doc.moveDown(0.3); rule();
    doc.font("Helvetica");
    for (const l of inv.lines) {
      y = doc.y;
      doc.text(l.description, col.desc, y, { width: 270 });
      const h = doc.y;
      doc.text(l.sac, col.sac, y).text(inr(l.taxable), col.amt, y, { width: 127, align: "right" });
      doc.y = Math.max(h, doc.y) + 4;
    }
    rule();

    const row = (label: string, amount: number, bold = false) => {
      y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").text(label, 300, y, { width: 110 }).text(inr(amount), col.amt, y, { width: 127, align: "right" });
      doc.moveDown(0.2);
    };
    row("Taxable value", inv.taxable);
    if (inv.igst) row("IGST @ 18%", inv.igst);
    if (inv.cgst) row("CGST @ 9%", inv.cgst);
    if (inv.sgst) row("SGST @ 9%", inv.sgst);
    row(inv.kind === "credit_note" ? "Total credited" : "Total", inv.total, true);
    for (const a of extras.adjustments ?? []) row(a.label, a.amount, a.label.toLowerCase().startsWith("balance"));
    doc.moveDown();
    doc.x = 48;
    doc.font("Helvetica").fontSize(9).text(`Role: ${extras.roleTitle}`, 48);
    if (extras.status) doc.font("Helvetica-Bold").text(extras.status, 48).font("Helvetica");
    doc.moveDown();
    doc.fillColor("#555").fontSize(8).text(
      inv.kind === "credit_note"
        ? "This credit note records a refund of the deposit paid on Zenhyre. Gateway charges retained, if any, are shown in the refund email."
        : "Amounts include GST as shown. This is a computer-generated invoice and needs no signature.", 48, undefined, { width: 499 });
    doc.end();
  });
}
