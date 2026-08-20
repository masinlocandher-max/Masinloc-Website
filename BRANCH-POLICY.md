# Masinloc Branch Policy

The website has one production source of truth and one active working line at a time.

## Source of truth

- `main` is the production baseline.
- No feature branch is considered authoritative after it has been merged. A new working branch must always start from the latest `main`.
- The mobile, Masinloc Connect privacy, private resume upload, security, and QA hardening pass was completed and merged on August 21, 2026.
- A finished change moves to `main` only after Site Integrity, Design Consistency, Browser QA, relevant feature-specific QA, and visual review pass.

## Historical branches

Older `agent/*` branches created for previous hero repairs, Stage 1 experiments, completed polish work, and completed hardening work are historical snapshots. They are not design references and must not be deployed, merged again, or used as a source for current HTML/CSS.

Do not cherry-pick visual files from an old branch into current work. If an older idea is needed, reimplement it against the current shared design system instead.

## Future staged work

1. Start from the latest accepted `main`, never from an old repair or completed feature branch.
2. Use the shared Masinloc navigation order, logo asset, palette, typography hierarchy, footer treatment, responsive behavior, and mobile stability layer.
3. Keep stage-specific features separate from the shared shell.
4. Run Site Integrity, Design Consistency, Browser QA, and any feature-specific QA before review.
5. Merge only a finished stage. Do not use production hosting as a design-preview environment.

This policy exists to prevent branch drift, duplicated design systems, obsolete hero mechanisms, stale deployments, and visual or security regressions from returning in later stages.
