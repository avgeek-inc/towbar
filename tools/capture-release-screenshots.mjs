import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const repository = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = path.join(repository, "tools/release-screenshots.json");
const appOrigin =
  process.env.TOWBAR_SCREENSHOT_ORIGIN ?? "http://127.0.0.1:4021";
const apiOrigin =
  process.env.TOWBAR_SCREENSHOT_API_ORIGIN ?? "http://127.0.0.1:4420";
const chrome =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const viewport = { width: 1280, height: 720 };
const deviceScaleFactor = 2;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function validateFixture() {
  const response = await fetch(
    new URL("/v1/core/notifications/providers", apiOrigin),
  );
  if (!response.ok)
    throw new Error(
      `Towbar fixture API is unavailable at ${apiOrigin} (${response.status})`,
    );
  const payload = await response.json();
  if (!payload.providers?.slack)
    throw new Error(
      "Start the fixture API with TOWBAR_FIXTURE_NOTIFICATION_PROVIDERS_CONFIGURED=true before capturing release screenshots",
    );
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

class CdpClient {
  #id = 0;
  #pending = new Map();

  constructor(url) {
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.#id;
    const response = new Promise((resolve, reject) =>
      this.#pending.set(id, { resolve, reject }),
    );
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return response;
  }

  close() {
    this.socket.close();
  }
}

async function startBrowser(theme) {
  const port = await availablePort();
  const profile = await mkdtemp(path.join(tmpdir(), "towbar-screenshots-"));
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${path.join(profile, "chrome")}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let version;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        version = await response.json();
        break;
      }
    } catch {}
    await delay(100);
  }
  if (!version) throw new Error("Chrome DevTools did not become ready");
  const client = new CdpClient(version.webSocketDebuggerUrl);
  const { targetId } = await client.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await client.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send(
    "Emulation.setDeviceMetricsOverride",
    { ...viewport, deviceScaleFactor, mobile: false },
    sessionId,
  );
  await client.send(
    "Emulation.setPageScaleFactor",
    { pageScaleFactor: 1 },
    sessionId,
  );
  await client.send(
    "Emulation.setEmulatedMedia",
    {
      media: "screen",
      features: [{ name: "prefers-color-scheme", value: theme }],
    },
    sessionId,
  );
  await client.send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `try { localStorage.setItem("towbar-ui-theme", ${JSON.stringify(theme)}); } catch {}`,
    },
    sessionId,
  );
  return {
    client,
    sessionId,
    async close() {
      client.close();
      child.kill("SIGTERM");
      const exited = await Promise.race([
        new Promise((resolve) => child.once("exit", () => resolve(true))),
        delay(2_000).then(() => false),
      ]);
      if (!exited) child.kill("SIGKILL");
      await rm(profile, { recursive: true, force: true });
    },
  };
}

async function evaluate(browser, expression) {
  const result = await browser.client.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    browser.sessionId,
  );
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.text ?? "Browser evaluation failed",
    );
  return result.result.value;
}

async function waitForPage(browser) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await evaluate(
      browser,
      'document.readyState === "complete" && document.body?.innerText.length > 20',
    );
    if (ready) break;
    await delay(100);
  }
  await delay(1_000);
}

async function prepareScreenshot(browser, name) {
  if (name !== "incident-detail") return;
  const clicked = await evaluate(
    browser,
    `(() => {
      const control = [...document.querySelectorAll("button,a")].find(
        (element) => element.textContent?.trim() === "View Incident",
      );
      control?.click();
      return Boolean(control);
    })()`,
  );
  if (!clicked) throw new Error("Could not open the incident detail fixture");
  await delay(500);
}

async function preparePageForCapture(browser) {
  const captureStyles = `
    html { scroll-behavior: auto !important; }
    *, *::before, *::after {
      animation: none !important;
      caret-color: transparent !important;
      transition: none !important;
    }
    ::selection { background: transparent !important; color: inherit !important; }
    nextjs-portal, [data-next-badge-root], [data-nextjs-toast] {
      display: none !important;
    }
  `;
  const captureState = await evaluate(
    browser,
    `(() => {
      window.scrollTo(0, 0);
      window.getSelection()?.removeAllRanges();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      document
        .querySelectorAll("nextjs-portal, [data-next-badge-root], [data-nextjs-toast]")
        .forEach((element) => element.remove());
      const style = document.createElement("style");
      style.dataset.towbarScreenshot = "true";
      style.textContent = ${JSON.stringify(captureStyles)};
      document.head.append(style);
      return {
        hasNextDevelopmentUi: Boolean(
          document.querySelector("nextjs-portal, [data-next-badge-root], [data-nextjs-toast]"),
        ),
        hasSelection: !window.getSelection()?.isCollapsed,
      };
    })()`,
  );
  if (captureState.hasNextDevelopmentUi)
    throw new Error("Next.js development UI is still visible before capture");
  if (captureState.hasSelection)
    throw new Error("Text selection is still active before capture");
  await delay(100);
}

