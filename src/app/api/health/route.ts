import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HealthStatus = "ok" | "unhealthy";

function jsonResponse(
  status: HealthStatus,
  httpStatus: number,
  database: "ok" | "error",
) {
  const response = NextResponse.json(
    {
      status,
      service: "salon-saas",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
      checks: { database },
    },
    { status: httpStatus },
  );
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

/**
 * Sonda pública e mínima para monitoramento. Não retorna URL, host, erro ou
 * qualquer secret; em caso de falha, apenas sinaliza que o serviço não está
 * pronto para receber tráfego.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return jsonResponse("ok", 200, "ok");
  } catch {
    console.error("[health] database check failed");
    return jsonResponse("unhealthy", 503, "error");
  }
}
