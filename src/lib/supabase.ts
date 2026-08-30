import { createClient } from "@supabase/supabase-js";
import { STORAGE_BUCKET } from "./storage-constants";

export { STORAGE_BUCKET } from "./storage-constants";

type SupabaseAdmin = ReturnType<typeof createClient>;

let supabaseAdmin: SupabaseAdmin | null = null;

export function getSupabaseAdmin(): SupabaseAdmin {
  if (supabaseAdmin) return supabaseAdmin;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para usar o armazenamento.",
    );
  }

  // Client com service_role — usado apenas em Server Components e Route Handlers.
  // NUNCA exponha no cliente (browser).
  supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
  return supabaseAdmin;
}

export function getPublicUrl(path: string): string {
  const supabaseAdmin = getSupabaseAdmin();
  const { data } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
