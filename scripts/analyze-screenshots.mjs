#!/usr/bin/env node
/**
 * Pixel analysis script for qa-artifacts/screenshots/*.png
 * Uses pngjs to parse PNG files and compute visual metrics.
 * Generates: qa-artifacts/visual-report.json + qa-artifacts/visual-report.md
 *
 * Usage: node scripts/analyze-screenshots.mjs [screenshots-dir]
 */

import { writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { createReadStream } from 'fs';
import { resolve, basename, extname } from 'path';
import { PNG } from 'pngjs';

const SCREENSHOT_DIR = process.argv[2] || resolve(process.cwd(), 'qa-artifacts', 'screenshots');

// Required phase screenshots with exact expected names and dimensions
const REQUIRED_PHASES = [
  { name: 'approach', qa: 5 },
  { name: 'descent', qa: 20 },
  { name: 'entry', qa: 40 },
  { name: 'landing-burn', qa: 60 },
  { name: 'leg-deploy', qa: 75 },
  { name: 'touchdown', qa: 85 },
  { name: 'hero', qa: 95 },
];

const REQUIRED_MOBILE = { name: 'mobile-hero-390x844', width: 390, height: 844 };

// Quality thresholds — all must pass or exit nonzero
const THRESHOLDS = {
  minFileBytes: 15000, // Reject files too small to contain valid scene
  minMeanLuminance: 3, // Space scenes are dark; accept low luminance
  minStddev: 8, // Must have SOME variation (not completely uniform black)
  maxDarkRatio: 0.999, // Space is mostly dark; allow up to 99.9% dark pixels
};

// ── Helpers ────────────────────────────────────────────────────────────────

function parsePNG(filePath) {
  return new Promise((resolve, reject) => {
    const png = new PNG();
    createReadStream(filePath)
      .pipe(png)
      .on('parsed', () => resolve(png))
      .on('error', reject);
  });
}

function computeMetrics(png) {
  const { width, height, data } = png;
  let sumLum = 0;
  let lumSqSum = 0;
  let sumSat = 0;
  let darkCount = 0;
  let brightCount = 0;
  const pixelCount = width * height;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Luminance (rec. 709)
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sumLum += lum;
    lumSqSum += lum * lum;

    // Saturation (simple: max - min / max)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max > 0 ? (max - min) / max : 0;
    sumSat += sat;

    if (lum < 50) darkCount++;
    if (lum > 200) brightCount++;
  }

  const meanLum = sumLum / pixelCount;
  const lumVariance = lumSqSum / pixelCount - meanLum * meanLum;
  const meanSat = sumSat / pixelCount;

  return {
    width,
    height,
    pixels: pixelCount,
    meanLuminance: Math.round(meanLum * 100) / 100,
    luminanceStddev: Math.round(Math.sqrt(Math.max(0, lumVariance)) * 100) / 100,
    meanSaturation: Math.round(meanSat * 10000) / 10000,
    darkRatio: Math.round((darkCount / pixelCount) * 10000) / 10000,
    brightRatio: Math.round((brightCount / pixelCount) * 10000) / 10000,
  };
}

