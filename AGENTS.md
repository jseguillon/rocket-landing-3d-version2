# AGENTS.md — Instructions for AI Coding Agents

This file provides context for AI coding agents working on this repository.

## Project Overview

Cinematic 3D rocket landing experience using Vite + TypeScript + Three.js. All assets are procedural (no external files). The project is self-contained and deploys to GitHub Pages.

## Architecture Summary

```
src/
├── main.ts              # Bootstrap, render loop, keyboard handlers
├── types.ts             # Shared types, checkpoints, QA API, seeded RNG
├── styles.css           # All UI styling
│
├── engine/
│   ├── Scene.ts         # WebGL renderer, camera, resize observer
│   ├── Timeline.ts      # Deterministic state engine (no rendering deps)
│   ├── Environment.ts   # Stars, atmosphere, ground, pad, lights
│   ├── Rocket.ts        # Procedural rocket model (body, nose, legs, fins, lights)
│   ├── Camera.ts        # Phase-based camera choreography with easing
│   ├── Particles.ts     # Plume and dust particle systems
│   └── PostProcessing.ts # Vignette + color grade shader pass
│
├── ui/
│   ├── Telemetry.ts     # HUD overlay (phase, altitude, velocity, progress)
│   └── Controls.ts      # Play/pause/replay/mute buttons
│
├── tests/
│   └── Timeline.test.ts # Vitest unit tests
```

## Key Principles

1. **State separation** — `TimelineEngine` has NO Three.js or DOM dependencies. All physics/math is testable in pure JS.
2. **Procedural only** — No external assets, textures, models, or audio files. Everything generated via code/shaders.
3. **Deterministic** — Mulberry32 seeded RNG ensures identical output for same seed. QA query params (`?qa=50&seed=42`) freeze exact positions.
4. **Performance-first** — DPR clamped to 2×, particle counts bounded, post-processing is a single shader pass.

## Coding Standards

- TypeScript strict mode enforced
- Prettier: 2-space indent, semicolons, single quotes, trailing commas, 100 char width
- ESLint: recommended + TypeScript strict rules
- Conventional Commits for git history
- No `console.log` in production code (use `warn`/`error`)

## Adding New Features

1. **New engine systems** → Add to `src/engine/`, import in `main.ts`
2. **New UI elements** → Add CSS to `styles.css`, component to `src/ui/`, render in `main.ts`
3. **Timeline changes** → Modify `src/engine/Timeline.ts`, update `types.ts` checkpoints, add tests
4. **Visual changes** → Update relevant engine module, verify with Playwright screenshots

## Testing Requirements

- New timeline state logic → Vitest unit tests in `src/tests/`
- Visual changes → Update or add Playwright E2E tests in `e2e/`
- Run `npm run ci:quality` before requesting review

## QA Workflow

1. Use `?qa=<percent>&seed=42` to freeze specific animation moments
2. Window API: `window.__rocketQA.setState(time)` for automated testing
3. Timeline checkpoints defined in `TIMELINE_CHECKPOINTS` array — add new ones for major phases
4. All randomness must use the seeded RNG from `createRng()`

## CI Pipeline

- **Quality workflow**: install → format check → lint → typecheck → unit tests → build
- **Playwright**: desktop + mobile screenshots, QA determinism tests, accessibility checks
- **Pages deployment**: automatic deploy on main push using official GitHub Pages actions
