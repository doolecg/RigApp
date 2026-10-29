import { expect, test, type Page } from "@playwright/test";

// These read the live kernel and starter rigs from the OpenRig quick start.
// Only the send test talks to a seat, and only when RIGAPP_E2E_SEND=1, because
// it spends the seat's tokens.
const APP = "http://127.0.0.1:7490";

async function open(page: Page) {
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
}

const seatButton = (page: Page, member: string) =>
  page.locator("nav button", { hasText: new RegExp(`^${member}`) }).first();

test("shows each rig as a project with its seats by pod", async ({ page }) => {
  await open(page);
  const nav = page.locator("nav");
  for (const text of ["kernel", "starter", "Advisor", "Operator", "Queue", "Dev"]) {
    await expect(nav.getByText(text, { exact: true }).first()).toBeVisible();
  }
  await expect(seatButton(page, "lead")).toContainText("Claude Code");
  await expect(seatButton(page, "human")).toContainText("Terminal");
});

test("opens a thread with its chat, tool cards and a diff", async ({ page }) => {
  await open(page);
  await seatButton(page, "build").click();
  await expect(page.locator("header")).toContainText("dev.build");
  await expect(page.getByRole("button", { name: /^Bash/ }).first()).toBeVisible();
  const edit = page.getByRole("button", { name: /^Edit/ }).first();
  await expect(edit).toHaveAttribute("aria-expanded", "true");
});

test("a terminal seat says it has no chat", async ({ page }) => {
  await open(page);
  await seatButton(page, "human").click();
  await expect(page.getByText("This is a terminal seat")).toBeVisible();
});

test("the composer picks another seat with @ and lists actions with /", async ({ page }) => {
  await open(page);
  await seatButton(page, "lead").click();
  const box = page.getByRole("textbox", { name: /^Message/ });
  await box.fill("@que");
  await expect(page.getByRole("option", { name: /queue\.worker/ })).toBeVisible();
  await box.press("Enter");
  await expect(page.getByText("back to advisor.lead")).toBeVisible();
  await box.fill("/");
  await expect(page.getByRole("option", { name: /\/stop/ })).toBeVisible();
  await box.fill("");
});

test("Ctrl+K finds a seat and opens it", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Type a seat/).fill("review");
  await page.keyboard.press("Enter");
  await expect(page.locator("header")).toContainText("dev.review");
});

test("Overview sorts every seat by what it needs", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "What needs you" })).toBeVisible();
  for (const title of ["Waiting on you", "Errored", "Finished, ready to review", "Working"]) {
    await expect(page.getByRole("heading", { name: new RegExp(`^${title}`) })).toBeVisible();
  }
  await expect(page.getByText("dev.build")).toBeVisible();
});

test("the setup screen shows when the daemon does not answer", async ({ page }) => {
  await page.goto("http://127.0.0.1:7491");
  await expect(page.getByRole("heading", { name: "RigApp can't reach OpenRig yet" })).toBeVisible();
  await expect(page.getByText("Nothing answering on 127.0.0.1:7499")).toBeVisible();
  await expect(page.getByText("rig daemon start")).toBeVisible();
});

test("sends a message and the reply streams in", async ({ page }) => {
  test.skip(process.env.RIGAPP_E2E_SEND !== "1", "Set RIGAPP_E2E_SEND=1 to let this test message queue.worker.");
  test.setTimeout(120_000);
  await open(page);
  await seatButton(page, "worker").click();
  const word = `rigapp-${Date.now()}`;
  const box = page.getByRole("textbox", { name: /^Message/ });
  await box.fill(`RigApp end-to-end test: reply with only the word ${word}. No tools.`);
  await box.press("Enter");
  await expect(page.locator(".md", { hasText: word })).toBeVisible({ timeout: 90_000 });
});

test("the graph shows the rig's pods and seats, and a click opens a seat", async ({ page }) => {
  await open(page);
  await seatButton(page, "lead").click();
  await page.getByRole("tab", { name: "Graph" }).click();
  const seats = page.locator(".react-flow__node-seat");
  await expect(seats).toHaveCount(4);
  for (const pod of ["Advisor", "Operator", "Queue"]) await expect(page.locator(".react-flow__node-pod", { hasText: pod })).toBeVisible();
  await seats.filter({ hasText: "queue.worker" }).click();
  await expect(page.locator("header")).toContainText("queue.worker");
  await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
});

test("the terminal shows the seat's pane and asks before taking control", async ({ page }) => {
  await open(page);
  await seatButton(page, "lead").click();
  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(page.locator(".xterm-rows")).toContainText("advisor-lead@kernel", { timeout: 10_000 });
  await page.getByRole("button", { name: "Take control" }).click();
  await expect(page.getByText("Take control of advisor.lead's terminal?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Take control of advisor.lead's terminal?")).toBeHidden();
});

test("the Specs tab loads the rig's files and OpenRig validates the spec", async ({ page }) => {
  await open(page);
  await seatButton(page, "build").click();
  await page.getByRole("tab", { name: "Specs" }).click();
  await expect(page.getByRole("tab", { name: "CULTURE.md" })).toBeVisible();
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("OpenRig says this spec is valid.")).toBeVisible();
  await seatButton(page, "lead").click();
  await expect(page.getByText(/outside OpenRig's files roots/)).toBeVisible();
});

test("the Rig tab shows usage, snapshots and a plan before Rig up", async ({ page }) => {
  await open(page);
  await seatButton(page, "build").click();
  await page.getByRole("tab", { name: "Rig" }).click();
  await expect(page.getByText(/Claude, (5-hour window|weekly)/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" }).first()).toBeAttached();
  await page.getByRole("button", { name: "Rig up" }).click();
  await expect(page.getByText("OpenRig's plan", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog").getByText("dev.build")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("Ctrl+K also finds words in seat logs", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Type a seat/).fill("RigApp test");
  await expect(page.getByText("In seat logs")).toBeVisible({ timeout: 10_000 });
});

test("New project checks a library spec with OpenRig before starting", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^starter/ }).click();
  await page.getByLabel(/Project folder/).fill("E:\REPOS\AI TOOLS\RigApp");
  await page.getByRole("button", { name: "Check with OpenRig" }).click();
  await expect(page.getByText("OpenRig can start it.", { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Cancel" }).click();
});