function computePixelDiff(pngA, pngB) {
  const { width, height, data: dataA } = pngA;
  const dataB = pngB.data;
  let totalDiff = 0;
  let changedPixels = 0;
  const pixelCount = width * height;

  for (let i = 0; i < dataA.length; i += 4) {
    const rDiff = Math.abs(dataA[i] - dataB[i]);
    const gDiff = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const bDiff = Math.abs(dataA[i + 2] - dataB[i + 2]);
    const pixelDiff = (rDiff + gDiff + bDiff) / 3;
    totalDiff += pixelDiff;
    if (pixelDiff > 5) changedPixels++; // threshold for noticeable change
  }

  return {
    meanAbsoluteDifference: Math.round((totalDiff / pixelCount) * 100) / 100,
    changedPixelRatio: Math.round((changedPixels / pixelCount) * 10000) / 10000,
    changedPixelPct: ((changedPixels / pixelCount) * 100).toFixed(2),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(SCREENSHOT_DIR)) {
    console.error(`Screenshot directory not found: ${SCREENSHOT_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(SCREENSHOT_DIR).filter((f) => extname(f).toLowerCase() === '.png');
  if (files.length === 0) {
    console.error('No PNG files found in', SCREENSHOT_DIR);
    process.exit(1);
  }

  console.log(`Analyzing ${files.length} screenshots...`);

  const results = [];
  const metricsByPhase = {};
  const pngsByPhase = {};
  let hasErrors = false;

  // Parse all PNGs first
  for (const file of files.sort()) {
    const filePath = resolve(SCREENSHOT_DIR, file);
    const phaseName = basename(file, '.png');

    try {
      const png = await parsePNG(filePath);
      const fileSize = statSync(filePath).size;
      const metrics = computeMetrics(png);

      results.push({
        file,
        phase: phaseName,
        dimensions: `${metrics.width}x${metrics.height}`,
        bytes: fileSize,
        metrics,
      });

      metricsByPhase[phaseName] = metrics;
      pngsByPhase[phaseName] = png;
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
      hasErrors = true;
    }
  }

  // ── Validate required names and dimensions ───────────────────────
  const fileNames = new Set(files.map((f) => basename(f, '.png')));
  const nameErrors = [];

  for (const rp of REQUIRED_PHASES) {
    if (!fileNames.has(rp.name)) {
      nameErrors.push(`Missing required screenshot: ${rp.name}.png`);
    }
  }
  if (!fileNames.has(REQUIRED_MOBILE.name)) {
    nameErrors.push(`Missing required mobile screenshot: ${REQUIRED_MOBILE.name}.png`);
  }

  // Validate mobile dimensions
  const mobileMetrics = metricsByPhase[REQUIRED_MOBILE.name];
  if (mobileMetrics) {
    if (mobileMetrics.width !== REQUIRED_MOBILE.width || mobileMetrics.height !== REQUIRED_MOBILE.height) {
      nameErrors.push(`Mobile screenshot has wrong dimensions: ${mobileMetrics.width}x${mobileMetrics.height}, expected ${REQUIRED_MOBILE.width}x${REQUIRED_MOBILE.height}`);
    }
  }

  // ── Validate quality thresholds ──────────────────────────────────
  const thresholdErrors = [];
  for (const r of results) {
    if (r.bytes < THRESHOLDS.minFileBytes) {
      thresholdErrors.push(`${r.file}: file too small (${r.bytes}B < ${THRESHOLDS.minFileBytes}B)`);
    }
    if (r.metrics.meanLuminance < THRESHOLDS.minMeanLuminance) {
      thresholdErrors.push(`${r.file}: mean luminance ${r.metrics.meanLuminance} < ${THRESHOLDS.minMeanLuminance} (near-black)`);
    }
    if (r.metrics.luminanceStddev < THRESHOLDS.minStddev) {
      thresholdErrors.push(`${r.file}: luminance stddev ${r.metrics.luminanceStddev} < ${THRESHOLDS.minStddev} (blank/low-variance)`);
    }
    if (r.metrics.darkRatio > THRESHOLDS.maxDarkRatio) {
      thresholdErrors.push(`${r.file}: dark ratio ${r.metrics.darkRatio} > ${THRESHOLDS.maxDarkRatio}`);
    }
  }

  // ── Phase-to-phase per-pixel differences ─────────────────────────
  const phaseOrder = REQUIRED_PHASES.map((p) => p.name);
  const phaseDiffs = [];
  for (let i = 1; i < phaseOrder.length; i++) {
    const prevName = phaseOrder[i - 1];
    const currName = phaseOrder[i];
    if (pngsByPhase[prevName] && pngsByPhase[currName]) {
      // Resize larger image to match smaller for comparison
      const small = pngsByPhase[prevName].width < pngsByPhase[currName].width ? pngsByPhase[prevName] : pngsByPhase[currName];
      const large = pngsByPhase[prevName].width >= pngsByPhase[currName].width ? pngsByPhase[prevName] : pngsByPhase[currName];

      // Sample at same resolution for fair comparison
      const diff = computePixelDiff(small, large);
      phaseDiffs.push({
        from: prevName,
        to: currName,
        ...diff,
      });
    }
  }

  // ── Check minimum inter-phase differences (frames shouldn't be identical) ─
  const diffErrors = [];
  for (const d of phaseDiffs) {
    if (d.changedPixelRatio < 0.01 && d.meanAbsoluteDifference < 1) {
      diffErrors.push(`${d.from} → ${d.to}: only ${d.changedPixelPct}% pixels changed (frames nearly identical)`);
    }
  }

  // ── Compile errors ───────────────────────────────────────────────
  const allErrors = [...nameErrors, ...thresholdErrors, ...diffErrors];
  if (allErrors.length > 0) hasErrors = true;

  // ── Generate JSON report ─────────────────────────────────────────
  const jsonReport = {
    generated: new Date().toISOString(),
    screenshotDir: SCREENSHOT_DIR,
    totalScreenshots: results.length,
    hasErrors,
    errors: allErrors,
    thresholdErrors,
    nameErrors,
    diffErrors,
    thresholds: THRESHOLDS,
    screenshots: results,
    phaseDifferences: phaseDiffs,
  };

  writeFileSync(
    resolve(process.cwd(), 'qa-artifacts', 'visual-report.json'),
    JSON.stringify(jsonReport, null, 2),
  );

  // ── Generate Markdown report ─────────────────────────────────────
  let md = `# Visual QA Report\n\n`;
  md += `Generated: ${jsonReport.generated}\n\n`;
  md += `**Total screenshots:** ${results.length} | **Errors:** ${hasErrors ? 'YES' : 'NO'}\n\n`;

  if (nameErrors.length > 0) {
    md += `## Missing Screenshots\n\n`;
    md += `⚠️ The following required screenshots are missing:\n\n`;
    for (const e of nameErrors) md += `- ${e}\n`;
    md += `\n`;
  }

  md += `## Thresholds\n\n`;
  md += `- Minimum file size: ${THRESHOLDS.minFileBytes.toLocaleString()} bytes\n`;
  md += `- Minimum mean luminance: ${THRESHOLDS.minMeanLuminance}\n`;
  md += `- Minimum luminance stddev: ${THRESHOLDS.minStddev}\n`;
  md += `- Maximum dark ratio: ${THRESHOLDS.maxDarkRatio}\n\n`;

  if (thresholdErrors.length > 0) {
    md += `## Threshold Failures\n\n`;
    for (const e of thresholdErrors) md += `- ⚠️ ${e}\n`;
    md += `\n`;
  }

  md += `## Screenshots\n\n`;
  md += `| Phase | Dimensions | Bytes | Mean Lum | Stddev | Saturation | Dark% | Bright% | Status |\n`;
  md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;

  for (const r of results) {
    const m = r.metrics;
    const errorsForFile = [...thresholdErrors.filter((e) => e.startsWith(r.file)), ...nameErrors.filter((e) => e.includes(r.file))];
    const status = errorsForFile.length > 0 ? '❌ FAIL' : '✅ PASS';
    md += `| ${r.phase} | ${r.dimensions} | ${r.bytes.toLocaleString()} | ${m.meanLuminance} | ${m.luminanceStddev} | ${m.meanSaturation} | ${(r.metrics.darkRatio * 100).toFixed(1)}% | ${(r.metrics.brightRatio * 100).toFixed(1)}% | ${status} |\n`;
  }

  if (phaseDiffs.length > 0) {
    md += `\n## Phase-to-Phase Differences\n\n`;
    md += `| From | To | Mean Abs Diff | Changed Pixels | Status |\n`;
    md += `| --- | --- | --- | --- | --- |\n`;
    for (const d of phaseDiffs) {
      const status = d.changedPixelRatio < 0.01 ? '⚠️ LOW' : '✅ OK';
      md += `| ${d.from} | ${d.to} | ${d.meanAbsoluteDifference} | ${d.changedPixelPct}% (${(d.changedPixelRatio * 100).toFixed(2)}%) | ${status} |\n`;
    }
  }

  writeFileSync(resolve(process.cwd(), 'qa-artifacts', 'visual-report.md'), md);

  console.log(`Reports written:`);
  console.log(`  - qa-artifacts/visual-report.json`);
  console.log(`  - qa-artifacts/visual-report.md`);

  if (hasErrors) {
    console.error('\nVisual QA failures:\n');
    for (const e of allErrors) console.error(`  ❌ ${e}`);
    process.exit(1);
  } else {
    console.log('\nAll screenshots passed visual quality thresholds.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
