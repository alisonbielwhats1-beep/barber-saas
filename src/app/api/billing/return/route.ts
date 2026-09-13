import { billingJson } from "@/lib/billing/http";
// Informational callback only. No query parameter can grant access or change a contract.
export async function GET() {
  return billingJson({ message: "Autorização recebida. A liberação depende da confirmação do pagamento. Consulte sua assinatura no Everflair." });
}
