import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

// The seat browser's gate and panel, with no seat involved: a tool call is posted to the
// address seats use, the card appears before anything runs, and Deny or Take control
// refuses it. Needs Edge or Chrome and, on Windows, WSL (the address is the WSL gateway).
const APP = "http://127.0.0.1:7490";
const HAS_BROWSER = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].some(existsSync);

/** One request to the RigApp server over its socket, answered by `result`. */
async function ask(message: Record<string, unknown>): Promise<{ ok: boolean; data?: Record<string, unknown> }> {
  const socket = new WebSocket("ws://127.0.0.1:7490/ws");
  return new Promise((resolve) => {
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, ...message }));
    socket.onmessage = (event) => {
      const reply = JSON.parse(String(event.data));
      if (reply.type === "result" && reply.id === 1) {
        socket.close();
        resolve(reply);
      }
    };
  });
}

const call = (url: string, tool: string) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: tool, arguments: { url: "https://example.com" } } }),
  }).then((r) => r.json() as Promise<{ result: { isError: boolean; content: { text: string }[] } }>);

test("a seat browser action waits for Deny, and Take control refuses it", async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(!HAS_BROWSER, "Needs Microsoft Edge or Google Chrome");
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: /^Settings/ }).click();
  // The box only changes once the server has started the browser, so click and wait for the tab.
  await page.getByLabel(/Browser for seats/).click();
  try {
    await page.locator("nav button", { hasText: /^lead/ }).first().click();
    await page.getByRole("tab", { name: "Browser" }).click();
    await expect(page.getByLabel("Seat browser page")).toBeVisible({ timeout: 45_000 });
    const seats = await ask({ method: "tools.seatTools" });
    const address = seats.data?.browser as string | undefined;
    test.skip(!address, "The browser started without an address seats can reach");

    // The call is held until you answer: the card shows first and nothing has run.
    const held = call(address!, "browser_navigate");
    await expect(page.getByText("Open https://example.com")).toBeVisible();
    await page.getByRole("button", { name: "Deny" }).click();
    const denied = await held;
    expect(denied.result.isError).toBe(true);
    expect(denied.result.content[0]!.text).toContain("denied");

    // While you hold the browser a seat action is refused at once, with no card.
    await page.getByRole("button", { name: "Take control" }).click();
    const refused = await call(address!, "browser_navigate");
    expect(refused.result.content[0]!.text).toContain("taken control");
    await expect(page.getByText("refused, you hold it")).toBeVisible();
  } finally {
    await page.getByRole("button", { name: /^Settings/ }).click();
    await page.getByLabel(/Browser for seats/).click();
    await expect(page.getByLabel(/Browser for seats/)).not.toBeChecked();
  }
});
