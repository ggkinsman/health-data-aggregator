# Project Progress

## Completed
- ✅ Issue #1: Research data export options (Apple Health + Oura API)
- ✅ Issue #2: Implement Oura OAuth2 authentication flow
- ✅ Issue #3: Security hardening for OAuth2 token storage
- ✅ Workflow documentation setup:
  - `.clinerules` - Development workflow guidelines for Claude Code
  - `.cursorrules` - Review checklist for Cursor
  - `PROMPTS.md` - Common prompts reference
  - GitHub issue templates (feature, spike, bug)

## In Progress
- None currently

## Next Up
- ⏭️ Build Apple Health XML export parser
- ⏭️ Define unified health data schema
- ⏭️ Create Oura data fetching client

## Learnings
### What Works Well
- GitHub issues provide good scope boundaries
- Claude Code handles API integration and OAuth2 well
- Security review workflow catches important issues early
- TypeScript with vitest provides good test coverage

### What to Improve
- Need to add actual data fetching after auth is complete
- Consider adding integration tests with real API (sandbox)

## Key Decisions
- Using TypeScript (switched from initial Python plan)
- AES-256-GCM encryption for token storage
- OAuth2 required (Personal Access Tokens deprecated end of 2025)
- Manual Apple Health exports for now (no iOS app)

---

## New Conversation Pattern

**When starting a fresh chat with full context window:**
```
Context: I'm working on the health-data-aggregator project.

Please read:
- .clinerules (workflow guidelines)
- PROGRESS.md (what we've done)
- Open GitHub issues (what's next)

What should we tackle next?
```
