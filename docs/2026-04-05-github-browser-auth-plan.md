# GitHub Browser Authorization Plan

## Short Answer

Yes. GitHub is the easier case.

Unlike Asana, GitHub supports a CLI-friendly device flow that is specifically meant for local apps and headless tools. That means TeamHero can provide a much smoother "sign in with browser" experience for GitHub without requiring each user to create their own app and without needing a broker service just to protect a client secret.

## What Exists Today

The repo already has most of the building blocks:

- `tui/setup.go` already offers `Sign in with browser (recommended)` for GitHub.
- `scripts/github-auth.ts` already exposes a device-flow auth script to the TUI.
- `src/lib/github-oauth.ts` already:
  - requests a device code from GitHub
  - opens the browser
  - shows the verification URL and user code
  - polls for the access token
  - validates the token with `GET /user`

So GitHub is not a greenfield feature. It is already partially implemented.

## What Feels Incomplete Today

The current GitHub flow works more like an internal prototype than a polished product feature:

- `src/lib/github-oauth.ts` still uses `PLACEHOLDER_GITHUB_CLIENT_ID`.
- The main environment variable and validation path are still centered on `GITHUB_PERSONAL_ACCESS_TOKEN`.
- The setup UX still treats OAuth as something that can fail and then fall back to manual token entry.
- There does not appear to be first-class persistence/labeling for "connected via TeamHero GitHub OAuth" versus "pasted PAT".

So the main work is productization, not invention.

## Why GitHub Is Easier Than Asana

GitHub's device flow is designed for CLIs:

1. The CLI asks GitHub for a short-lived device code and user code.
2. The CLI opens `https://github.com/login/device` in the browser.
3. The user pastes or confirms the short code in the browser.
4. The CLI polls GitHub until authorization completes.
5. GitHub returns the access token directly to the CLI.

The important difference is that this flow only needs a public client ID. It does not force TeamHero to ship or hide a client secret just to complete onboarding.

That means TeamHero can own the GitHub app registration and still keep the architecture fully local.

## Feasible Approaches

### Option 1: Productize The Existing OAuth Device Flow

TeamHero registers an official GitHub OAuth app, enables device flow, and ships the public client ID in the CLI.

Pros:

- Smallest implementation.
- No TeamHero broker required.
- Smooth browser-based onboarding.
- Works well for local and headless tools.

Cons:

- Still yields a long-lived user token in the local environment.
- Permissions are scope-based, not as granular as a GitHub App installation model.
- Users may still need org approval or SSO authorization depending on org policy.

Recommendation: this is the fastest path to a good user experience.

### Option 2: Keep PAT As The Main Path

Continue optimizing manual personal access token onboarding.

Pros:

- Minimal engineering change.
- Familiar to power users.

Cons:

- Worse onboarding for new users.
- Users must manually create and paste tokens.
- Easy to request the wrong scopes or paste expired/wrong tokens.

Recommendation: keep PAT only as fallback, not the primary path.

### Option 3: Migrate Toward A GitHub App

TeamHero moves from OAuth-app-style user tokens toward a GitHub App model.

Pros:

- GitHub recommends GitHub Apps over OAuth apps.
- Finer-grained permissions.
- Better long-term security posture.
- Better org/repo scoping.

Cons:

- Larger architecture change.
- Installation model is more complex than today's token-based assumptions.
- May require substantial changes to how TeamHero authenticates Octokit and reasons about access.

Recommendation: good long-term direction, but likely too large if the immediate goal is better onboarding.

## Recommended Design

Use an official TeamHero GitHub OAuth app with device flow enabled.

1. TeamHero registers one GitHub OAuth app.
2. TeamHero enables device flow for that app.
3. TeamHero ships the public `client_id` in the CLI.
4. `teamhero setup` defaults to `Sign in with browser`.
5. The CLI requests a device code from GitHub.
6. The CLI opens `https://github.com/login/device`.
7. The CLI shows the user code in the terminal.
8. GitHub returns the access token to the CLI after authorization.
9. TeamHero stores the token locally and validates it with `GET /user`.

This gives users the "click to authorize in browser" experience while keeping the implementation fully local.

## UX Recommendation

In `teamhero setup`, GitHub should behave like this:

1. Show:
   - `Quick Setup (use TeamHero's GitHub sign-in)`
   - `Paste a Personal Access Token`
2. Default to Quick Setup.
3. On Quick Setup:
   - print the verification URL
   - print the short user code
   - try to open the browser automatically
   - show progress while polling
   - confirm success with `Connected as @login`
4. Only offer PAT fallback if:
   - browser auth fails
   - device flow is not configured
   - the user explicitly chooses manual token entry

The important product shift is psychological: users should feel like browser auth is the normal path, not an experimental branch.

## Repo Changes To Plan For

### TypeScript OAuth Flow

- Modify `src/lib/github-oauth.ts`
  - Replace `PLACEHOLDER_GITHUB_CLIENT_ID` with a real TeamHero-owned client ID via build-time or env configuration.
  - Add a clearer startup error when the client ID is not configured.
  - Improve device-flow error messages for:
    - expired device code
    - access denied
    - missing org approval
    - missing SSO authorization where detectable
  - Consider adding an explicit helper for token metadata or scopes after auth.

