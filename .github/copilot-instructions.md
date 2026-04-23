# Copilot Instructions for tvnotify-cloud-functions

## Project Overview
- This monorepo manages TV EPG (Electronic Program Guide) data and notification services using Firebase Cloud Functions and a custom EPG pipeline.
- Main directories:
  - `functions/`: Firebase Cloud Functions (Node.js, Firestore, Storage, HTTP triggers)
  - `functions/epg/`: EPG data processing, scripts, and site-specific scrapers
  - `public/`: Firebase Hosting static site

## Key Workflows
- **Cloud Functions**: Defined in `functions/index.js`, use Firestore, Storage, and custom EPG logic. Entry points are exported as `functions.https.onRequest`.
- **EPG Data Pipeline**:
  - Scripts in `functions/epg/scripts/commands/` handle EPG data fetching, parsing, and database updates.
  - Site-specific logic in `functions/epg/sites/`.
  - Data files (XML, DB) are versioned in `functions/epg/`.
- **Testing**:
  - Jest-based tests in `functions/epg/tests/`.
  - Use `npm run test` or `npm run test:commands` from `functions/epg/`.
  - Tests often set up input/output DB files in `tests/__data__` and run scripts via `execSync`.
- **Build/Deploy**:
  - Use `npm run deploy` in `functions/` to deploy Cloud Functions.
  - Use `firebase emulators:start` for local development (see `firebase.json` for ports).

## Conventions & Patterns
- **Environment Variables**: Scripts use env vars like `DB_DIR`, `LOGS_DIR`, `DATA_DIR` for input/output paths.
- **Database Artifacts**: EPG pipeline scripts fetch and merge DB artifacts from GitHub Actions using the Octokit API.
- **Script Naming**: Command scripts follow `category:action` (e.g., `programs:save`, `guides:update`).
- **Testing**: Tests compare output files to expected files, often nullifying DB IDs for equality.
- **Dependencies**: EPG scripts use `@octokit/core`, `dayjs`, `unzipit`, `fs-extra`, and others. Cloud Functions use `firebase-admin`, `firebase-functions`, etc.

## Integration Points
- **GitHub Actions**: Some scripts interact with the `iptv-org/epg` repo to fetch workflow artifacts.
- **Firebase**: Functions use Firestore, Storage, and HTTP endpoints. Hosting is configured in `public/`.

## Examples
- To update EPG guides: `npm run guides:update` (in `functions/epg/`)
- To run a test: `npm run test:commands` (in `functions/epg/`)
- To deploy functions: `npm run deploy` (in `functions/`)

## References
- See `functions/epg/package.json` for available scripts.
- See `functions/epg/tests/` for test patterns and data setup.
- See `functions/index.js` for Cloud Function entry points and integration logic.

---
For more, see the README files in relevant subdirectories. Update this file as project structure or workflows evolve.
