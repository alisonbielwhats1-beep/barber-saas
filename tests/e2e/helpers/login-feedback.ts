import { expect, type ConsoleMessage, type Page } from "@playwright/test";

/** Observe insertions, including alerts removed before the destination renders. */
export async function submitLoginWithoutErrorFlash(page: Page) {
  const alerts: string[] = [];
  const capture = (message: ConsoleMessage) => {
    if (message.text().startsWith("test:login-alert:")) alerts.push(message.text());
  };
  page.on("console", capture);
  await page.locator("form").evaluate((form) => {
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          for (const alert of [
            ...(node.matches('[role="alert"]') ? [node] : []),
            ...node.querySelectorAll('[role="alert"]'),
          ]) {
            if (alert.textContent?.trim()) console.log(`test:login-alert:${alert.textContent}`);
          }
        }
      }
    }).observe(form, { childList: true, subtree: true });
  });
  try {
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toHaveCount(0);
    expect(alerts, "Successful login must never render an error alert").toEqual([]);
  } finally {
    page.off("console", capture);
  }
}
