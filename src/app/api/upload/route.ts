import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { randomUUID } from "node:crypto";
import { authOptions } from "@/lib/auth";
import { withUser } from "@/lib/prisma-tenant";
import { getSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";
import {
  canUploadToFolder,
  detectImageMimeType,
  ImageUploadValidationError,
  isUploadFolder,
  normalizeUploadedImage,
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
  // withUser, não withTenant: só a GUC de usuário está disponível aqui — é
  // esta mesma consulta que decide qual salão vale, igual setActiveSalon.
  const membership = await withUser(session.user.id, (tx) =>
    tx.membership.findFirst({
      where: {
        userId: session.user.id,
        ...(activeSalonId ? { salonId: activeSalonId } : {}),
      },
      select: { salonId: true, role: true },
      orderBy: { id: "asc" },
    }),
  );
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

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const header = fileBytes.slice(0, 16);
  const detectedType = detectImageMimeType(header);
  if (!detectedType || detectedType !== file.type) {
    return NextResponse.json(
      { error: "Formato inválido. Use JPG, PNG ou WEBP." },
      { status: 415 },
    );
  }

  let normalized: Awaited<ReturnType<typeof normalizeUploadedImage>>;
  try {
    normalized = await normalizeUploadedImage(fileBytes, detectedType);
  } catch (error) {
    if (!(error instanceof ImageUploadValidationError)) throw error;
    return NextResponse.json(
      {
        error: error.code === "INVALID_DIMENSIONS"
          ? "Dimensões inválidas. Use uma imagem entre 32 e 8192 pixels por lado."
          : "A imagem está corrompida ou não pôde ser validada.",
      },
      { status: error.code === "INVALID_DIMENSIONS" ? 422 : 415 },
    );
  }
  if (normalized.bytes.byteLength > maxMb * 1024 * 1024) {
    return NextResponse.json(
      { error: `Arquivo muito grande após processamento (máx ${maxMb}MB)` },
      { status: 413 },
    );
  }

  const path = `${membership.salonId}/${folder}/${randomUUID()}.${normalized.extension}`;
  const supabaseAdmin = getSupabaseAdmin();

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(path, normalized.bytes, { contentType: normalized.mimeType, upsert: false });

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
