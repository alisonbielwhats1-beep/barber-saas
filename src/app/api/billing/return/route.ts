import { NextResponse } from "next/server";
// Informational callback only. No query parameter can grant access or change a contract.
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/assinatura", request.url));
}
