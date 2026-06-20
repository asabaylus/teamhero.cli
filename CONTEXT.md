# Team Hero

Team Hero produces per-engineer engineering-activity metrics from GitHub (and a
ticketing system) across a GitHub org, feeding both CLI reports and an external
tracking spreadsheet.

## Language

**Person**:
A single human contributor, the canonical entity all activity rolls up to. One
Person may span multiple git author names, emails, and GitHub logins.
_Avoid_: Contributor (ambiguous), account, user

**Tracked PR**:
A pull request whose GitHub **author** (opener) maps to a Person, **created**
within the reporting window, counted **org-wide via the GitHub search API**
across all repos and all states. This is the number that goes in the
spreadsheet's weekly PR columns.
_Avoid_: Merged PR (a separate metric), closed PR

**Identity map**:
The version-controlled, human-edited mapping of git emails / author names /
GitHub logins onto a Person, used for cases GitHub cannot auto-link. Real
entries are kept in local, gitignored data only.
_Avoid_: User map (legacy single-login form), alias list

**Tracking spreadsheet**:
The externally hosted workbook (sheet "Data") with one row per engineer, a
single GitHub-login column, and weekly PR / Tickets / LoC buckets. The
authoritative output we keep accurate.
