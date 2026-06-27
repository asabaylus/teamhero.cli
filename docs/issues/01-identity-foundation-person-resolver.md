# Slice 1 — Identity foundation: Person model + IdentityResolver

Labels: ready-for-agent
Type: AFK
Source: docs/prds/2026-06-13-identity-reconciliation.md

> Redaction: no real names/logins/orgs in committed files. Real identity data
> lives only in gitignored `.teamhero/local/`; committed examples use
> placeholders (Person A/B/C/D, `login-a`, "the org", "Vendor Pod").

## What to build

The canonical identity spine the rest of the feature builds on. Introduce a
**Person** that unifies many git author names, emails, and GitHub logins, and a
new **IdentityResolver** port that resolves any raw commit/PR identity to a
Person (or routes it to a needs-mapping queue).

End-to-end behavior:
- A Person carries `logins[]`, `emails[]`, `names[]`. The previous single-login
  identity shape is replaced (no backward compatibility). See ADR-0001.
- Resolution unions every identity onto the Person whose login, email, or name
  set matches, using union-find so transitive links merge
  (email ↔ login ↔ name).
- Emails are normalized to lowercase. Noreply emails of the form
  `<digits>+login@users.noreply.github.com` are parsed to their login and may
  auto-seed the map.
- A bare display-name is never enough to instantiate a Person; unmatched
  identities are routed to a review queue, never reported as a zero Person.
- The identity map is loaded from gitignored local data, with a committed
  redacted example documenting the shape.

This slice is verifiable on its own: given raw identities + a map, the resolver
returns the correct Person and routes unmatched identities to review.

## Acceptance criteria

- [ ] Person model exposes `logins[]`, `emails[]`, `names[]`; old single-login
      shape removed.
- [ ] Resolver unions identities via union-find across email/login/name.
- [ ] Two author names on one email resolve to one Person (no second Person for
      the bare handle).
- [ ] Multiple emails for one person union onto a single Person.
- [ ] Multiple logins map to one Person and raise a duplicate-account flag.
- [ ] `<digits>+login@users.noreply.github.com` parses to `login`.
- [ ] An unmatched identity routes to the review queue; a bare name never
      creates a Person.
- [ ] External-collaborator identities (non-member) are resolvable, not dropped.
- [ ] Identity map loads from gitignored local data; a redacted example is
      committed.
- [ ] Unit tests cover all eight identity cases.

## Blocked by

None — can start immediately.
