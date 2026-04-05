# Release Infrastructure Setup Guide

This document walks through every manual step needed to activate the GoReleaser
release pipeline. Follow these steps in order — each one builds on the previous.

---

## Understanding the Repositories

You will end up with **three** GitHub repositories under the `asabaylus` account.
Here's what each one does and why it exists:

| Repository | What it is | Why it exists |
|---|---|---|
| `asabaylus/teamhero.cli` | **The main repo** — your existing codebase. Contains the Go TUI, the TypeScript service, the GoReleaser config, and the CI workflows. This is where you push code and tags. | This is the repo you already have. Nothing changes here. |
| `asabaylus/homebrew-teamhero` | **The Homebrew tap** — a tiny repo that holds a single Ruby formula file (`Formula/teamhero.rb`). Homebrew requires formulas to live in a repo named `homebrew-<name>`. | When someone runs `brew install asabaylus/teamhero/teamhero`, Homebrew looks for a repo called `asabaylus/homebrew-teamhero` and reads the formula from it. GoReleaser auto-creates and updates this formula file on every release — you never edit it by hand. |
| `asabaylus/apt.teamhero.dev` | **The APT repository** — a GitHub Pages site that serves `.deb` packages and signed metadata. Acts as a standard Debian/Ubuntu package repository. | When someone runs `sudo apt-get install teamhero`, apt fetches packages from this repo. The `update-apt.yml` workflow in your main repo pushes new `.deb` files here after each release. |

**Key point:** `teamhero.cli` is your *source code*. The other two repos are
*distribution channels* — they hold no source code, only release artifacts.

---

## Step 1: Create the Homebrew Tap Repository

### What you're doing

Creating an empty GitHub repo that GoReleaser will push a Homebrew formula into
on every release.

### Instructions

1. Go to https://github.com/new

2. Fill in:
   - **Owner:** `asabaylus`
   - **Repository name:** `homebrew-teamhero` (must be exactly this — Homebrew
     convention requires `homebrew-` prefix)
   - **Description:** `Homebrew formula for TeamHero`
   - **Visibility:** Public (Homebrew taps must be public)
   - **Initialize with a README:** Yes (check the box)

3. Click **Create repository**

4. That's it. The repo will contain only a README. GoReleaser creates the
   `Formula/teamhero.rb` file automatically on the first release.

### How users will install

```bash
brew install asabaylus/teamhero/teamhero
```

No explicit `brew tap` needed — Homebrew resolves `owner/repo/formula` automatically.

---

## Step 2: Create a Personal Access Token for the Homebrew Tap

### What you're doing

GoReleaser needs permission to push the formula file to `homebrew-teamhero`.
The default `GITHUB_TOKEN` in GitHub Actions only has access to the repo that
triggered the workflow (`teamhero.cli`), not to other repos. So you need a
Personal Access Token (PAT) that can write to `homebrew-teamhero`.

### Instructions

1. Go to https://github.com/settings/tokens?type=beta
   (This is the **Fine-grained tokens** page — preferred over classic tokens)

2. Click **Generate new token**

