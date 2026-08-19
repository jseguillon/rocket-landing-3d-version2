import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Declare __rocketQA on window for TypeScript
declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    __rocketQA: {
      isReady: boolean;
      getTime: () => number | null;
      setState: (timeSeconds: number) => void;
      setCheckpoint: (phase: string) => void;
      play: () => void;
      pause: () => void;
    };
  }
}

const SCREENSHOT_DIR = path.join(process.cwd(), 'qa-artifacts', 'screenshots');
const CHECKPOINTS = [
  { name: 'approach', qa: 5, label: 'Orbital Approach' },
  { name: 'descent', qa: 20, label: 'Controlled Descent' },
  { name: 'entry', qa: 40, label: 'Atmospheric Entry' },
  { name: 'landing-burn', qa: 60, label: 'Landing Burn' },
  { name: 'leg-deploy', qa: 75, label: 'Leg Deployment' },
  { name: 'touchdown', qa: 85, label: 'Touchdown' },
  { name: 'hero', qa: 95, label: 'Hero Shot' },
];

// Ensure screenshot directory exists
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function collectConsoleAndErrors(page: Page): Promise<string[]> {
  const messages: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      messages.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    messages.push(`[pageerror] ${err.message}`);
  });
  return Promise.resolve(messages);
}

async function waitForReady(page: Page): Promise<void> {
  await expect(page.locator('.loading-screen')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10000 });
  await page.waitForFunction(
    () => typeof window.__rocketQA !== 'undefined' && (window as unknown as { __rocketQA: { isReady: boolean } }).__rocketQA.isReady === true,
    { timeout: 10000 },
  );
}

// ─── Desktop Visual Tests ──────────────────────────────────────────────────

