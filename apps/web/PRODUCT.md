# Privance

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Privance is for privacy-conscious self-hosters managing their personal finances. Product decisions should serve this audience, not prioritize the maintainer's workflows over other users' needs.

## Product Purpose

Give users a private place to understand their financial position, maintain accounts and holdings, track spending, and explore financial-independence scenarios. All of these jobs matter; no single workflow has been designated the exclusive priority.

Success means these jobs work exceptionally well on both desktop and mobile, supporting regular use across both. The product is expected to gain capabilities over time, rather than remain limited to its current feature set.

## Positioning

Privance combines self-hostable personal finance with browser-side, zero-knowledge encryption. Financial records are encrypted before leaving the browser; the server stores ciphertext and required metadata, not decryption keys. Privacy is part of the product's mechanism, not an optional setting.

Data privacy and security are permanent, non-negotiable commitments. Privance will never support bank linking. Other product choices are open to reconsideration when there is a clear user benefit, without weakening these commitments or bypassing the repository's security contracts.

## Operating Context

- Regular use on both desktop and mobile; neither is a secondary experience.
- Browser-based access, with installation as a Progressive Web App on supported devices.
- Users maintain their financial records without bank linking.
- Self-hosting is supported. Setup and deployment requirements remain documented in the repository's infrastructure and contribution guides.

## Capabilities and Constraints

Current capabilities, established by repository documentation and implementation:

- Net worth and account tracking across assets and liabilities.
- Investment holdings, market-price lookups, cost basis, and allocation insights.
- Manually entered spending, including recurring commitments.
- Financial-independence planning with Monte Carlo simulations and historical replays on the user's device.
- Master-password and recovery-phrase flows, supported-device biometric unlock, and inactivity locking.
- A figure-hiding control called the veil for visual privacy.
- Light, dark, and system display preferences.
- An offline-capable app shell and local encrypted storage, subject to browser storage support. Authentication and initial sync require connectivity; this is not a fully network-independent product. Storage limitations and save guarantees are documented in [README.md](README.md#pwa-install).

Financial calculations must preserve the repository's exact-decimal contracts. Encryption, key handling, recovery, and data exposure must preserve the contracts in [SECURITY.md](../../SECURITY.md#security-contracts-for-changes). Losing both the master password and recovery phrase means permanent data loss.

Open to reconsideration:

- The current Invest / Spend / Plan navigation and grouping are implementation choices, not fixed product architecture.
- Beyond navigation, existing product choices, workflows, UI conventions, and terminology may be challenged when a clear user benefit supports a change. Data privacy, security, and the permanent exclusion of bank linking are not negotiable. Material workflow or product-promise changes should be confirmed rather than inferred from current code.
- Future features are welcome, but no specific addition or roadmap is committed by this record.

## Brand Commitments

- Product name: Privance.
- Existing tagline: “Personal finance, kept personal.”
- Explain privacy and recovery limitations honestly. Do not imply bank linking, server-side recovery of decryption keys, or stronger offline guarantees than the implementation provides.

## Evidence on Hand

- Product overview and capability descriptions: [repository README](../../README.md).
- Current routes and navigation: `src/router.tsx` and `src/app/(app)/layout.tsx`.
- Existing logo and install assets: `public/icon.svg` and the accompanying PWA icons and manifests.
- Existing product and landing screenshots: `../../docs/screenshots/`. These are reference assets, not proof of the current rendered state.
- Security claims must be grounded in the security contracts and threat model, not expanded into unsupported promises.

## Product Principles

1. Never trade away data privacy or security as capabilities grow; bank linking will never be supported.
2. Treat desktop and mobile as equally important, adapting interactions to each rather than merely fitting the same layout into both.
3. Make financial information accurate and understandable, including the limits of projections, recovery, storage, and sync.
4. Organize around users' financial tasks; existing navigation and terminology can evolve when they obstruct those tasks.
5. Serve privacy-conscious self-hosters broadly, grounding improvements in real user needs rather than maintainer-only preferences.
