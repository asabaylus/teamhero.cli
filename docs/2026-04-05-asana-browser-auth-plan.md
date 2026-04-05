# Asana Browser Authorization Plan

## Short Answer

Yes, TeamHero can support a browser-based "click a link and authorize" flow for Asana.

The important caveat is that a truly web-style experience requires TeamHero to own an Asana OAuth app and keep the app's client secret off the user's machine. That is the main difference between a hosted web product and a local CLI.

## What Exists Today

The codebase is already partway there:

- `src/lib/asana-oauth.ts` already starts a localhost callback server, builds an Asana authorization URL, opens the browser, receives the auth code, and stores tokens locally.
- `scripts/asana-auth.ts` already exposes that flow to the rest of the app.
- `tui/setup.go` already offers `Sign in with browser (recommended)` for Asana.

So the missing piece is not "can the CLI open a browser?" It already can.

The real gap is that the current implementation still depends on app credentials that are not productized:

- `src/lib/asana-oauth.ts` uses `PLACEHOLDER_ASANA_CLIENT_ID`.
- The token exchange and refresh logic are written as if a client secret may be needed, which matches Asana's OAuth docs.
- A web app can hide the client secret on its backend.
- A standalone CLI cannot safely do that if TeamHero wants to ship one shared integration to all users.

## Why ChatGPT / Claude Web Feel Easier

Hosted apps can do this because they control a server:

1. The server owns the OAuth app registration.
2. The server keeps the client secret private.
3. The browser completes authorization against that hosted app.
4. The server exchanges and refreshes tokens securely.

Your CLI can match the user experience, but not with a purely local implementation if Asana requires the client secret for token exchange and refresh.

## Feasible Approaches

### Option 1: Polish the Existing BYOC Flow

Users still create their own Asana app, but TeamHero makes the flow nicer:

- Open the browser automatically.
- Print a clickable URL in the terminal.
- Guide the user through where to create the app and what redirect URI to paste.
- Store the resulting tokens locally.

Pros:

- Smallest implementation.
- No TeamHero backend required.
- Keeps data local.

Cons:

- Does not solve the core UX complaint.
- Every user still has to create an Asana app and handle credentials.
- Still feels different from the web version.

### Option 2: Ship a Shared Client Secret in the CLI

TeamHero would embed or distribute the Asana client secret directly to the CLI.

Pros:

- Very simple architecture.

Cons:

- Not acceptable for a real shared integration.
- Secret extraction is trivial.
- Secret rotation becomes painful.
- Violates the security model that web apps rely on.

Recommendation: do not do this.

### Option 3: Add a TeamHero OAuth Broker Service

The CLI still opens the browser locally, but TeamHero adds a tiny backend service that performs token exchange and refresh using the TeamHero-owned Asana app secret.

Pros:

- Matches the web-style UX most closely.
- Users click once and authorize in browser.
- TeamHero owns the integration lifecycle.
- Secret stays off the client.

Cons:

- Requires backend work and operations.
- Adds a new dependency on TeamHero infrastructure.
- Needs auth, rate limiting, and observability.

Recommendation: this is the best path if the goal is "works like ChatGPT / Claude web."

## Recommended Design

Use a hybrid flow:

1. TeamHero registers one official Asana OAuth app.
2. The CLI starts a localhost callback server exactly like it does today.
3. The CLI opens the browser to the Asana consent page using TeamHero's client ID.
4. Asana redirects back to `http://127.0.0.1:<port>/callback` with the authorization code.
5. The CLI sends `code`, `code_verifier`, and `redirect_uri` to a TeamHero broker endpoint over HTTPS.
6. The broker exchanges the code with Asana using the TeamHero client secret.
7. The broker returns token material the CLI can store locally, or a TeamHero session that can later be used to refresh access.
8. On refresh, the CLI calls the broker again instead of talking directly to Asana with a client secret.

## Broker Design Choice

There are two viable refresh models:

### A. Stateless Broker

The CLI stores the Asana refresh token locally and sends it to TeamHero only when it needs a refresh.

Pros:

- Smallest backend.
- Fits the current local token-file model.

Cons:

- The CLI still stores a long-lived Asana refresh token.
- Broker endpoints must carefully validate inputs and rate limit abuse.

### B. Managed Session Broker

The broker stores the Asana refresh token server-side and returns a TeamHero session token to the CLI instead.

Pros:

- Better control and revocation.
- Less sensitive material on the client.

Cons:

- More backend complexity.
- Requires server-side encrypted token storage.

Recommendation: start with the stateless broker if you need the fastest path to a good UX. Move to the managed-session model later if this becomes a user-facing distributed product.

## Proposed User Experience

In `teamhero setup`:

1. User selects `Asana OAuth`.
2. TeamHero shows:
   - `Quick Setup (use TeamHero's Asana integration)`
   - `Bring Your Own OAuth App`
   - `Paste a Personal Access Token`
   - `Skip`
3. If the user chooses Quick Setup:
   - CLI starts the localhost listener.
   - CLI prints a clickable fallback URL.
   - CLI attempts to open the default browser.
   - Browser shows Asana consent.
   - Browser lands on a local success page: `Asana connected. You can return to TeamHero.`
   - CLI shows `Asana connected as <name>`.
4. If Quick Setup is unavailable, TeamHero should say why:
   - `TeamHero Asana integration is not configured for this environment.`
   - Then offer BYOC or PAT fallback.

