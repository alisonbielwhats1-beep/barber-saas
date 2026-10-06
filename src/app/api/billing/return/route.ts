import { NextResponse } from "next/server";
// Informational callback only. No query parameter can grant access or change a contract;
// `retorno` only tells the page to follow the provider confirmation more closely.
export async function GET(request: Request) {
  // A Secretária pack (owner, 06/10/2026) comes back to its own card, without the subscription's confirmation notice.
  if (new URL(request.url).searchParams.get("origem") === "creditos") return NextResponse.redirect(new URL("/assinatura?retorno=creditos#secretaria", request.url));
  return NextResponse.redirect(new URL("/assinatura?retorno=mercadopago", request.url));
}
