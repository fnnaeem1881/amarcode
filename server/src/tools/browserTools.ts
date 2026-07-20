import type { ToolResult } from "@amarcode/shared";
import { ToolContext } from "./context.js";
import * as browser from "./browserAgent.js";
import type { PageState } from "./browserAgent.js";
import { knownUrl } from "./devServer.js";

/**
 * Human-like browser testing tools. The agent can open the app, read what
 * rendered, click, type, scroll, and see console errors — then report or fix.
 */

function format(state: PageState): string {
  const lines = [
    `URL: ${state.url}`,
    `Title: ${state.title}`,
    state.pageErrors.length ? `⚠️ PAGE ERRORS:\n- ${state.pageErrors.join("\n- ")}` : "",
    state.consoleErrors.length ? `⚠️ CONSOLE ERRORS:\n- ${state.consoleErrors.join("\n- ")}` : "✓ No console errors",
    state.clickables.length ? `Clickable: ${state.clickables.slice(0, 25).join(" · ")}` : "",
    state.inputs.length ? `Inputs: ${state.inputs.join(" · ")}` : "",
    `--- visible text ---\n${state.text}`,
  ];
  return lines.filter(Boolean).join("\n");
}

async function withShot(ctx: ToolContext, state: PageState): Promise<ToolResult> {
  try {
    const shot = await browser.screenshot(ctx.root);
    ctx.emit?.({ type: "screenshot", payload: { image: shot, url: state.url } });
  } catch { /* screenshot optional */ }
  const problems = state.pageErrors.length + state.consoleErrors.length;
  return { ok: problems === 0, output: format(state), data: { consoleErrors: state.consoleErrors, pageErrors: state.pageErrors } };
}

export async function open_in_browser(ctx: ToolContext, args: { url?: string }): Promise<ToolResult> {
  const url = args.url?.startsWith("http") ? args.url : (knownUrl(ctx.root) ?? args.url);
  if (!url) return { ok: false, output: "No URL. Pass a full URL, or start/preview a dev server first.", error: "no_url" };
  try {
    const state = await browser.open(ctx.root, url);
    return withShot(ctx, state);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /Executable doesn't exist|browserType.launch/.test(msg)
      ? " (Run 'npx playwright install chromium' in the server folder.)"
      : "";
    return { ok: false, output: `Could not open ${url}: ${msg}${hint}`, error: msg };
  }
}

export async function browser_click(ctx: ToolContext, args: { text: string }): Promise<ToolResult> {
  try { return withShot(ctx, await browser.clickText(ctx.root, args.text)); }
  catch (e) { return { ok: false, output: `Could not click "${args.text}": ${e instanceof Error ? e.message : e}`, error: "click_failed" }; }
}

export async function browser_type(ctx: ToolContext, args: { selector: string; value: string }): Promise<ToolResult> {
  try { return withShot(ctx, await browser.typeInto(ctx.root, args.selector, args.value)); }
  catch (e) { return { ok: false, output: `Could not type into "${args.selector}": ${e instanceof Error ? e.message : e}`, error: "type_failed" }; }
}

export async function browser_scroll(ctx: ToolContext, args: { direction?: "down" | "up" }): Promise<ToolResult> {
  return withShot(ctx, await browser.scroll(ctx.root, args.direction ?? "down"));
}

export async function browser_read(ctx: ToolContext): Promise<ToolResult> {
  return withShot(ctx, await browser.read(ctx.root));
}

export async function close_browser(ctx: ToolContext): Promise<ToolResult> {
  await browser.close(ctx.root);
  return { ok: true, output: "Browser closed." };
}