This mirrors the Google Drive setup shape already present in `tui/setup.go`.

## Repo Changes To Plan For

### TypeScript CLI / OAuth Flow

- Modify `src/lib/asana-oauth.ts`
  - Split current direct-to-Asana token exchange into pluggable strategies:
    - direct BYOC exchange
    - TeamHero broker exchange
  - Add clearer validation for missing shared config.
  - Keep localhost callback handling and PKCE generation.

- Add `src/lib/asana-broker.ts`
  - Small client for the TeamHero broker endpoints.
  - Functions:
    - `exchangeAuthorizationCode()`
    - `refreshAccessTokenViaBroker()`
    - optional `revokeBrokerSession()`

- Modify `scripts/asana-auth.ts`
  - Accept a mode such as `quick` or `byoc`.
  - Call the correct auth path.

- Modify `src/lib/service-factory.ts` or whichever path loads Asana credentials
  - Prefer OAuth token file when present.
  - Keep PAT fallback working.

### Go TUI

- Modify `tui/setup.go`
  - Change Asana setup menu to mirror Google Drive:
    - Quick Setup
    - Bring Your Own Credentials
    - Paste PAT
    - Skip
  - Improve failure messaging so OAuth failure does not feel like a silent fallback.

- Update status text in the settings picker
  - Show `Asana: connected via TeamHero` or `Asana: connected via BYOC`.

### Tests

- Update `tests/unit/lib/asana-oauth.spec.ts`
  - Cover quick-setup broker exchange path.
  - Cover broker refresh path.
  - Cover missing broker config.
  - Cover BYOC fallback behavior.

- Update `tui/setup_test.go`
  - Cover new Quick Setup / BYOC / PAT menu behavior.

- Update `tui/setup_coverage_test.go`
  - Add coverage for new branches in Asana setup flow.

## External Work Required

This part is outside the CLI repo but required for the web-style experience:

### Asana App Registration

- Create a TeamHero Asana app in the Asana developer console.
- Add allowed redirect URIs for localhost development and production CLI usage.
- Decide required scopes up front.
- Configure distribution rules so users can authorize successfully.

### TeamHero Broker Service

Endpoints:

- `POST /oauth/asana/exchange`
- `POST /oauth/asana/refresh`
- optional `POST /oauth/asana/revoke`

Security controls:

- TLS only
- request validation
- rate limiting
- structured audit logs
- secret storage in server-side environment or secret manager

## Rollout Plan

### Phase 1: Stabilize the Existing Browser Flow

Goal: make the current flow explicit and testable.

- Clean up `src/lib/asana-oauth.ts` so direct exchange and refresh paths are isolated.
- Make setup errors more specific.
- Add missing tests around the existing browser path.

Outcome:

- BYOC continues to work cleanly.
- Codebase is ready for a shared flow.

### Phase 2: Add Quick Setup UX In The TUI

Goal: expose the intended product shape before the broker is fully live.

- Update `tui/setup.go` to add `Quick Setup` and `Bring Your Own Credentials`.
- Gate `Quick Setup` behind a config flag so it can be enabled per environment.

Outcome:

- UI matches the target experience.
- Non-configured environments still degrade gracefully.

### Phase 3: Integrate The Broker

Goal: make Quick Setup actually work without user-created app credentials.

- Implement broker client in TypeScript.
- Route auth-code exchange and refresh through TeamHero.
- Store broker-compatible token state locally.

Outcome:

- Users click a link and authorize in browser without creating their own app.

### Phase 4: Hardening

Goal: make the experience production-safe.

- Add revoke/disconnect support.
- Improve success and failure pages for browser callback.
- Add telemetry for auth failures.
- Document fallback behavior for headless / remote terminals.

Outcome:

- Supportable long-term integration.

## Risks And Edge Cases

- Remote SSH / container / WSL usage may open the browser on a different machine than the terminal session.
- `localhost` callback ports can be blocked by local security software or corporate policy.
- Asana app distribution settings may block some users until the app is approved correctly.
- If TeamHero uses a broker, broker downtime will block new auth and token refresh.
- PAT and OAuth paths must not fight each other when both are configured.

## Recommended Decisions Before Implementation

Make these choices first:

1. Is this an internal-only TeamHero feature or something distributed broadly?
2. Is TeamHero willing to run a small auth broker service?
3. Should local storage keep Asana refresh tokens, or should the broker own them?
4. Do you want PAT fallback to remain visible, or be hidden under an advanced option?

## Suggested Implementation Sequence

1. Refactor `src/lib/asana-oauth.ts` into clear BYOC vs broker flows.
2. Update `tui/setup.go` to show `Quick Setup`, `BYOC`, and `PAT`.
3. Implement the broker client in the CLI.
4. Build the broker service outside this repo.
5. Wire refresh through the broker.
6. Add tests for both auth modes.
7. Document environment flags and rollout steps.

## Recommendation Summary

If the goal is merely "make the current CLI auth a bit nicer," polish the existing browser flow and keep BYOC.

If the goal is "make Asana auth feel like ChatGPT / Claude web," the right plan is:

- keep the localhost browser callback in the CLI
- add a TeamHero-owned Asana OAuth app
- add a small TeamHero broker for code exchange and refresh
- keep BYOC and PAT as fallbacks

That gives you the same basic user experience without shipping an Asana client secret inside the CLI.
