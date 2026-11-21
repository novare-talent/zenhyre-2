import type { NextRequest } from "next/server";
import { streamPdf } from "../../../pdf";

export async function GET(req: NextRequest, ctx: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await ctx.params;
  return streamPdf(req, `/admin/payments/invoices/${invoiceId}/pdf`, invoiceId);
}
