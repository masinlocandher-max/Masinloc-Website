# Masinloc Branch Policy

The website has one production source of truth and one active working line at a time.

## Source of truth

- `main` is the production baseline.
- `agent/offline-stage-build` is the current non-production working branch while the Vercel deployment quota is unavailable.
- A finished stage moves to `main` only after Site Integrity, Design Consistency, Browser QA, and visual review pass.

## Historical branches

Older `agent/*` branches created for previous hero repairs, Stage 1 experiments, and completed polish PRs are historical snapshots. They are not design references and must not be deployed, merged again, or used as a source for current HTML/CSS.

Do not cherry-pick visual files from an old branch into current work. If an older idea is needed, reimplement it against the current shared design system instead.

## Future staged work

1. Start from the latest accepted branch or `main`, never from an old repair branch.
2. Use the shared Masinloc navigation order, logo asset, palette, typography hierarchy, footer treatment, and responsive behavior.
3. Keep stage-specific features separate from the shared shell.
4. Run Site Integrity, Design Consistency, and Browser QA before review.
5. Merge only a finished stage. Do not use production hosting as a design-preview environment.

This policy exists to prevent branch drift, duplicated design systems, obsolete hero mechanisms, and visual regressions from returning in later stages.
