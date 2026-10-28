---
name: Privance
description: Calm, precise, and quietly editorial personal finance.
colors:
  accent: "#087f73"
  accent-dim: "#0f766e"
  accent-hover: "#056b61"
  control-primary: "#087f73"
  data-primary: "#128f84"
  vault: "#f6f7f5"
  panel: "#ffffff"
  panel-2: "#eef1ef"
  cream: "#101416"
  cream-soft: "#3f4b4e"
  dim: "#667477"
  faint: "#636f72"
  line: "rgba(16, 20, 22, 0.14)"
  line-soft: "rgba(16, 20, 22, 0.08)"
  up: "#15803d"
  down: "#be123c"
  signal: "#b45309"
  dark-accent: "#5eead4"
  dark-accent-dim: "#2dd4bf"
  dark-accent-hover: "#8cf5e4"
  dark-control-primary: "#f2f4f5"
  dark-data-primary: "#5eead4"
  dark-vault: "#07080a"
  dark-panel: "#101216"
  dark-panel-2: "#171a20"
  dark-cream: "#f2f4f5"
  dark-cream-soft: "#c9ced2"
  dark-dim: "#8b939b"
  dark-faint: "#7b858e"
  dark-line: "rgba(255, 255, 255, 0.09)"
  dark-line-soft: "rgba(255, 255, 255, 0.05)"
  dark-up: "#4ade80"
  dark-down: "#fb7185"
  dark-signal: "#fb923c"
typography:
  display:
    fontFamily: '"Instrument Serif", serif'
    fontSize: "84px"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "-0.015em"
  headline:
    fontFamily: '"Instrument Serif", serif'
    fontSize: "32px"
    fontWeight: 400
    letterSpacing: "-0.01em"
  title:
    fontFamily: '"Instrument Serif", serif'
    fontSize: "24px"
    fontWeight: 400
  body:
    fontFamily: '"Schibsted Grotesk Variable", sans-serif'
    fontSize: "16px"
    fontWeight: 400
  data:
    fontFamily: '"Spline Sans Mono Variable", monospace'
    fontSize: "14px"
    fontWeight: 400
  field:
    fontFamily: '"Spline Sans Mono Variable", monospace'
    fontSize: "16px"
    fontWeight: 400
  label:
    fontFamily: '"Spline Sans Mono Variable", monospace'
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.12em"
  button:
    fontFamily: '"Spline Sans Mono Variable", monospace'
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.08em"
  mobile-navigation:
    fontFamily: '"Schibsted Grotesk Variable", sans-serif'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1
rounded:
  md: "6px"
  lg: "8px"
  data-card: "10px"
  settings-card: "14px"
  2xl: "16px"
  mobile-sheet: "22px"
spacing:
  1: "4px"
  2: "8px"
  2.5: "10px"
  3: "12px"
  3.5: "14px"
  4: "16px"
  5: "20px"
  6: "24px"
  7: "28px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.vault}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-dark:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-vault}"
  button-primary-dark-hover:
    backgroundColor: "{colors.dark-accent-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.cream}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.cream-soft}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-danger:
    backgroundColor: "{colors.down}"
    textColor: "{colors.vault}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-danger-outline:
    backgroundColor: "transparent"
    textColor: "{colors.down}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.cream}"
    typography: "{typography.field}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  navigation-active:
    backgroundColor: "{colors.control-primary}"
    textColor: "{colors.vault}"
    typography: "{typography.button}"
  navigation-active-dark:
    backgroundColor: "{colors.dark-control-primary}"
    textColor: "{colors.dark-vault}"
  status-chip:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    padding: "5px 11px"
  data-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.cream}"
    rounded: "{rounded.data-card}"
    padding: "24px"
---

# Design System: Privance

## Overview

**Creative North Star: "The Private Ledger"**

Calm, precise, and quietly editorial. Expressive serif headings and prominent figures give the interface a human voice; clear sans-serif prose and monospaced data keep financial tasks legible. The name is descriptive shorthand, not a requirement to imitate a physical ledger or add vault decoration.

The system supports equally important desktop and mobile experiences. It combines compact data presentation with breathing room around major figures and task boundaries. Controls are refined and restrained, with clear feedback. Depth is layered, not floating: tones and fine borders establish everyday structure, while overlays receive stronger separation.

