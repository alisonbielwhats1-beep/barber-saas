import { loadEnvConfig } from "@next/env";
import { validateRuntimeContract } from "../src/lib/runtime-contract";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const issues = validateRuntimeContract(process.env);

if (issues.length > 0) {
  console.error("[runtime-contract] configuração inválida:");
  for (const issue of issues) {
    console.error(`- ${issue.key}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `[runtime-contract] ${process.env.APP_ENV?.trim().toLowerCase()} válido; nenhum valor secreto foi exibido.`,
  );
}
