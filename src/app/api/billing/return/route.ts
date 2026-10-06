import { NextResponse } from "next/server";
// Informational callback only. No query parameter can grant access or change a contract;
// `retorno` only tells the page to follow the provider confirmation more closely.
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/assinatura?retorno=mercadopago", request.url));
}
