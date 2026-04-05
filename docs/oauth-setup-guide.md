# Auth Setup Guide

TeamHero requires credentials for GitHub and OpenAI. Asana and Google Drive are optional.

Run `teamhero setup` for an interactive wizard that stores credentials at `~/.config/teamhero/.env`.

---

## GitHub Personal Access Token (required)

TeamHero uses GitHub to fetch commits, pull requests, and organization members. You need a **fine-grained PAT** (token starts with `github_pat_`).

**Env var:** `GITHUB_PERSONAL_ACCESS_TOKEN`

### Step-by-step

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
   (direct link: https://github.com/settings/personal-access-tokens/new)

2. Set **Token name** (e.g. `teamhero-cli`) and an **Expiration** date.

3. Under **Resource owner**, select the organization you want to report on.

4. Under **Repository access**, choose **All repositories** (or select specific repos).

5. Under **Permissions**, grant the following — all others can stay at "No access":

   | Category | Permission | Why |
   |---|---|---|
   | Repository → Contents | Read-only | Reads commit history and LOC stats |
   | Repository → Metadata | Read-only | Required for all repository access |
   | Repository → Pull requests | Read-only | Fetches PR titles, authors, dates |
   | Organization → Members | Read-only | Lists org members for contributor scope |

6. Click **Generate token** and copy the value immediately.

7. Paste it when prompted by `teamhero setup`, or add it to `~/.config/teamhero/.env`:
   ```
   GITHUB_PERSONAL_ACCESS_TOKEN=github_pat_...
   ```

> **Classic PAT alternative:** If your org requires classic tokens, create one at
> https://github.com/settings/tokens/new with scopes `repo` and `read:org`.
> Classic tokens start with `ghp_`. The setup wizard accepts both formats.

### Verifying access

```bash
teamhero doctor
```

Doctor validates the token against the GitHub API and reports which scopes are active.

---

## OpenAI API Key (required)

Used to generate AI-powered summaries, highlights, and discrepancy analysis.

**Env var:** `OPENAI_API_KEY`

1. Go to https://platform.openai.com/api-keys
2. Click **Create new secret key**, give it a name, and copy the value (starts with `sk-`).
3. Add it to `~/.config/teamhero/.env`:
   ```
   OPENAI_API_KEY=sk-...
   ```

**Optional tuning vars:**

| Var | Purpose |
|---|---|
| `AI_MODEL` | Default model for all sections (default: `gpt-5-mini`) |
| `OPENAI_SERVICE_TIER` | Set to `flex` for lower cost / slower responses |
| `AI_API_BASE_URL` | Override to use any OpenAI-compatible endpoint |
| `AI_API_KEY` | API key for the custom endpoint above |

---

## Asana Personal Access Token (optional)

Required only for the Visible Wins section, which reconciles Asana tasks against GitHub activity.

**Env var:** `ASANA_API_TOKEN`

1. Go to **Asana → Profile → My Settings → Apps → Developer Apps**
   (direct link: https://app.asana.com/0/my-apps)
2. Click **Create new token**, give it a name, and copy the value.
3. Add it to `~/.config/teamhero/.env`:
   ```
   ASANA_API_TOKEN=...
   ```

**Required Asana config vars** (set via `teamhero setup` or directly):

| Var | Purpose |
|---|---|
| `ASANA_PROJECT_GID` | GID of the Asana project to pull tasks from |
| `ASANA_SECTION_GID` | (optional) Limit to a specific board section |
| `ASANA_SECTION_NAME` | (optional) Section name for display |

Find a project GID from the URL when viewing the project: `app.asana.com/0/<PROJECT_GID>/...`

---

## Google Drive OAuth (optional)

Required only if you use Google Meet for meeting notes and want TeamHero to fetch transcripts from Drive.

**Env var:** none — Google credentials are stored as tokens at `~/.config/teamhero/google-tokens.json`

**Config var:** `GOOGLE_DRIVE_FOLDER_IDS` — comma-separated folder IDs containing transcripts

TeamHero uses OAuth with PKCE (no client secret required for the default app). The flow is browser-based and handled entirely by `teamhero setup`.

### Using the built-in OAuth app

1. Run `teamhero setup` and select **Google Drive**.
2. A browser window opens to Google's consent screen.
3. Sign in and grant **Google Drive (read-only)** access.
4. The terminal confirms the connected email address.

Tokens are saved to `~/.config/teamhero/google-tokens.json` (mode `0600`) and refreshed automatically.

> **Token expiry note:** If the OAuth app is in Google's "Testing" mode, refresh tokens expire
> after 7 days. To re-authorize: run `teamhero setup` → Google Drive → Reconnect.

### Bring Your Own OAuth App (BYOC)

If your organization requires a verified OAuth app or you need longer-lived tokens:

1. Go to https://console.cloud.google.com/apis/credentials
2. Create a project and enable the **Google Drive API** and **Google People API**.
3. Under **Credentials**, create an **OAuth 2.0 Client ID** for type **Web application**.
4. Add `http://localhost` as an authorized redirect URI (TeamHero uses a random port).
5. Set your credentials before running setup:
   ```
   export GOOGLE_OAUTH_CLIENT_ID=<your-client-id>
   export GOOGLE_OAUTH_CLIENT_SECRET=<your-client-secret>
   ```
6. Publish the app (OAuth consent screen → Publishing status → Publish) to avoid 7-day token expiry.

### Required scopes

| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/drive.readonly` | Read meeting transcript files |
| `https://www.googleapis.com/auth/userinfo.email` | Confirm connected account |

---

## Credential storage

All credentials are stored in `~/.config/teamhero/.env` with mode `0600`. They are never written to the project directory. The `.env.schema` file in this repo documents the variable names and types but contains no secret values.

To audit your stored credentials:

```bash
teamhero doctor          # Validates each credential against its API
cat ~/.config/teamhero/.env   # View raw values (redacted in doctor output)
```