3. Fill in:
   - **Token name:** `HOMEBREW_TAP_TOKEN`
   - **Expiration:** 90 days (or longer — you'll need to rotate it when it expires)
   - **Resource owner:** `asabaylus`
   - **Repository access:** Select **Only select repositories**, then choose
     `asabaylus/homebrew-teamhero`
   - **Permissions → Repository permissions:**
     - **Contents:** Read and write (this lets GoReleaser push the formula)
     - **Metadata:** Read-only (required, auto-selected)
   - Leave all other permissions at their defaults

4. Click **Generate token**

5. **Copy the token immediately** — you won't see it again.

6. Now store it as a secret in your main repo:
   - Go to https://github.com/asabaylus/teamhero.cli/settings/secrets/actions
   - Click **New repository secret**
   - **Name:** `HOMEBREW_TAP_TOKEN`
   - **Secret:** Paste the token you just copied
   - Click **Add secret**

---

## Step 3: Generate the GPG Key for APT Signing

### What you're doing

APT repositories require all package metadata to be cryptographically signed.
Users import your public key so `apt` can verify that packages actually came
from you. You'll generate a GPG keypair, export the private key as a GitHub
secret (so CI can sign), and publish the public key in the APT repo.

### Instructions

Run these commands on your local machine:

```bash
# 1. Generate the key (no passphrase for simplicity — CI can't enter one interactively)
#    If you want a passphrase, add %ask-passphrase or set Passphrase: <value>
gpg --batch --gen-key <<'GPGEOF'
Key-Type: RSA
Key-Length: 4096
Name-Real: TeamHero
Name-Email: release@teamhero.dev
Expire-Date: 0
%no-protection
GPGEOF
```

You should see output like:
```
gpg: key ABCDEF1234567890 marked as ultimately trusted
gpg: revocation certificate stored as '...'
```

```bash
# 2. Verify the key was created
gpg --list-keys "release@teamhero.dev"
```

You'll see something like:
```
pub   rsa4096 2026-03-14 [SCEAR]
      A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2
uid           [ultimate] TeamHero <release@teamhero.dev>
```

```bash
# 3. Export the PUBLIC key (this goes into the APT repo for users to download)
gpg --export --armor "release@teamhero.dev" > teamhero.gpg

# 4. Export the PRIVATE key (this becomes a GitHub secret)
gpg --export-secret-keys --armor "release@teamhero.dev" > teamhero-private.gpg

# 5. Print the private key so you can copy it
cat teamhero-private.gpg
```

**IMPORTANT:** Keep `teamhero-private.gpg` safe. After you've stored it as a
GitHub secret (next steps), you can delete the file. Never commit it to any repo.

### If you want a passphrase

Replace `%no-protection` with:
```
Passphrase: your-chosen-passphrase-here
```

If you use a passphrase, you'll also need to store it as the `APT_GPG_PASSPHRASE`
secret. If you used `%no-protection`, set `APT_GPG_PASSPHRASE` to an empty string
(or any value — it won't be used, but the workflow references it).

---

## Step 4: Create the APT Repository

### What you're doing

Creating a GitHub Pages site that acts as a Debian APT repository. This is where
`.deb` packages and signed metadata live.

### Instructions

1. Go to https://github.com/new

2. Fill in:
   - **Owner:** `asabaylus`
   - **Repository name:** `apt.teamhero.dev`
   - **Description:** `APT package repository for TeamHero`
   - **Visibility:** Public (users need to access it)
   - **Initialize with a README:** Yes

3. Click **Create repository**

4. Add the CNAME file and public GPG key:

```bash
# Clone the new repo
git clone https://github.com/asabaylus/apt.teamhero.dev.git
cd apt.teamhero.dev

# Add the CNAME file (tells GitHub Pages to serve on apt.teamhero.dev)
echo "apt.teamhero.dev" > CNAME

# Copy the public GPG key you exported in Step 3
cp /path/to/teamhero.gpg .

# Create the directory structure the workflow expects
mkdir -p dists/stable/main/binary-amd64
mkdir -p dists/stable/main/binary-arm64
mkdir -p pool/main/t/teamhero

# Commit and push
git add -A
git commit -m "Initial APT repository structure"
git push
```

5. Enable GitHub Pages:
   - Go to https://github.com/asabaylus/apt.teamhero.dev/settings/pages
   - **Source:** Deploy from a branch
   - **Branch:** `main`, folder `/ (root)`
   - Click **Save**

6. Set the custom domain:
   - On the same Pages settings page, under **Custom domain**, enter: `apt.teamhero.dev`
   - Click **Save**
   - Check **Enforce HTTPS** (may take a few minutes to become available after DNS propagates)

### How users will install

```bash
# Add the GPG key
curl -fsSL https://apt.teamhero.dev/teamhero.gpg | sudo gpg --dearmor -o /usr/share/keyrings/teamhero.gpg

# Add the repository
echo "deb [signed-by=/usr/share/keyrings/teamhero.gpg] https://apt.teamhero.dev stable main" \
  | sudo tee /etc/apt/sources.list.d/teamhero.list

# Install
sudo apt-get update && sudo apt-get install teamhero
```

---

## Step 5: Store the APT Secrets in GitHub

### What you're doing

The `update-apt.yml` workflow needs three secrets to sign packages and push to
the APT repo. You're adding all three now.

### Instructions

Go to https://github.com/asabaylus/teamhero.cli/settings/secrets/actions

Add these three secrets:

#### Secret 1: `APT_GPG_PRIVATE_KEY`

- Click **New repository secret**
- **Name:** `APT_GPG_PRIVATE_KEY`
- **Secret:** Paste the entire contents of `teamhero-private.gpg` (from Step 3),
  including the `-----BEGIN PGP PRIVATE KEY BLOCK-----` and
  `-----END PGP PRIVATE KEY BLOCK-----` lines
- Click **Add secret**

#### Secret 2: `APT_GPG_PASSPHRASE`

- Click **New repository secret**
- **Name:** `APT_GPG_PASSPHRASE`
- **Secret:**
  - If you used `%no-protection` in Step 3: enter a single space (the field
    can't be empty, but the passphrase won't be checked)
  - If you set a passphrase in Step 3: enter that exact passphrase
- Click **Add secret**

#### Secret 3: `APT_REPO_TOKEN`

This is another PAT, similar to the Homebrew one, but for pushing to
`apt.teamhero.dev`.

1. Go to https://github.com/settings/tokens?type=beta

2. Click **Generate new token**

3. Fill in:
   - **Token name:** `APT_REPO_TOKEN`
   - **Expiration:** 90 days (or longer)
   - **Resource owner:** `asabaylus`
   - **Repository access:** Select **Only select repositories**, then choose
     `asabaylus/apt.teamhero.dev`
   - **Permissions → Repository permissions:**
     - **Contents:** Read and write
     - **Metadata:** Read-only
   - Leave all other permissions at their defaults

4. Click **Generate token**

5. Copy the token, then go back to
   https://github.com/asabaylus/teamhero.cli/settings/secrets/actions

6. Click **New repository secret**
   - **Name:** `APT_REPO_TOKEN`
   - **Secret:** Paste the token
   - Click **Add secret**

---

## Step 6: Configure DNS (Namecheap)

### What you're doing

Pointing `apt.teamhero.dev` to GitHub Pages so the APT repository is accessible
at a clean URL.

### Instructions

1. Log in to Namecheap → go to **Domain List** → click **Manage** next to `teamhero.dev`

2. Go to the **Advanced DNS** tab

3. Add this record:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| CNAME | `apt` | `asabaylus.github.io.` | Automatic |

   (Note the trailing dot after `github.io.` — Namecheap may or may not require it;
   try without if it rejects it)

4. Save. DNS propagation typically takes 5–30 minutes.

5. After propagation, go back to
   https://github.com/asabaylus/apt.teamhero.dev/settings/pages
   and verify that the custom domain shows a green checkmark.

---

## Step 7: Deploy the Marketing Site to GitHub Pages (teamhero.dev)

### What you're doing

Deploying the static marketing site (`site/`) to GitHub Pages and pointing the
apex domain `teamhero.dev` to it via Namecheap DNS. After this step,
`https://teamhero.dev` will serve your landing page.

### 7a. CNAME file — DONE

The `site/CNAME` file already exists with `teamhero.dev` as the custom domain.

### 7b. GitHub Pages deployment workflow — DONE

The workflow `.github/workflows/deploy-site.yml` is already in the repo. It
deploys `site/` to GitHub Pages on every push to `main` that touches `site/**`,
and supports manual dispatch via `workflow_dispatch`.

### 7c. Enable GitHub Pages on the main repo

1. Go to https://github.com/asabaylus/teamhero.cli/settings/pages

2. Under **Build and deployment → Source**, select **GitHub Actions**
   (not "Deploy from a branch" — the workflow handles it)

3. Under **Custom domain**, enter: `teamhero.dev`

4. Click **Save**

5. **Do not** check "Enforce HTTPS" yet — wait until DNS propagates (step 7d)

### 7d. Configure DNS in Namecheap

1. Log in to Namecheap → **Domain List** → **Manage** next to `teamhero.dev`

2. Go to the **Advanced DNS** tab

3. **Delete** any existing parking/default records (e.g., the Namecheap parking
   page URL redirect or default A records)

4. Add the following records:

   **A records for the apex domain** (`teamhero.dev`):

   | Type | Host | Value | TTL |
   |------|------|-------|-----|
   | A Record | `@` | `185.199.108.153` | Automatic |
   | A Record | `@` | `185.199.109.153` | Automatic |
   | A Record | `@` | `185.199.110.153` | Automatic |
   | A Record | `@` | `185.199.111.153` | Automatic |

   **AAAA records for IPv6** (recommended):

   | Type | Host | Value | TTL |
   |------|------|-------|-----|
   | AAAA Record | `@` | `2606:50c0:8000::153` | Automatic |
   | AAAA Record | `@` | `2606:50c0:8001::153` | Automatic |
   | AAAA Record | `@` | `2606:50c0:8002::153` | Automatic |
   | AAAA Record | `@` | `2606:50c0:8003::153` | Automatic |

   **CNAME for www subdomain** (redirects `www.teamhero.dev` → `teamhero.dev`):

   | Type | Host | Value | TTL |
   |------|------|-------|-----|
   | CNAME | `www` | `asabaylus.github.io.` | Automatic |

   **Keep the existing APT subdomain** (from Step 6):

   | Type | Host | Value | TTL |
   |------|------|-------|-----|
   | CNAME | `apt` | `asabaylus.github.io.` | Automatic |

5. Save. Your full DNS records should now look like:

   | Type | Host | Value |
   |------|------|-------|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153` |
   | AAAA | `@` | `2606:50c0:8001::153` |
   | AAAA | `@` | `2606:50c0:8002::153` |
   | AAAA | `@` | `2606:50c0:8003::153` |
   | CNAME | `www` | `asabaylus.github.io.` |
   | CNAME | `apt` | `asabaylus.github.io.` |

### 7e. Verify and enable HTTPS

1. Wait 5–30 minutes for DNS propagation

2. Verify DNS is working:
   ```bash
   dig teamhero.dev +short
   # Should return the four GitHub Pages IPs

   dig www.teamhero.dev +short
   # Should return asabaylus.github.io.
   ```

3. Go back to https://github.com/asabaylus/teamhero.cli/settings/pages

4. The custom domain should show a green checkmark. If it shows "DNS check
   in progress," wait a few more minutes and refresh.

5. Check **Enforce HTTPS** (GitHub provisions a Let's Encrypt certificate
   automatically — this can take up to 15 minutes after the DNS check passes)

6. Visit `https://teamhero.dev` — you should see your landing page

### Troubleshooting

| Problem | Fix |
|---------|-----|
| "DNS check in progress" won't resolve | Verify A records point to the four GitHub IPs (`dig teamhero.dev`). Check that no conflicting records exist (especially old parking page redirects). |
| 404 on `teamhero.dev` | Ensure `site/CNAME` contains exactly `teamhero.dev` (no trailing newline issues). Check that the Pages workflow ran successfully in Actions. |
| HTTPS not available | Wait up to 15 minutes after the DNS check passes. If it still fails, remove the custom domain, save, re-add it, and save again. |
| `apt.teamhero.dev` stopped working | Make sure the `apt` CNAME record still exists — it's easy to accidentally delete it when editing other records. |
| `www.teamhero.dev` doesn't redirect | GitHub Pages handles www → apex redirection automatically when both the CNAME and the CNAME file are configured correctly. |

---

## Step 8: Test with a Pre-release Tag

### What you're doing

Running the full pipeline end-to-end without cutting a real release.

### Instructions

```bash
# Make sure all changes are committed and pushed to main
git push origin main

# Create a pre-release tag
git tag v0.2.0-rc.1
git push origin v0.2.0-rc.1
```

### What to watch

1. Go to https://github.com/asabaylus/teamhero.cli/actions and watch the
   **Release** workflow

2. It should run three jobs:
   - `build-service` (5 matrix entries — one per platform/arch)
   - `plugin` (builds the Claude Code plugin zip)
   - `goreleaser` (downloads artifacts, runs GoReleaser)

3. When `goreleaser` completes, check:
   - **GitHub Releases:** https://github.com/asabaylus/teamhero.cli/releases
     - Should have a new pre-release with archives, `.deb` files, `SHA256SUMS`,
       `install.sh`, and `teamhero-scripts-plugin.zip`
   - **Homebrew tap:** https://github.com/asabaylus/homebrew-teamhero
     - Should now have `Formula/teamhero.rb` (auto-created by GoReleaser)
   - **APT repo:** The `update-apt.yml` workflow does NOT run for pre-releases
     (by design — the `if: "!github.event.release.prerelease"` guard skips it)

4. Test the install script:
   ```bash
   curl -fsSL https://github.com/asabaylus/teamhero.cli/releases/download/v0.2.0-rc.1/install.sh | bash -s -- --version v0.2.0-rc.1
   ```

5. Test Homebrew (if the formula was pushed):
   ```bash
   brew install asabaylus/teamhero/teamhero
   teamhero --version  # Should print 0.2.0-rc.1
   ```

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `goreleaser` job fails with "could not push to homebrew-teamhero" | Check that `HOMEBREW_TAP_TOKEN` secret exists and the PAT has Contents write permission on `homebrew-teamhero` |
| Service binary missing for a platform | Check the `build-service` matrix job for that platform — Bun cross-compilation can fail for some targets |
| `.deb` files missing from release | Check GoReleaser logs — nFPM only builds for linux/amd64 and linux/arm64 |
| `update-apt.yml` didn't run | It only runs on non-prerelease `release: published` events. Pre-release tags won't trigger it. |

---

## Step 9: Cut the Real Release

Once the pre-release looks good:

```bash
git tag v0.2.0
git push origin v0.2.0
```

This will:
1. Run the Release workflow (same as the pre-release test)
2. Create a non-draft, non-prerelease GitHub Release
3. Push the Homebrew formula to `homebrew-teamhero`
4. Trigger `update-apt.yml`, which updates the APT repository with signed `.deb` packages

After this release completes, all three install paths should work:

```bash
# curl
curl -fsSL https://github.com/asabaylus/teamhero.cli/releases/latest/download/install.sh | bash

# Homebrew
brew install asabaylus/teamhero/teamhero

# APT (after adding the repo — see Step 4)
sudo apt-get update && sudo apt-get install teamhero
```

---

## Secrets Reference

All secrets are stored in:
https://github.com/asabaylus/teamhero.cli/settings/secrets/actions

| Secret | What it is | How to get it | Scope |
|--------|-----------|---------------|-------|
| `HOMEBREW_TAP_TOKEN` | Fine-grained PAT | GitHub Settings → Developer settings → Fine-grained tokens | Contents: write on `homebrew-teamhero` only |
| `APT_GPG_PRIVATE_KEY` | Armored GPG private key | `gpg --export-secret-keys --armor "release@teamhero.dev"` | Signs APT metadata |
| `APT_GPG_PASSPHRASE` | GPG key passphrase (or space if none) | You chose it during key generation | Used with `--passphrase` in GPG signing |
| `APT_REPO_TOKEN` | Fine-grained PAT | GitHub Settings → Developer settings → Fine-grained tokens | Contents: write on `apt.teamhero.dev` only |

### Token rotation

Fine-grained PATs expire. When they do:
1. Generate a new token with the same permissions
2. Go to the secrets page and update the secret value
3. No code changes needed

### GPG key

The GPG key was generated with `Expire-Date: 0` (no expiration). It only needs
regenerating if the private key is compromised. If that happens, generate a new
key (Step 3), update the `APT_GPG_PRIVATE_KEY` secret, and push the new public
key to the `apt.teamhero.dev` repo.

---

## Cleanup Checklist

After the first successful real release (v0.2.0), verify these deleted files
are no longer needed:

- [x] `scripts/package.sh` — deleted (GoReleaser handles archiving)
- [x] `scripts/update-homebrew.sh` — deleted (GoReleaser auto-pushes formula)
- [x] `homebrew/teamhero.rb` — deleted (formula lives in `homebrew-teamhero` repo)
- [ ] `tui/Makefile` — **kept** (still useful for local dev builds)

After verifying the private GPG key is stored as a secret:
- [ ] Delete `teamhero-private.gpg` from your local machine
- [ ] Optionally back up the GPG key to a password manager
