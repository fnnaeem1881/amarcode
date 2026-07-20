import { chromium, type Browser, type Page } from "playwright";

/**
 * Headless-browser automation so the agent can test a web app like a human:
 * open it, read the rendered page, click, type, scroll, and capture console
 * errors / screenshots. One page per project root.
 */
interface Session {
  page: Page;
  consoleErrors: string[];
  pageErrors: string[];
}

let browser: Browser | null = null;
const sessions = new Map<string, Session>();

async function ensureBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ headless: true });
  return browser;
}

async function ensureSession(root: string): Promise<Session> {
  const existing = sessions.get(root);
  if (existing && !existing.page.isClosed()) return existing;
  const b = await ensureBrowser();
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const s: Session = { page, consoleErrors: [], pageErrors: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") s.consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => s.pageErrors.push(err.message.slice(0, 300)));
  sessions.set(root, s);
  return s;
}

export interface PageState {
  url: string;
  title: string;
  text: string;                 // visible text (trimmed)
  clickables: string[];         // buttons/links the agent can click
  inputs: string[];             // form fields
  consoleErrors: string[];
  pageErrors: string[];
}

async function snapshot(s: Session): Promise<PageState> {
  const page = s.page;
  const data = await page.evaluate(() => {
    const vis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const clickables = [...document.querySelectorAll('button, a, [role="button"], [onclick]')]
      .filter(vis).map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 40);
    const inputs = [...document.querySelectorAll("input, textarea, select")]
      .filter(vis).map((e) => (e as HTMLInputElement).placeholder || (e as HTMLElement).getAttribute("name") || (e as HTMLElement).getAttribute("aria-label") || "field").slice(0, 30);
    return {
      title: document.title,
      text: (document.body?.innerText || "").replace(/\n{2,}/g, "\n").slice(0, 3000),
      clickables, inputs,
    };
  });
  return {
    url: page.url(),
    title: data.title,
    text: data.text,
    clickables: [...new Set(data.clickables as string[])],
    inputs: data.inputs as string[],
    consoleErrors: [...s.consoleErrors],
    pageErrors: [...s.pageErrors],
  };
}

export async function open(root: string, url: string): Promise<PageState> {
  const s = await ensureSession(root);
  s.consoleErrors = []; s.pageErrors = [];
  await s.page.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => s.page.goto(url, { timeout: 30_000 }));
  await s.page.waitForTimeout(500);
  return snapshot(s);
}

export async function clickText(root: string, text: string): Promise<PageState> {
  const s = await ensureSession(root);
  // Try an exact-ish visible element by text, else a CSS selector.
  const byText = s.page.getByText(text, { exact: false }).first();
  try {
    await byText.click({ timeout: 5000 });
  } catch {
    await s.page.click(text, { timeout: 5000 }); // treat as selector
  }
  await s.page.waitForTimeout(400);
  return snapshot(s);
}

export async function typeInto(root: string, selector: string, value: string): Promise<PageState> {
  const s = await ensureSession(root);
  await s.page.fill(selector, value, { timeout: 5000 });
  return snapshot(s);
}

export async function scroll(root: string, direction: "down" | "up"): Promise<PageState> {
  const s = await ensureSession(root);
  await s.page.mouse.wheel(0, direction === "down" ? 600 : -600);
  await s.page.waitForTimeout(300);
  return snapshot(s);
}

export async function read(root: string): Promise<PageState> {
  const s = await ensureSession(root);
  return snapshot(s);
}

export async function screenshot(root: string): Promise<string> {
  const s = await ensureSession(root);
  const buf = await s.page.screenshot({ type: "png" });
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export async function close(root: string): Promise<void> {
  const s = sessions.get(root);
  if (s && !s.page.isClosed()) await s.page.close().catch(() => {});
  sessions.delete(root);
}
