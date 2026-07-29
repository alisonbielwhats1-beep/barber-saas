import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";
import {
  checkRateLimit,
  clientIp,
  rateLimitHeaders,
} from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limited = await checkRateLimit({
    namespace: "uploads",
    identifier: `${session.user.id}:${clientIp(req.headers)}`,
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: rateLimitHeaders(limited) },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const requestedFolder = (formData.get("folder") as string) || "misc";
  const folder = requestedFolder.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "misc";

  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });

  const maxMb = 5;
  if (file.size > maxMb * 1024 * 1024) {
    return NextResponse.json(
      { error: `Arquivo muito grande (máx ${maxMb}MB)` },
      { status: 413 },
    );
  }

  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowed.includes(file.type)) {
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
  const ext = extensionByType[file.type];
  const path = `${session.user.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const supabaseAdmin = getSupabaseAdmin();

  // Garante que o bucket existe (cria na primeira vez, ignora se já existe)
  await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, { public: true }).catch(() => null);

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    console.error("[upload]", error);
    return NextResponse.json(
      { error: "Não foi possível enviar a imagem." },
      { status: 500 },
    );
  }

  const { data } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
