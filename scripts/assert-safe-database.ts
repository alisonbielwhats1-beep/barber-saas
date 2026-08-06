import { loadEnvConfig } from "@next/env";
import { assertSafeDatabaseOperation } from "../src/lib/database-safety";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const operationArgument = process.argv.find((argument) =>
  argument.startsWith("--operation="),
);
const operation = operationArgument?.slice("--operation=".length);

if (!operation) {
  throw new Error("Informe --operation=<nome-da-operação>.");
}

const target = assertSafeDatabaseOperation(process.env, {
  destructive: process.argv.includes("--destructive"),
  operation,
});

console.log(
  `[database-safety] ${target.operation} liberada em ${target.appEnvironment} (${target.target}: ${target.databaseHosts.join(", ")}).`,
);
