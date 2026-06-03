# ADR-0003: Component testing via Vitest Browser Mode

- **Status:** Accepted
- **Date:** 2026-05-31

## Context

The web unit layer rendered components with `renderToStaticMarkup` under `happy-dom` and asserted Tailwind class strings. That cannot lay out or render Recharts/SVG (`ResponsiveContainer` measures 0x0 in jsdom/happy-dom), and a class-string assertion passes whether or not the user-visible result is correct. The cost was real: a net-worth chart that rendered as a flat line pinned to a $0-anchored axis shipped while the test suite was green.

We need component rendering and interaction tested the way a user experiences them, in a real browser, so a rendered regression fails CI automatically. Industry standard for React + Next.js is Vitest + React-Testing-Library-style component tests + Playwright for E2E; Vitest Browser Mode became stable in Vitest 4 (we are on 4.1.x).

## Decision

Run component rendering/interaction tests in Vitest Browser Mode (`vitest-browser-react`, real Chromium via `@vitest/browser-playwright`) as a second Vitest project, `browser`, matching `*.browser.test.tsx`. Pure logic stays in the `unit` project (`happy-dom`). Full user flows and device viewports stay in Playwright E2E. Tests assert user-observable outcomes (rendered values, axis ticks, dialog/focus behavior), never class strings or bare element existence.

## Consequences

- Render-sensitive bugs (charts, dialogs, focus) are caught automatically.
- The `browser` project needs a Chromium binary in CI and runs slower than happy-dom, so pure logic stays in the fast `unit` project.
- CSS-dependent outcomes (computed colors, tap-target sizes) are still asserted in E2E where the app's compiled Tailwind is present.
- Reversing this means moving the browser tests to E2E and dropping the project.

## Alternatives considered

- **React Testing Library + jsdom/happy-dom.** The long-standing default, but it cannot render Recharts/SVG, so it would not have caught the chart bug.
- **Playwright Component Testing (`@playwright/experimental-ct-react`).** Real browser, but explicitly experimental and a third test runner alongside Vitest and the Playwright E2E suite. Vitest Browser Mode unifies with our existing Vitest setup.
- **Pixel screenshot diffing (`toHaveScreenshot`).** Catches visual drift but is flaky across OS/CI font and antialiasing differences; asserting rendered SVG and DOM semantics is deterministic and cross-platform stable.