**Key Characteristics:**
- Editorial serif hierarchy balanced by practical sans-serif text and precise mono data.
- Paired light and dark themes with a shared teal/mint identity.
- Fine borders, softly rounded containers, and restrained surface layering.
- Responsive navigation and overlays rather than a shrunken desktop layout.
- Visible focus, subtle press feedback, and reduced-motion alternatives.

This records the incumbent implementation, not a redesign or a certification that every screen follows it perfectly. Approved descriptive language is combined with values extracted from the source. Visual and product choices remain revisable under [PRODUCT.md](PRODUCT.md).

## Colors

Deep Teal on Cool Paper and Luminous Mint on Graphite are two expressions of the same palette, not separate brands.

Frontmatter keys mirror the shared semantic roles in `src/app/globals.css`: unprefixed values record the light theme; `dark-` values record the corresponding dark override. Component records use the light baseline unless named otherwise. At runtime, use theme-aware CSS variables, not these snapshot values as hardcoded colors. Legacy names such as `cream` describe roles, not a promise of a warm hue. The sidecar's eight-step tonal ramps are synthesized swatch visualizations, not additional runtime tokens or an approved expanded palette.

### Primary

- **Deep Teal / Luminous Mint** (`accent`): primary actions, links, focus indicators, selected accents, and restrained editorial emphasis. `accent-dim` supports outlines; `accent-hover` supplies primary-action hover feedback.
- **Primary control fill** (`control-primary`): selected navigation and segmented controls. It follows Deep Teal in light mode but becomes the pale foreground in dark mode; it is deliberately distinct from the brand accent.
- **Primary data color** (`data-primary`): the first allocation slice and other data uses. Its light-theme value is distinct from the action accent.

### Neutral

- **Cool Paper / Graphite** (`vault`): page canvas and contrasting text on filled controls.
- **Panel / Raised Panel** (`panel`, `panel-2`): content containers, fields, and popovers.
- **Ink / Pale Foreground** (`cream`): primary text. `cream-soft` supports secondary foreground content; `dim` and `faint` support metadata and quieter labels.
- **Fine Line / Soft Line** (`line`, `line-soft`): container boundaries and internal dividers. Preserve the source alpha values rather than replacing them with opaque gray.

### Status and data

- `up` communicates positive movement; `down` communicates negative movement and destructive actions. `signal` is amber/orange for warnings and field-validation feedback. The shared `destructive` alias currently maps to `signal`, while the explicit danger buttons use `down`; do not assume those aliases are interchangeable.
- The ordered categorical palette lives in `src/features/dashboard/palette.ts`. It extends beyond the brand accent for allocation charts. Color assignment follows descending slice rank consistently across the related views; it is not a permanent color identity for each asset class. Do not promote these chart colors into new action accents.

**The Role Before Hue Rule.** Use the existing semantic role and its theme mapping; a selected control, a brand accent, and a data series are not automatically the same color.

## Typography

**Display Font:** Instrument Serif, with serif fallback; the regular and italic faces are loaded.

**Body Font:** Schibsted Grotesk Variable, with sans-serif fallback.

**Label/Mono Font:** Spline Sans Mono Variable, with monospace fallback.

The pairing is editorial without making working screens read like marketing. Serif carries hierarchy and major figures, sans-serif carries prose and row labels, and mono carries financial data, fields, tickers, and compact controls. The mobile bottom bar intentionally uses sans-serif labels.

### Hierarchy

- **Display:** the investment hero is fluid (`clamp(52px, 7.5vw, 84px)`); its frontmatter token records the upper endpoint. The landing hero has its own larger scale (`clamp(54px, 8.6vw, 116px)`), not a general app heading size.
- **Headline / title:** screen headings commonly use the serif 32px step; card and dialog titles commonly use 24px. Auth headings use 40px. Shared sheet/dialog title utilities include a light-weight request, but only the regular serif face is loaded; do not infer a separate supplied light face.
- **Body / data:** the body baseline is 16px; dense table data and secondary text commonly use 14px. Labels and captions use 12px as the documented floor.
- **Fields:** mono at 16px or above, including on phones, to avoid focus-triggered iOS zoom.
- **Labels / controls:** uppercase mono labels use the shared label tracking; uppercase buttons use the tighter button tracking. Some existing section labels use wider local tracking and are exceptions, not an additional global scale.

The source size ladder is 12, 14, 16, 18, 20, 24, 28, 32, and 40px. It is a role-based ladder, not a strict modular ratio. Preserve tabular numerals and right-aligned numeric columns where the data tables use them.