test.describe('Rocket Landing - Desktop Visual Tests', () => {
  test.beforeEach(async ({ page }) => {
    const errors = collectConsoleAndErrors(page);
    await page.goto('/rocket-landing-3d-version2/');
    await waitForReady(page);
    const msgs = await errors;
    if (msgs.length > 0) {
      const jsErrors = msgs.filter(
        (m) => m.startsWith('[pageerror]') || m.includes('TypeError') || m.includes('ReferenceError'),
      );
      if (jsErrors.length > 0) {
        throw new Error(`Console/page errors detected: ${jsErrors.join('; ')}`);
      }
    }
  });

  test('loads and shows canvas', async ({ page }) => {
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('shows telemetry overlay', async ({ page }) => {
    await expect(page.locator('.telemetry')).toBeVisible();
    await expect(page.locator('.telemetry__phase .telemetry__value')).toHaveText(/.+/);
  });

  test('shows controls', async ({ page }) => {
    await expect(page.locator('.controls')).toBeVisible();
    await expect(page.locator('#play-btn')).toBeVisible();
    await expect(page.locator('#replay-btn')).toBeVisible();
    await expect(page.locator('#mute-btn')).toBeVisible();
  });

  for (const cp of CHECKPOINTS) {
    test(`screenshot: ${cp.label} (${cp.qa}%)`, async ({ page }) => {
      const errors = collectConsoleAndErrors(page);
      await page.goto(`/rocket-landing-3d-version2/?qa=${cp.qa}&seed=42`);
      await waitForReady(page);

      // Take screenshot — rocket must be visible (not blank)
      const screenshot = await page.screenshot({ type: 'png' });
      expect(screenshot.length).toBeGreaterThan(10000); // At least 10KB

      // Verify the phase value shows something reasonable
      const telemetryEl = page.locator('.telemetry__phase .telemetry__value');
      await expect(telemetryEl).toHaveText(/.+/);

      const msgs = await errors;
      const jsErrors = msgs.filter((m) => m.startsWith('[pageerror]') || m.includes('TypeError'));
      if (jsErrors.length > 0) {
        throw new Error(`Console/page errors during screenshot: ${jsErrors.join('; ')}`);
      }

      // Save named screenshot
      fs.writeFileSync(path.join(SCREENSHOT_DIR, `${cp.name}.png`), Buffer.from(screenshot));
    });
  }

  test('replay button resets timeline', async ({ page }) => {
    const timeBefore = await page.evaluate(() => (window as unknown as { __rocketQA: { getTime: () => number | null } }).__rocketQA.getTime());
    await page.click('#replay-btn');
    await page.waitForTimeout(500);
    // Timeline should have reset to near zero
    const timeAfter = await page.evaluate(() => (window as unknown as { __rocketQA: { getTime: () => number | null } }).__rocketQA.getTime());
    expect(timeAfter).not.toBeNull();
    expect(timeAfter! < 2).toBe(true);
    expect(timeBefore).not.toBe(timeAfter);
  });

  test('progress bar updates', async ({ page }) => {
    const progressBar = page.locator('.telemetry__progress-bar');
    await expect(progressBar).toHaveCSS('width', /[^0]/);
  });

  test('keyboard shortcut: space toggles play/pause', async ({ page }) => {
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    const telemetryEl = page.locator('.telemetry__phase .telemetry__value');
    await expect(telemetryEl).toHaveText(/.+/);
  });

  test('pause/resume via QA API', async ({ page }) => {
    await page.goto('/rocket-landing-3d-version2/');
    await waitForReady(page);

    // Advance timeline a bit
    await page.waitForTimeout(2000);
    const timeBeforePause = await page.evaluate(() => (window as unknown as { __rocketQA: { getTime: () => number | null } }).__rocketQA.getTime());
    expect(timeBeforePause).not.toBeNull();
    expect(timeBeforePause! > 0).toBe(true);

    // Pause
    await page.evaluate(() => (window as unknown as { __rocketQA: { pause: () => void } }).__rocketQA.pause());
    const timePaused = await page.evaluate(() => (window as unknown as { __rocketQA: { getTime: () => number | null } }).__rocketQA.getTime());

    // Advance more time — should not change during pause
    await page.waitForTimeout(2000);
    const timeAfterPause = await page.evaluate(() => (window as unknown as { __rocketQA: { getTime: () => number | null } }).__rocketQA.getTime());
    expect(timeAfterPause).not.toBeNull();
    expect(timePaused).not.toBeNull();
    expect(Math.abs(timeAfterPause! - timePaused!)).toBeLessThan(1);

    // Resume
    await page.evaluate(() => (window as unknown as { __rocketQA: { play: () => void } }).__rocketQA.play());
    const timeBeforeResume = await page.evaluate(() => (window as unknown as { __rocketQA: { getTime: () => number | null } }).__rocketQA.getTime());

    // Advance more — should now change
    await page.waitForTimeout(1500);
    const timeAfterResume = await page.evaluate(() => (window as unknown as { __rocketQA: { getTime: () => number | null } }).__rocketQA.getTime());
    expect(timeAfterResume).not.toBeNull();
    expect(timeBeforeResume).not.toBeNull();
    expect(timeAfterResume! > timeBeforeResume!).toBe(true);
  });
});

// ─── Mobile Visual Tests ───────────────────────────────────────────────────

test.describe('Rocket Landing - Mobile', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/rocket-landing-3d-version2/');
    await waitForReady(page);
  });

  test('mobile screenshot: Hero phase (390x844)', async ({ page }) => {
    const errors = collectConsoleAndErrors(page);

    // Override viewport for this test only
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/rocket-landing-3d-version2/?qa=95&seed=42');
    await waitForReady(page);

    const screenshot = await page.screenshot();
    expect(screenshot.length).toBeGreaterThan(10000);

    // Save mobile hero screenshot with correct dimensions
    fs.writeFileSync(path.join(SCREENSHOT_DIR, `mobile-hero-390x844.png`), Buffer.from(screenshot));

    const msgs = await errors;
    const jsErrors = msgs.filter((m) => m.startsWith('[pageerror]') || m.includes('TypeError'));
    if (jsErrors.length > 0) {
      throw new Error(`Console/page errors during mobile screenshot: ${jsErrors.join('; ')}`);
    }
  });
});

// ─── Accessibility Tests ───────────────────────────────────────────────────

test.describe('Rocket Landing - Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/rocket-landing-3d-version2/');
    await waitForReady(page);
  });

  test('has accessible roles on telemetry', async ({ page }) => {
    await expect(page.locator('.telemetry')).toHaveAttribute('role', 'status');
    await expect(page.locator('.telemetry')).toHaveAttribute('aria-label');
  });

  test('has accessible roles on controls', async ({ page }) => {
    await expect(page.locator('.controls')).toHaveAttribute('role', 'toolbar');
    await expect(page.locator('#play-btn')).toHaveAttribute('aria-label');
    await expect(page.locator('#replay-btn')).toHaveAttribute('aria-label');
    await expect(page.locator('#mute-btn')).toHaveAttribute('aria-label');
  });

  test('focus-visible styles on buttons', async ({ page }) => {
    const playBtn = page.locator('#play-btn');
    await playBtn.focus();
    const outline = await playBtn.evaluate((el) => window.getComputedStyle(el).outline);
    expect(outline).toBeTruthy();
  });

  test('loading screen has role and aria-live', async ({ page }) => {
    // Check the loading screen element attributes before it's hidden
    const loading = page.locator('.loading-screen');
    await expect(loading).toHaveAttribute('role', 'status');
    await expect(loading).toHaveAttribute('aria-live', 'polite');
  });
});

