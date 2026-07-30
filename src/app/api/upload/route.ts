import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { randomUUID } from "node:crypto";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";
import {
  canUploadToFolder,
  detectImageMimeType,
  isUploadFolder,
} from "@/lib/image-upload-security";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
  rateLimitStatus,
} from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const activeSalonId = req.cookies.get("active_salon")?.value;
  const membership = await prisma.membership.findFirst({
    where: {
      userId: session.user.id,
      ...(activeSalonId ? { salonId: activeSalonId } : {}),
    },
    select: { salonId: true, role: true },
    orderBy: { id: "asc" },
  });
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const limited = await checkRateLimit({
    namespace: "uploads",
    identifier: `${membership.salonId}:${session.user.id}:${clientIp(req.headers)}`,
    limit: 20,
    windowSeconds: 60 * 60,
    failClosed: true,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error:
          limited.source === "unavailable"
            ? "security service unavailable"
            : "too many requests",
      },
      {
        status: rateLimitStatus(limited),
        headers: rateLimitHeaders(limited),
      },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const folder = formData.get("folder");

  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (
    !isUploadFolder(folder) ||
    !canUploadToFolder(membership.role, folder)
  ) {
    return NextResponse.json({ error: "invalid upload purpose" }, { status: 403 });
  }

  const maxMb = 5;
  if (file.size > maxMb * 1024 * 1024) {
    return NextResponse.json(
      { error: `Arquivo muito grande (máx ${maxMb}MB)` },
      { status: 413 },
    );
  }

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detectedType = detectImageMimeType(header);
  if (!detectedType || detectedType !== file.type) {
    return NextResponse.json(
      { error: "Formato inválido. Use JPG, PNG, WEBP ou GIF." },
      { status: 415 },
    );
  }

  const extensionByType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const ext = extensionByType[detectedType];
  const path = `${membership.salonId}/${folder}/${randomUUID()}.${ext}`;
  const supabaseAdmin = getSupabaseAdmin();

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { contentType: detectedType, upsert: false });

  if (error) {
    console.error("[upload] storage failure", {
      statusCode: error.statusCode,
    });
    return NextResponse.json(
      { error: "Não foi possível enviar a imagem." },
      { status: 500 },
    );
  }

  const { data } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