**The Three Voices Rule.** Preserve the serif / sans / mono division of work; do not turn everyday body copy into mono or every financial value into display type.

## Layout

- Data-dense app content and the top bar share a centered maximum width (1120px), with desktop horizontal padding (28px) reducing on mobile (16px). Narrow settings flows use a 640px maximum. The landing page uses a separate 1160px maximum and 32px gutters.
- The main responsive transition is at `md` (768px): desktop primary navigation yields to the fixed mobile bottom bar. The sticky app header is 62px on desktop and 56px on mobile. The bottom bar has a 48px minimum content height with 24px icons, plus the bottom safe-area inset and top border; page padding reserves that same space plus the existing 16px card gutter. Keep the whole link as the touch target and retain the full system inset. Bottom-align the icon/label stack rather than centering extra slack below it; retain a 1px label margin so glyphs do not touch a zero-inset viewport edge.
- The shared `sm` transition (640px) adjusts button sizing. Other landing-specific breakpoints remain local; do not treat them as new global device categories.
- Dashboard composition uses a 12-column grid with 16px gaps, responsive card spans, and a stacked flow for compact contexts. Use the actual feature layout rather than imposing one universal grid on forms and settings.
- Spacing is predominantly a 4px rhythm with recurring half-steps. Frontmatter captures common observed values, not a prohibition on source-local adjustments.
- Respect safe areas in persistent chrome and mobile footers. Dialogs and drawers account for the software keyboard; avoid replacing viewport-aware behavior with a fixed-height approximation.

Current navigation labels and grouping are documented in Components, not mandated as permanent information architecture.

## Elevation & Depth

**Layered, not floating.** Tonal surfaces and fine borders do most of the structural work. The shared glass material adds a restrained shadow and inset highlight to some cards; the name does not mean every card is transparent. Floating material uses blur, saturation, and a slightly translucent panel, with solid fallbacks for unsupported blur, reduced transparency, and increased contrast.

Dialogs and drawers have a stronger structural shadow. Desktop scrims blur the scene; the shared mobile scrim disables backdrop blur. The sticky header also uses a translucent background and blur. Primary buttons have an existing accent-tinted glow, which is an action treatment, not the default shadow for other controls.

Exact shadow and easing values are recorded in `.impeccable/design.json` and sourced from the shared stylesheet and primitives. The global background includes low-opacity radial accent washes and a non-interactive grain layer; these are incumbent background details, not a requirement to decorate new content panels.

**The Depth Has a Job Rule.** Use ordinary surface layering for content; reserve stronger separation for overlays and the existing primary-action treatment.

## Shapes

Soft corners keep dense content approachable without making every element a pill. Standard buttons use the medium radius, fields the large radius, data cards their compact container radius, and settings cards their slightly softer radius. Dialogs use the larger shared radius; mobile detail drawers use their own rounded top corners. These are separate observed roles, not one universal radius.

Pills are intentional exceptions: desktop primary navigation, status badges, and circular icon buttons. Mobile navigation uses a small rounded active-icon tile rather than reproducing the desktop pill. Fine one-pixel borders and internal dividers remain part of the structural language.

## Components

### Buttons

Refined and restrained, with clear state feedback. The shared `Button` provides primary, secondary, ghost, danger, and danger-outline variants. The primary is accent-filled with a tinted shadow; secondary is transparent with a fine border; ghost relies on foreground contrast. Destructive variants use `down` rather than the brand accent.

The default size has a mobile minimum height (44px), becoming 40px with wider horizontal padding from `sm`. Small buttons also retain a 44px mobile minimum before reducing on wider screens. Icon-only sizing is a separate 36px variant; persistent round header controls use 44px circles with accessible labels. Do not describe every existing control as meeting a universal 44px minimum.

Primary hover changes fill and glow; secondary hover strengthens its border and adds a faint fill. Keyboard focus uses a visible two-pixel outline. A subtle press scale is removed under reduced motion. Disabled/loading buttons dim and cannot be activated; loading adds the shared spinner while retaining the label.

### Inputs / Fields

Fields sit on the raised panel with a fine border, mono text, soft corners, and a minimum height of 44px. Focus shifts the border to the dim accent and adds a two-pixel accent ring. Invalid fields use `signal`; disabled fields dim. The app-level field wrapper supplies the uppercase label and connected inline error. Preserve those semantics rather than recreating a decorative input.