async function capture(browser, screenshot, theme) {
  const url = new URL(screenshot.route, appOrigin).toString();
  await browser.client.send("Page.navigate", { url }, browser.sessionId);
  await waitForPage(browser);
  await prepareScreenshot(browser, screenshot.name);
  const problem = await evaluate(
    browser,
    `(() => {
      const text = document.body?.innerText ?? "";
      if (text.includes("This page could not be found")) return "404 page";
      if (text.includes("Runtime TypeError")) return "Next.js runtime error";
      if (text.includes("Couldn't load this view")) return "failed view";
      return null;
    })()`,
  );
  if (problem) throw new Error(`${screenshot.name} rendered a ${problem}`);
  await preparePageForCapture(browser);
  const result = await browser.client.send(
    "Page.captureScreenshot",
    {
      format: "jpeg",
      quality: 100,
      captureBeyondViewport: false,
      fromSurface: true,
      clip: {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height,
        scale: 1,
      },
    },
    browser.sessionId,
  );
  const target = screenshot.themes.find((item) => item.theme === theme);
  if (!target) throw new Error(`${screenshot.name} has no ${theme} target`);
  await writeFile(path.join(repository, target.file), result.data, "base64");
  target.width = viewport.width * deviceScaleFactor;
  target.height = viewport.height * deviceScaleFactor;
  console.log(
    `${theme.padEnd(5)} ${screenshot.name} ${target.width}x${target.height}`,
  );
}

async function updateDocumentDimensions(manifest) {
  const dimensions = new Map(
    manifest.screenshots.flatMap((screenshot) =>
      screenshot.themes.map((item) => [
        path.basename(item.file),
        { width: item.width, height: item.height },
      ]),
    ),
  );
  const guides = new Set(manifest.screenshots.flatMap((item) => item.guides));
  for (const relative of guides) {
    const file = path.join(repository, relative);
    let content = await readFile(file, "utf8");
    content = content.replace(
      /(<img\s+[^>]*?src="\/assets\/release-v2\/([^"/]+)"[^>]*?width=")\d+("\s+height=")\d+("[^>]*>)/gs,
      (match, before, name, between, after) => {
        const size = dimensions.get(name);
        return size
          ? `${before}${size.width}${between}${size.height}${after}`
          : match;
      },
    );
    await writeFile(file, content);
  }
}

await validateFixture();
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const selectedNames = new Set(process.argv.slice(2));
const screenshots = selectedNames.size
  ? manifest.screenshots.filter((item) => selectedNames.has(item.name))
  : manifest.screenshots;
if (selectedNames.size && selectedNames.size !== screenshots.length) {
  const missing = [...selectedNames].filter(
    (name) => !screenshots.some((item) => item.name === name),
  );
  throw new Error(`Unknown screenshot names: ${missing.join(", ")}`);
}
for (const theme of ["light", "dark"]) {
  const browser = await startBrowser(theme);
  try {
    for (const screenshot of screenshots)
      await capture(browser, screenshot, theme);
  } finally {
    await browser.close();
  }
}
const capturedAt = new Date().toISOString();
if (selectedNames.size)
  screenshots.forEach((screenshot) => {
    screenshot.capturedAt = capturedAt;
  });
else {
  manifest.capturedAt = capturedAt;
  manifest.screenshots.forEach((screenshot) => {
    delete screenshot.capturedAt;
  });
}
manifest.environment =
  "Local Towbar fixture on localhost:4021; examples are not production results";
manifest.viewport =
  "1280 × 720 CSS pixels rendered at 2× density (2560 × 1440); every image is limited to the visible viewport";
await updateDocumentDimensions({ screenshots });
await writeFile(
  manifestPath,
  await prettier.format(JSON.stringify(manifest), { filepath: manifestPath }),
);
