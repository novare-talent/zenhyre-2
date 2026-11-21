import type { NextRequest } from "next/server";
import { streamPdf } from "../../../../pdf";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; invoiceId: string }> }) {
  const { id, invoiceId } = await ctx.params;
  return streamPdf(req, `/roles/${id}/invoices/${invoiceId}/pdf`, id, invoiceId);
}
