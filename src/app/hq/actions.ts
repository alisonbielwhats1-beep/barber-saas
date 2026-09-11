"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { withHq } from "@/lib/hq/access";
import { execute, type Command } from "@/lib/hq/services";
import { HqError } from "@/lib/hq/validation";

export async function hqCommand(command: Command) {
  try {
    const record = await withHq((tx, actorId) => execute(tx, actorId, command));
    revalidatePath("/hq", "layout");
    return { ok: true as const, id: record.id };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false as const, error: error.issues.map(i => i.path.join(".") + ": " + i.message).join(" · ") };
    if (error instanceof HqError) return { ok: false as const, error: error.message };
    if (error instanceof Prisma.PrismaClientKnownRequestError) return { ok: false as const, error: "Não foi possível salvar. Confira vínculos, valores e registros duplicados." };
    // Redirects de autenticação precisam ser tratados pelo Next, não mascarados.
    throw error;
  }
}

