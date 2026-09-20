import { expect, type Page } from "@playwright/test";
export async function openMobileAccount(page: Page) {
  await page.getByRole("button", { name: "Abrir todos os módulos" }).click();
  return page.getByRole("dialog", { name: "Todos os módulos" });
}
export async function changeAdminTheme(page: Page, theme: "claro" | "escuro") {
  const button = page.getByRole("button", { name: `Mudar para tema ${theme}` });
  const needsMenu = !(await button.isVisible());
  if (needsMenu) await openMobileAccount(page);
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme === "claro" ? "admin-light" : "admin-dark");
  if (needsMenu) await page.getByRole("dialog", { name: "Todos os módulos" }).getByRole("button", {name:"Fechar janela",exact:true}).click();
}
