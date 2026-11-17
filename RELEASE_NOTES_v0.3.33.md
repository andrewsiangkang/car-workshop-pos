# Car Workshop POS v0.3.33

## Changes
- Restore and verify the Next.js and generated Prisma runtime dependencies in the Windows app bundle.
- Fail the build if the packaged app server is missing required runtime files.
- Keep the installer free of environment files while repairing the packaged runtime.

## Verification
- The post-pack hook validates the staged Windows app before installer creation.
- The Windows release workflow validates the unpacked server runtime before publishing.
- End-to-end e-Invoice submission remains to be checked in LHDN Sandbox.
