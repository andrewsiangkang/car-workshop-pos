# Car Workshop POS v0.5.13 — Demo Edition

## Demo update
- Updated application version to 0.5.13 in package metadata and lockfile.
- Preserved the separate Demo application identity, installation profile, local-only access policy, and independent user-data directory.
- Added a repeatable local Demo database preparation command: `npm run db:template:demo`.
- Updated the Demo packaging pre-step so it rebuilds a clean template, seeds the sample workshop data, and generates a build-specific `demo-login.txt` before packaging.
- Kept production template generation separate and empty; production packaging does not run the Demo seed.
- Added regression tests for version synchronization, Demo isolation, random credentials, secret-safe login notes, and local Demo packaging flow.

## Demo login
Each build generates temporary credentials unless `DEMO_OWNER_PASSWORD` / `DEMO_STAFF_PASSWORD` are supplied. Passwords supplied through environment variables are never copied into `demo-login.txt`. Treat the generated login note as confidential.

## Validation note
This source update does not claim that the full dependency installation, Next.js production build, or Windows Electron installer has passed. Run the release workflow on a clean Windows runner before distributing the installer.
