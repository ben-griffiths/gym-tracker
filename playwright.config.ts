import { defineConfig } from "@playwright/test";
import {
  PW_BYPASS_HEADER,
  playwrightDevBypassSecret,
} from "./lib/playwright-bypass";

const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";

const e2eBypassSecret = playwrightDevBypassSecret();

/**
 * E2E targets `http://localhost:3000` (Next default). When `webServer` runs,
 * it starts `npm run dev` with bypass-auth env.
 *
 * Next.js allows only one `next dev` per project directory. Locally,
 * `reuseExistingServer: !CI` skips spawning if something already answers on
 * :3000. That process does not need bypass env vars in development: Playwright
 * sends `x-gym-playwright-bypass` so middleware + cookie still skip auth.
 *
 * To drive tests against an arbitrary URL without starting a server:
 * `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=... npm run test:e2e`
 */
const e2eBaseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const webServer = skipWebServer
  ? undefined
  : {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: process.env.CI !== "true",
      timeout: 60_000,
      env: {
        PLAYWRIGHT_BYPASS_AUTH: "true",
        NEXT_PUBLIC_PLAYWRIGHT_BYPASS_AUTH: "true",
        PLAYWRIGHT_E2E_BYPASS_SECRET: e2eBypassSecret,
      },
    };

export default defineConfig({
  reporter: "list",
  testDir: "tests/e2e",
  timeout: 10 * 60_000,
  retries: 0,
  // Every e2e test runs 3× back-to-back. The chat-webllm suite reuses the
  // engine page across tests (see `sharedPage` in chat-webllm.test.ts), so
  // cold-load is paid once. This catches LLM/UI flakes during normal runs.
  repeatEach: 3,
  use: {
    browserName: "chromium",
    baseURL: e2eBaseURL,
    extraHTTPHeaders: {
      [PW_BYPASS_HEADER]: e2eBypassSecret,
    },
    headless: false,
    launchOptions: {
      args: [
        "--enable-features=Vulkan,WebGPU",
        "--enable-unsafe-webgpu",
        "--disable-web-security",
      ],
    },
  },
  ...(webServer ? { webServer } : {}),
});
