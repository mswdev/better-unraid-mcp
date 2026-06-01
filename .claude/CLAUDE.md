# CLAUDE.md

See @README.md for project overview and @package.json for available commands.

> **Owner:** Matt White (mswdev)
> **Product:** better-unraid-mcp — a Model Context Protocol server exposing the Unraid GraphQL API.
> **Repo:** Single-package TypeScript MCP server.

## Quick Reference

**Core Rules:**
- @.claude/rules/code-style.md — Naming, complexity limits, documentation
- @.claude/rules/testing.md — Test structure, what to test, quality gates
- @.claude/rules/security.md — Security requirements
- @.claude/rules/file-organization.md — Directory structure, file caps, dependency direction

**Package Rules:** *(add package-specific rule files as needed)*
<!-- Example:
- @.claude/rules/backend/api.md — API layer rules
- @.claude/rules/frontend/webapp.md — Frontend rules
-->

## How to Use These Instructions

1. **Always follow** the core philosophy and code standards
2. **Consult package-specific rules** when working in individual packages
3. **Package rules extend, not override** shared standards (e.g., a backend package adds validation requirements but doesn't remove the 25-line method limit)

## 1. Project Overview

better-unraid-mcp is a standalone TypeScript MCP server (npm/`npx`) that exposes the Unraid GraphQL API to any MCP client. The API is GraphQL at `/graphql`, authenticated via the `x-api-key` header.

**Domain terms:**

| Term | Definition |
|------|-----------|
| **array** | The protected disk set (the main pool of disks guarded by parity). |
| **parity** | The redundancy disk that lets the array rebuild a failed data disk. |
| **share** | A user share or disk share — a named slice of storage exposed over the network. |
| **cache pool** | A fast pool (e.g. SSD/NVMe) used for caching writes and app data. |
| **mover** | The process that migrates data from the cache pool to the array. |
| **Docker** | Containers managed by Unraid's Docker engine. |
| **VM** | Virtual machines run via libvirt. |
| **flash** | The USB boot device that holds the Unraid OS and configuration. |

## 2. Core Engineering Philosophy

1. **KISS** — Keep It Simple, Stupid. The simplest solution that works is the best solution.
2. **Clarity over cleverness** — No tricks, no golf, no "elegant" one-liners that require a comment to explain.
3. **Functional decomposition** — Break problems into small, named, single-purpose functions.
4. **Object-Oriented Design** — Model the domain with clear objects, well-defined boundaries, and explicit contracts.
5. **Test what matters** — Unit tests are not optional. If logic makes a decision, it gets a test. ALWAYS WRITE TESTS.
6. **SOLID Principles** — Follow SOLID programming principles.

## 3. Code Review Checklist

Before approving any PR, verify:
- [ ] **Can I understand every method without reading its callees?** If no, the names need work.
- [ ] **There are NO MAGIC NUMBERS**
- [ ] **Is every method <= 25 lines?** NO EXCEPTIONS.
- [ ] **Is nesting <= 2 levels deep?** Extract if not.
- [ ] **Does each class have a single, obvious responsibility?**
- [ ] **Are there tests for every decision point in the logic?**
- [ ] **Is there any cleverness that should be replaced with clarity?**
- [ ] **Would a new teammate understand this in 5 minutes?**
- [ ] **Do new API endpoints have input validation schemas?**
- [ ] **Do all exported functions/methods/classes have JSDoc documentation?**
- [ ] **Do route handlers and service methods log their outcomes?**
- [ ] **Do all catch blocks capture errors to the error monitoring service?**

## 4. Infrastructure & Services

| Service | Purpose | Status |
|---------|---------|--------|
| Unraid GraphQL API | Data source (the Unraid server's `/graphql` endpoint) | Active |
| npm registry | Distribution (published as `better-unraid-mcp` for `npx`) | Active |
| GitHub Actions | CI and AI assistants/reviewers | Active |

## 5. Git Workflow

**Branch naming:** `feature/{ticket}-{short-description}` (e.g., `feature/123-user-auth`); branches are cut off `develop`.
**Commit messages:** Conventional commits, one logical change per commit.
**Always use feature branches + PRs.** NEVER commit directly to `main` or `develop`.
**ALWAYS draft PRs into `develop`** (`gh pr create --draft --base develop`). The author decides when to mark "Ready for review."
**PR description:** Describe what changed and why, list affected files.

## 6. AI-Specific Instructions

- **Read and ingest before you edit.** Always read relevant source files before proposing changes. NEVER speculate about code you haven't inspected.
- **These rules are authoritative over observed codebase patterns.** If existing code violates a rule in this document or `.claude/rules/`, that is technical debt — not a convention to follow. Never justify bad practices because you see them elsewhere in the repo. When in doubt, follow the rules, not the code.
- **Follow existing design patterns that comply with these rules.** Study the relevant package and match the established architecture, file placement, and naming. If a convention exists and does not violate these rules, use it. If you have a clear technical reason to deviate, explain the rationale.
- **Reuse existing utility functions**
- **Reuse existing UI components**
- **Verify schema and queries against source files.** Check the vendored Unraid SDL for type/field structure before writing code that references them.
- **Check existing types before creating new ones** to avoid duplication. Create new types when genuinely needed for new features.
- **Flag security concerns proactively** (exposed secrets, SQL injection, missing auth, etc.).
- **Use parallel tool calls** for independent operations (e.g., reading multiple files, running lint and test simultaneously).
- **Package context awareness:** When working in a specific package, prioritize that package's rule file.