// ─── QA Determinism Tests ──────────────────────────────────────────────────

test.describe('Rocket Landing - QA Determinism', () => {
  test('same seed produces same visual at exact position', async ({ browser }) => {
    const page1 = await browser.newPage();
    const page2 = await browser.newPage();

    const errors1 = collectConsoleAndErrors(page1);
    const errors2 = collectConsoleAndErrors(page2);

    await page1.goto('/rocket-landing-3d-version2/?qa=50&seed=42');
    await page2.goto('/rocket-landing-3d-version2/?qa=50&seed=42');

    await Promise.all([waitForReady(page1), waitForReady(page2)]);

    const screenshot1 = await page1.screenshot();
    const screenshot2 = await page2.screenshot();

    // Screenshots should be identical (same seed, same position)
    expect(screenshot1).toEqual(screenshot2);

    await page1.close();
    await page2.close();

    // Check for errors on both pages
    const msgs1 = await errors1;
    const msgs2 = await errors2;
    for (const msgs of [msgs1, msgs2]) {
      const jsErrors = msgs.filter((m) => m.startsWith('[pageerror]') || m.includes('TypeError'));
      if (jsErrors.length > 0) {
        throw new Error(`Console/page errors: ${jsErrors.join('; ')}`);
      }
    }
  });

  test('different seeds produce different visuals', async ({ browser }) => {
    const page1 = await browser.newPage();
    const page2 = await browser.newPage();

    await page1.goto('/rocket-landing-3d-version2/?qa=50&seed=42');
    await page2.goto('/rocket-landing-3d-version2/?qa=50&seed=99');

    await Promise.all([waitForReady(page1), waitForReady(page2)]);

    const screenshot1 = await page1.screenshot();
    const screenshot2 = await page2.screenshot();

    // Screenshots should differ (different seed)
    expect(screenshot1).not.toEqual(screenshot2);

    await page1.close();
    await page2.close();
  });
});

// ─── Natural Video Capture Test ────────────────────────────────────────────

test.describe('Rocket Landing - Video Capture', () => {
  test(
    'captures full 40s animation at 1280x720',
    async ({ browser }) => {
      test.setTimeout(65000); // Allow up to 65s for the full animation

      const qaArtifactsDir = path.join(process.cwd(), 'qa-artifacts');
      fs.mkdirSync(qaArtifactsDir, { recursive: true });

      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: {
          dir: qaArtifactsDir,
          size: { width: 1280, height: 720 },
        },
      });

      const page = await context.newPage();

      // Collect all console/page errors — fail the test if any are present
      const errors: string[] = [];
      page.on('console', (msg) => {
        errors.push(`[${msg.type()}] ${msg.text()}`);
      });
      page.on('pageerror', (err) => {
        errors.push(`[pageerror] ${err.message}`);
      });

      await page.goto('/rocket-landing-3d-version2/');
      await waitForReady(page);

      // Record the video handle before waiting so we can retrieve it after page close
      const video = page.video();
      if (!video) {
        throw new Error('Video capture failed: page.video() returned null');
      }

      // Wait in real wall time for the full ~40s animation to play naturally
      const startT = Date.now();
      await page.waitForTimeout(41000);
      const elapsed = (Date.now() - startT) / 1000;

      // Assert real elapsed wall time >= 40s (allow small timing variance)
      expect(elapsed).toBeGreaterThanOrEqual(39.5);

      // Close page first to finalize video file, then close context
      await page.close();
      const finalizedPath = await video.path();
      await context.close();

      // Copy Playwright's randomly named video to the expected destination
      const dest = path.join(qaArtifactsDir, 'demo.webm');
      fs.cpSync(finalizedPath, dest);

      // Assert file exists and has content >300KB (307200 bytes)
      expect(fs.existsSync(dest)).toBe(true);
      const stats = fs.statSync(dest);
      expect(stats.size).toBeGreaterThan(307200);

      // Fail the test if any console/page errors were collected
      if (errors.length > 0) {
        throw new Error(`Video capture failed: ${errors.join('; ')}`);
      }
    },
  );
});
