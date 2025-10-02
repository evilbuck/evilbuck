# Repository Guidelines

## Project Structure & Module Organization
- `src/pages` maps directly to routes; keep new pages self-contained and import shared UI from `src/components`.
- Reusable presentation lives in `src/components` (PascalCase `.astro` files), while `src/layouts/Layout.astro` provides global chrome and metadata.
- Structured data belongs in `src/data` (TypeScript objects) and static assets in `src/assets`; publish-ready media goes in `public/images`.
- Update `astro.config.mjs`, `tailwind.config.mjs`, and `tsconfig.json` together when introducing new paths or design tokens to avoid drift.

## Build, Test, and Development Commands
- First run `npm install` to sync dependencies with the checked-in `package-lock.json`.
- `npm run dev` launches the Astro dev server with hot reload on http://localhost:4321.
- `npm run build` validates the static output; treat a clean build as the minimum regression check before opening a PR.
- `npm run preview` serves the built site locally for final spot checks that mimic production hosting.

## Coding Style & Naming Conventions
- Use two-space indentation in `.astro`, `.ts`, and stylesheet blocks; wrap long Tailwind class lists onto new lines aligned under the opening quote.
- Name components in PascalCase, pages with kebab-case route names (e.g., `src/pages/resume.astro`), and exported data objects in camelCase.
- Favor TypeScript for structured data and utility modules; surface configuration through explicit exports rather than default objects.
- Run `npm run astro -- sync` when adding new integrations so generated TypeScript stays accurate.

## Testing Guidelines
- No automated suite ships with this repo yet; at minimum run `npm run build` and click through affected flows in `npm run preview` before submitting.
- If you introduce logic-heavy utilities, add component or utility tests using Astro’s Vitest integration (`npm run astro -- test`) and place specs alongside code as `*.test.ts`.
- Include fixture data under `src/data/__fixtures__` when tests require bespoke content, and keep snapshots readable by trimming long prose.

## Commit & Pull Request Guidelines
- Follow the concise, imperative style seen in `git log` (e.g., “Add hero animation”); keep subject lines under 72 characters.
- Each PR should describe the change, list validation steps (commands run, browsers checked), and link any relevant issues or tracking docs.
- For visual tweaks, attach before/after screenshots or short screen recordings; note any content updates so reviewers can verify copy accuracy.
- Request review from another contributor when touching `src/layouts` or shared components to preserve consistency across pages.