### Chips and segmented controls

Status badges are compact outlined pills with uppercase mono text; enabled badges use the accent and quieter states use the neutral foreground. Financial change pills pair status color with a tinted fill. Segmented single-select controls share a sliding active indicator and selected foreground; reduced motion removes its travel. A status badge is not automatically an interactive filter.

### Cards / Containers

Use panel surfaces, fine borders, and the radius/padding appropriate to the nearest existing feature. Data cards commonly use 24px padding and the compact container radius. Settings cards use the softer container radius and internally divided rows. The shared glass material provides the restrained shadow/highlight where already used; avoid nested ornamental cards with additional elevation.

### Navigation

The current primary destinations are Invest, Spend, Plan, and Settings. Desktop uses uppercase mono links in a bordered pill with a filled active segment. Mobile uses four equal-width icon-and-label links; the active icon gets the primary-control fill and the active label gains foreground contrast. Active links expose `aria-current`; keyboard focus remains visible.

Investment subnavigation is a separate sticky underline treatment for Overview, Holdings, and Accounts. New primary destinations reset instantly to the top; main-region focus must not pan the viewport afterward. Investment subnavigation preserves scroll, and back/forward navigation restores it. Landing-page smooth anchor scrolling stays separate from app route resets. These patterns describe the implementation, not a requirement to keep the same organization forever.

### Dialogs, sheets, and popovers

The shared dialog is centered on desktop and becomes a bottom sheet below `md`. Detail sheets are a right-side rail (440px) on desktop and a swipe-dismissable bottom drawer on mobile, with a drag handle and a maximum height constrained by the dynamic viewport and keyboard. Preserve Base UI's focus, dismissal, and scroll-lock behavior.

Dialog footers use equal-width actions on one row, including on mobile; form footers can remain sticky. Mobile overlay content owns bottom clearance once: the greater of 12px and the safe-area inset, with only the 12px margin when lifted above the keyboard. Height limits leave the top safe area plus 12px clear, including a panned visual viewport. Form-sheet headers and actions stay outside the scrolling body. Popovers use the raised panel and sit above dialogs. Layering currently places header/subnavigation below the grain layer, mobile navigation above it, dialogs/sheets above navigation, and popovers above dialogs.

### Charts and the veil

Chart hierarchy is carried by the primary data color, fine grid lines, contextual tooltips, mono values, and the shared ordered categorical palette. The veil blurs marked figures, including figures inside portaled overlays, while leaving chart shapes visible. It is visual shoulder-surfing protection, not a security boundary or a substitute for locking.

### Motion

Motion is short and purposeful: control feedback around 100–150ms, segmented indicators and dialogs around 200ms, detail drawers at 220ms, and a slower route crossfade. Preserve the shared easing curves and the persistent chrome's isolation from route transitions. Reduced-motion handling removes movement or substitutes opacity; it does not mean every transition is disabled. Longer marketing reveals remain local to those surfaces.

## Do's and Don'ts

### Do:

- **Do** use semantic, theme-aware colors and preserve the distinction between action, control, status, and data roles.
- **Do** keep serif hierarchy, sans-serif reading text, and mono data/controls in their observed roles.
- **Do** keep editable field text at 16px or above and preserve visible keyboard focus.
- **Do** adapt navigation, sheets, safe-area spacing, and keyboard handling for mobile rather than shrinking desktop components.
- **Do** reuse shared components and their accessibility, disabled, loading, and reduced-motion behavior.

### Don't:

- **Don't** treat current navigation labels, the North Star name, or source-local exceptions as immutable product requirements.
- **Don't** hardcode dark-theme mint or graphite into new theme-aware app surfaces.
- **Don't** use categorical chart colors as additional action accents or add overlay-strength shadows to ordinary panels.
- **Don't** mistake the veil's visual masking for secure locking or claim accessibility compliance from these style descriptions alone.

Documentation evidence: shared CSS, primitives, feature layouts, and palette source; current landing and login renders at desktop (1440px) and mobile (390px), in both themes. The committed app screenshot is useful historical evidence, but the current hero type scale and shared components take precedence where it differs. Authenticated screens and overlays were inspected in source, not exercised against a live vault. The landing demo contains some fixed dark-colored artwork, and chart focus outlines are currently suppressed in global CSS; neither exception is a general recommendation for new work.