- Modify `scripts/github-auth.ts`
  - Keep `device_flow`, but consider adding:
    - `status`
    - `disconnect`
    - `scopes`
  - Return more structured success/error information if the TUI would benefit.

### Go TUI

- Modify `tui/setup.go`
  - Change GitHub copy from generic OAuth wording to explicit TeamHero quick setup wording.
  - Keep PAT as fallback rather than equal-weight alternative.
  - Improve failure messages so users understand what to do next.
  - Persist and show connection details more clearly.

- Add GitHub status labeling
  - Show `GitHub: connected as @login via TeamHero sign-in`
  - Distinguish from `GitHub: configured via PAT`

### Environment / Credential Model

- Decide whether `GITHUB_PERSONAL_ACCESS_TOKEN` remains the storage key for both PAT and OAuth-issued tokens.

Two options:

- Keep the same env key for compatibility.
- Introduce a new storage model like `github-tokens.json` or `GITHUB_OAUTH_TOKEN`, then adapt loaders to prefer OAuth when present.

Recommendation: keep `GITHUB_PERSONAL_ACCESS_TOKEN` at first for backward compatibility, but treat it semantically as "GitHub access token" in the UI and docs.

### Validation

- Keep `validateGitHub()` in `tui/setup.go` as the final trust check.
- After OAuth success, validate with `GET /user` and display the login.
- Consider checking scopes or rate-limit headers if TeamHero needs to detect under-scoped tokens.

## Tests To Add Or Update

- Update `tests/unit/lib/github-oauth.spec.ts`
  - cover missing client ID
  - cover better error mapping
  - cover browser-open fallback messaging if you refactor output
  - cover scope handling if added

- Update `tui/setup_test.go`
  - cover Quick Setup as the happy path
  - cover PAT fallback path
  - cover improved failure messaging
  - cover status display if added

- Update any setup coverage tests that exercise credential setup branches.

## External Work Required

### GitHub OAuth App Registration

- Register an official TeamHero GitHub OAuth app.
- Enable device flow in the app settings.
- Choose the minimum scopes TeamHero needs.
- Add branding and support metadata so the auth screen looks trustworthy.

### Scope Review

Start with the narrowest useful scopes.

Likely candidates depend on what TeamHero actually reads:

- repository metadata / pull requests / commits
- organization membership visibility where needed

Do not request broad scopes unless the report flow truly requires them.

## Rollout Plan

### Phase 1: Make Existing GitHub OAuth Official

Goal: turn the prototype into a supported feature.

- Register the TeamHero GitHub OAuth app.
- Replace placeholder client ID handling.
- Validate the current device flow against the real app.
- Confirm the scopes are sufficient for report generation.

Outcome:

- Browser sign-in works for real users without custom setup.

### Phase 2: Polish Onboarding

Goal: make browser auth the default happy path.

- Update TUI wording.
- Improve success and failure messages.
- Make PAT a fallback path.
- Surface the authenticated username clearly.

Outcome:

- New users no longer need to manually create a token in the common case.

### Phase 3: Harden And Support

Goal: make the feature reliable in real environments.

- Add disconnect/status helpers.
- Improve org-policy and SSO guidance.
- Document how this works over SSH/WSL/headless environments.
- Add telemetry/logging around failures if appropriate.

Outcome:

- Fewer confusing auth failures and better supportability.

### Phase 4: Evaluate GitHub App Migration

Goal: decide whether TeamHero should stay on OAuth device flow or move to a GitHub App model.

- Compare current token/scopes with GitHub App permissions.
- Measure whether repo/org restrictions are a problem in practice.
- Decide whether the added complexity is worth the security/permission benefits.

Outcome:

- Clear long-term direction instead of accidental auth sprawl.

## Risks And Edge Cases

- Some organizations may require SSO authorization before a token can access org resources.
- Some organizations may restrict third-party app approval.
- Device flow is good for CLIs, but the user still may have to manually enter a code if browser-opening fails.
- If TeamHero requests scopes that are too broad, users may distrust the auth screen.
- If TeamHero requests scopes that are too narrow, reports may fail later in confusing ways.

## Recommended Decisions Before Implementation

Make these choices first:

1. Is TeamHero comfortable owning an official GitHub OAuth app?
2. What are the minimum GitHub scopes truly required?
3. Should the UI continue to call the stored value a "Personal Access Token," or should it be renamed to something more neutral?
4. Is a GitHub App migration a real near-term goal, or just a future consideration?

## Suggested Implementation Sequence

1. Register the TeamHero GitHub OAuth app and enable device flow.
2. Replace placeholder client ID wiring in `src/lib/github-oauth.ts`.
3. Polish GitHub auth copy and flow in `tui/setup.go`.
4. Improve tests around the existing device-flow path.
5. Decide whether to keep `GITHUB_PERSONAL_ACCESS_TOKEN` as the storage key.
6. Add status/disconnect support if useful.
7. Reassess whether a GitHub App migration is worth the added complexity.

## Recommendation Summary

For GitHub, TeamHero can get very close to the "modern web app" onboarding experience without adding a backend broker.

The simplest good solution is:

- own an official TeamHero GitHub OAuth app
- enable device flow
- ship the public client ID
- make browser sign-in the default path
- keep PAT as fallback

That is much closer to what users expect, and it is far easier to ship than the equivalent Asana experience.
