# Car Workshop POS v0.3.34

## Changes
- Restore and verify the Next.js and generated Prisma runtime dependencies in the Windows app bundle.
- Fail the build if the packaged app server is missing required runtime files.
- Keep the installer free of environment files while repairing the packaged runtime.
- Keep the CommonJS post-pack hook compatible with the repository lint rules.

## Verification
- Type check and lint run in GitHub Actions before packaging.
- The post-pack hook and Windows workflow verify the staged server runtime before publishing.
- End-to-end e-Invoice submission remains to be checked in LHDN Sandbox.
