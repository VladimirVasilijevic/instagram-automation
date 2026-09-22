---
name: verify-change
description:
  Validate local changes in this repository with path-aware quick checks or the complete pre-review
  gate. Use while implementing or before handing a change to the user; do not use it as evidence for
  live Instagram, production, or database acceptance.
---

# Verify a Change

Run from the repository root:

```bash
.agents/skills/verify-change/scripts/verify.sh quick
```

Use `quick` during implementation. It inspects tracked and untracked changes, runs the mandatory
repository quality checks, asks Vitest to run tests related to changed API or web source files, and
typechecks each affected application. Files Vitest cannot map safely, deleted files, and empty
related-test selections fall back to the affected application's complete test suite. Cross-cutting
or unknown paths fall back to the full gate.

Before presenting completed code for review, run:

```bash
.agents/skills/verify-change/scripts/verify.sh full
```

The full mode runs the established repository-wide quality, test, typecheck, build, documentation,
and whitespace checks. It does not run opt-in PostgreSQL integration tests because those require a
separate non-production database.

Run database integration commands only when the task needs them and a dedicated test database is
explicitly configured. Read `doc/05-instagram-login.md` before the OAuth integration suite. Neither
mode replaces browser checks, real Meta OAuth, migration status checks, or deployed health checks.
