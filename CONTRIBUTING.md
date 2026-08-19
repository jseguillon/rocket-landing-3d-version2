# Contributing to Rocket Landing 3D

Thank you for your interest in contributing! This document covers development setup, code style, and the contribution workflow.

## Development Setup

```bash
node --version  # Must be >= 20 (see .nvmrc)
npm install
npm run dev     # Start dev server at http://localhost:3000
```

### IDE Configuration

- Use the `.editorconfig` in the repository root for consistent indentation (2 spaces, LF line endings).
- Configure your editor to use Prettier (`.prettierrc`) for auto-formatting on save.
- TypeScript strict mode is enabled — all new code must type-check cleanly.

## Code Style

### TypeScript

- Strict mode is enforced (`"strict": true` in `tsconfig.json`).
- No `any` types unless absolutely necessary (and then with a comment explaining why).
- Functions should have explicit return types for public APIs.
- Prefer interfaces over type aliases for object shapes.
- Group related functionality into modules (see `src/engine/` structure).

### Formatting

All code is formatted with Prettier:

```bash
npm run format:write   # Auto-format all files
npm run format:check   # Check formatting (used in CI)
```

Prettier config (`.prettierrc`):

- 2-space indentation
- Semicolons required
- Single quotes
- Trailing commas everywhere
- 100 char print width
- LF line endings

### Git Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add engine plume particle system
fix: correct camera clipping during hero phase
docs: update README with QA modes
test: add timeline boundary tests
chore: update three.js to 0.164
refactor: extract post-processing into dedicated module
```

## Pull Request Process

1. Create a feature branch from `main`: `git checkout -b feat/my-feature`
2. Make changes with meaningful commits following Conventional Commits.
3. Run the full quality check locally: `npm run ci:quality`
4. Push and open a PR targeting `main`.
5. All CI checks must pass before merge.
6. PR description should include:
   - What changed and why
   - Screenshots for visual changes
   - Test coverage notes
   - Any breaking changes

## Testing

### Unit Tests (Vitest)

```bash
npm run test            # Run all tests
npm run test:watch      # Watch mode
```

Tests live alongside source files in `src/tests/`. New features should include unit tests.

### Visual/E2E Tests (Playwright)

```bash
npm run test:e2e        # Run Playwright tests
npm run test:e2e:ui     # Open Playwright UI for interactive debugging
```

Visual tests use deterministic QA parameters (`?qa=<percent>&seed=42`) to ensure reproducible screenshots.

### Pre-merge Checklist

- [ ] `npm run format:check` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `npm run build` succeeds
- [ ] Visual changes reviewed (screenshots compared)

## Architecture Notes

### State vs Rendering

The `TimelineEngine` class in `src/engine/Timeline.ts` is the single source of truth for animation state. It has **zero dependencies on Three.js or DOM APIs**. This allows:

1. Pure unit testing of physics/kinematics
2. Deterministic QA query parameter support (`?qa=50&seed=42`)
3. Separation of concerns between game logic and rendering

### Naming Conventions

- Classes: `PascalCase` (e.g., `TimelineEngine`, `RocketBuilder`)
- Functions/methods: `camelCase` (e.g., `getRocketState()`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `TOTAL_DURATION`)
- Private fields: `_camelCase` (e.g., `_timeline`)
- File names: `PascalCase.ts` for classes, `*.test.ts` for tests

## Environment Variables

| Variable   | Description                               | Default       |
| ---------- | ----------------------------------------- | ------------- |
| `NODE_ENV` | Build mode (`development` / `production`) | `development` |

No secrets or API keys are used in this project.
