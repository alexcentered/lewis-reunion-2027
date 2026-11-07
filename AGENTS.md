# AGENTS.md: orientation for anyone working on this repo

## Purpose and audience

This file is for an AI agent or a committee volunteer who opens this repo cold. It says how the Lewis Family Reunion 2027 site is built, where the data lives, what the backend expects, and how to change things without breaking them. Read it before touching `app.js`, `index.html` or `apps-script/Code.gs`. The email runbook is in `docs/EMAIL.md`. Hands-on test scripts are in `TESTING.md`. The committee-facing summary is `README.md`.

## Architecture

- **Website.** Static HTML, CSS and JavaScript in this repo, served by GitHub Pages at `https://lewisfamilyroots.com` (the `CNAME` file holds the domain). DNS for the domain is on Cloudflare. The old `alexcentered.github.io/lewis-reunion-2027` address redirects to the custom domain.
- **Backend.** One Google Apps Script project, `apps-script/Code.gs`, bound to the committee's Google Sheet named "Lewis Reunion 2027 — Site Data". It is deployed as a web app with **Execute as: Me** and **Who has access: Anyone**. The site calls its `/exec` URL.
- **Glue.** `config.js` holds only that `/exec` URL and the `photosEnabled` switch. Nothing else in the repo points at Google.
- **Email.** Sent by the backend through the Brevo API from `committee@lewisfamilyroots.com`, with the deployer's Gmail (MailApp) as a fallback and a MailQueue tab in the Sheet as the last resort. Replies to `committee@` and mail to `info@` are forwarded by Cloudflare Email Routing to `lewisfamilyreunion2027@gmail.com`.
- **No family data in the repo.** The repo is public. Names, registrations, payments and photos live only in the Sheet and a private Drive folder.

## Repo map

| File | What it is |
|---|---|
| `index.html` | The whole site in one page: markup, CSS, and section containers. Sections switch on the URL hash (`#me`, `#register`, and so on). |
| `app.js` | Site logic: reads `?c=` and `?t=` from the link, talks to the backend, renders every section, the registration form, My Registration, the code-entry form, photo upload. |
| `tree-engine.js`, `tree.js` | The interactive family tree (layout engine and page glue). Fed by the People and Tree notes tabs. |
| `config.js` | `window.LR = { apiUrl, photosEnabled }`. The only file that changes when the backend URL changes. |
| `apps-script/Code.gs` | The backend. Pasted by hand into the Apps Script editor. Not deployed by git. |
| `CNAME`, `.nojekyll` | GitHub Pages settings: custom domain, and "serve files as they are". |
| `README.md` | Overview and committee guide. |
| `TESTING.md` | Hands-on checklists (photos, email and codes). |
| `AGENTS.md` | This file. |
| `docs/EMAIL.md` | Email runbook: Brevo, DNS, routing, queue, troubleshooting, future Updates tab. |

## Data model: the Sheet tabs

`Code.gs` reads headers by name, not by position (`headers_`, `rows_`, `rowAt_`, `writeRow_`). Columns may be reordered or added, but a renamed header breaks the code that uses it. Tab names are in the `TAB` constant.

**Registrations** (one row per household)
`Household ID`, `Registered`, `Updated`, `First`, `Middle`, `Last`, `Birth surname`, `Preferred`, `Email`, `Phone`, `City`, `State`, `Branch`, `Parents`, `Grandparent`, `Spouse`, `Adults`, `Children`, `Attendees` (one line per person: `name · Adult|Child · age · shirt`), `Shirt sizes`, `Days`, `Arrive`, `Depart`, `Nights`, `Lodging`, `Diet`, `Needs`, `Show on list`, `Token hash`, then five columns that `recompute_` writes as one block and so must sit side by side in this order: `Due`, `Confirmed`, `Awaiting`, `Balance`, `Status`.

**Payments** (one row per reported payment)
`Payment ID`, `Household ID`, `Household`, `Reported`, `Amount`, `Method`, `Date sent`, `Reference`, `Note`, `Status` (`Reported`, `Confirmed`, `Not received`), `Confirmed on`, `Confirmed by`, `Receipt sent`. `Receipt sent` is appended by `setup()` if missing and holds `<Status> · <ISO time> · <route>` once a receipt email has gone out.

**Entries** (stories, tributes, veterans, directory, photos, marketplace)
`Entry ID`, `Type` (one of `story`, `memoriam`, `veteran`, `directory`, `photo`, `market`), `Posted`, `Posted by`, `Visible` (checkbox), `Title`, `Subtitle`, `Meta`, `Body`, `Contact`, `Photo ID` (Drive file id), `Token hash`.

**Config**
`Key`, `Value`, and a third column for notes. Read as a map by `config_()`. Keys are listed in the next section.

**Agenda**: `Day`, `Date`, `Time`, `What`, `Where`. Grouped by Day on the site.

**Branches**: `Line`, `Founders`, `Child`. Rows without a Child are ignored.

**Names**: `Name`, `Note`, `Question`.

**People** (the tree): `ID`, `Name`, `Nickname`, `Born`, `Place`, `Story`, `Parents`, `Partners` (comma-separated person IDs), `Order`.

**Tree notes**: `Title`, `Note`.

**MailQueue** (created by `setup()`; every email sent or waiting). Exactly these 13 headers, in this order (`MAIL_HEADERS`):
`Queued`, `To`, `Subject`, `Html`, `Text`, `Status`, `Attempts`, `Last error`, `Sent`, `Via`, `Key`, `Kind`, `Household ID`.
`Status` is `Queued` (waiting), `Sent`, or `Failed` (a permanent refusal, or 20 attempts). The committee retries a Failed row by typing `Queued` into Status. `Via` reads `Brevo <messageId>`, `MailApp`, or stays blank while queued. `Kind` is one of `link`, `receipt0`, `receipt`, `committee`, `test`. `drain_` writes `Status`, `Attempts`, `Last error`, `Sent`, `Via` as one block when they are adjacent, so keep them side by side.

**Dashboard** is a committee tab of plain spreadsheet formulas. The code never touches it.

## Config tab keys

| Key | Meaning | Default when blank |
|---|---|---|
| `familyCode` | The code in the shared link (`?c=`) and typed at gates. Change it to retire old links. | none; nothing family-only works without it |
| `siteUrl` | The site address, used to build private links in email. | none |
| `siteLive` | `Yes` turns on private links and registration codes in email. Anything else sends a plain receipt (`receipt0`) and leaves tokens alone. | treated as No |
| `email` | The committee address shown in email footers, used as Reply-To when `mailReplyTo` is blank, and as the recipient of committee notifications. | none |
| `feeAdult`, `feeChild` | Dollar amounts. Both must be numbers for Due and Balance to be computed. | blank = fees not announced |
| `childAge` | Age cutoff for the child fee. | 12 |
| `deadline` | Payment due date, shown on the site and in the registration email. | none |
| `roomBlock` | Hotel room-block note shown on the site. | none |
| `zelle`, `cashapp`, `venmo`, `paypal` | Payment handles shown on the site and in the registration email. | none |
| `verifier` | Name of the person who confirms payments, shown on the site. | none |
| `photosEnabled` | `Yes` allows photo uploads (also the optional photos on tributes, veterans, directory, marketplace). | treated as No |
| `photoFolderId` | Drive folder id for uploads. Filled in by `setup()`. | created on first setup |
| `mailFrom` | Brevo sender address. Must be a verified sender on the domain. | `committee@lewisfamilyroots.com` |
| `mailFromName` | Display name on every email. | `Lewis Family Reunion 2027` |
| `mailReplyTo` | Reply-To address. Blank means use `email`. | blank |
| `notifyCommittee` | `Yes` sends `committeeEmail_` to `email` on each new registration. | `No` |

The last four come from `CONFIG_DEFAULTS`. `config_()` fills them in when the row is missing or blank, and `ensureConfigKeys_()` (run by `setup`) appends the rows so the committee can see them.

## Script Properties

Apps Script editor, Project Settings, Script Properties:

- `BREVO_API_KEY`: the Brevo transactional API key. Without it, `brevoSend_` reports a config error and mail falls through to MailApp.

This is the only secret. It is never in the repo, never in `config.js`, never logged. The repo is public; `git grep -iE 'xkeysib-[0-9a-f]'` must return nothing.

## Request flow

The site calls the `/exec` URL with `POST` and a JSON body: `{ action, code, ...payload }` (see `api()` in `app.js`, which sends `Content-Type: text/plain` to avoid a CORS preflight). `doPost` parses the body and hands it to `handle_`, which:

1. Reads Config.
2. Answers `info` without a code (public data: agenda, fees, deadline, room block, committee email).
3. Checks `code` against `familyCode` with `codeOk_`. A wrong code returns `{ ok:false, error:'code' }`.
4. Dispatches on `action`: `family`, `tree`, `mine`, `register`, `report`, `post`, `resend`. Writers run inside `locked_` (a script lock, 20 s wait).

`GET` serves only `?action=info` and `?action=signup` (the link-mode sign-up used by the embedded Claude page). Everything else by GET gets `error:'method'`. Every answer is JSON `{ ok, ... }`; errors carry `error` and a plain `message` for the screen.

## Security model

- The family code travels only in the POST body, never in a URL the server sees, and is never logged or echoed. The site strips `?c=` and `?t=` from the address bar on load (`readLink`) and keeps them in localStorage (`lr-code`, `lr-token`).
- Each household has a 32-hex registration token (`newToken_`). Only its SHA-256 hash is stored (`Token hash`). `findByToken_` hashes the typed or linked token and compares; it accepts 32 characters or more, so older 64-character tokens still match.
- The private link is `siteUrl?c=<familyCode>&t=<token>#me`. Anyone with the link or both codes can edit that household, so emails say to keep them private.
- `resend` always answers the same generic message and is rate-limited per email for 10 minutes, so it cannot be used to probe who is registered.
- Public without a code: dates, agenda, hotel, FAQ, fees. Family code: tree, roll call, stories, photos, marketplace, registration form. Token: that household's contact details, attendees and payments.
- Photos: the Drive folder is private (cannot be listed); each visible photo is "anyone with the link"; hidden photos are made private by `onEntriesEdit`. Uploads are checked by bytes (`sniffImage_`), capped at `PHOTO_MAX_BYTES`, and rate-limited site-wide (`PHOTO_UPLOADS_PER_HOUR`).
- `handle_` logs only the error, never the request body, because the body carries the code and the photo.

## Email flow

One door: `sendMail_(msg, cfg)`. `msg = { to, toName, subject, html, text, key, kind, householdId }`. It never throws and returns `{ ok, via, error }`.

1. If `key` was seen in the script cache in the last 6 hours, return `via:'dupe'` and send nothing.
2. `brevoSend_`: POST to `https://api.brevo.com/v3/smtp/email` with the `api-key` header from `BREVO_API_KEY`. 201 is success. 401/403 = key problem (`config`), 402/429 = quota, other 4xx = permanent (bad address), 5xx or network = retry.
3. On any Brevo failure, `mailAppSend_` through MailApp if `getRemainingDailyQuota() > MAIL_RESERVE` (5).
4. Otherwise `enqueue_`: a MailQueue row with Status `Queued` and the reason in `Last error`.
5. Every direct success is also logged as a MailQueue row with Status `Sent` (`logMail_`), so MailQueue is the full mail log.

`drainMailQueue()` runs hourly (installable time trigger) and from the menu "Send queued mail now". Under `locked_` it sends Queued rows oldest first, at most 100 per run and 4.5 minutes, Brevo until a quota or key error closes it for the run, then MailApp within today's quota. Permanent errors or 20 attempts mark the row Failed. Nothing is deleted.

Who sends what:
- `register_` (new household) calls `sendLink_` with the fresh token, then `committeeEmail_` if `notifyCommittee` is Yes. Both inside try/catch; the row is written and `recompute_` has run before any mail.
- `register_` (duplicate email) and `resend_` call `sendLink_(row, cfg, true)`, which rotates the token (older links stop working) and emails a fresh link. Both inside try/catch.
- `sendLink_` sends `sendReceipt_` (kind `receipt0`, no link, no token change) when `siteLive` is not Yes.
- `onPaymentsEdit` (installable on-edit trigger) calls `paymentReceipts_` when a Payments Status cell changes to `Confirmed` or `Not received`. It skips rows whose `Receipt sent` already starts with that Status, sends `receiptEmail_`, and writes `Receipt sent`. The `receipt:<Payment ID>:<Status>` key is the second guard.

Which emails carry the registration token: only `linkEmail_` (new registration, duplicate, lost link), because that is the moment a plaintext token exists. Receipts carry the family code and `siteUrl?c=<code>#me` but no token: only the hash is stored, and rotating it would log the cousin's phone out.

## Triggers and menu items

Installed by `setup()` through `installTriggers_` and `ensureTrigger_` (one per handler, never duplicated):
- `onEntriesEdit`: on edit, photo privacy sync.
- `onPaymentsEdit`: on edit, payment receipt emails.
- `drainMailQueue`: time-based, every hour.

The simple `onEdit(e)` (no install needed) stamps `Confirmed on` and `Confirmed by` on Payments and runs `recompute_` after Payments, Config or Registrations edits. It cannot call the network, which is why receipts need the installable trigger.

The **Reunion** menu (`onOpen`): "Refresh balances and status" (`recompute_`), "Send queued mail now" (`drainMailQueue`), "Send me a test email" (`testSendMail`), "Sync photo privacy" (`syncPhotoSharing`), "Run setup" (`setup`).

## How to change the backend

1. Edit `apps-script/Code.gs` in the repo. Run `node --check apps-script/Code.gs` for syntax (Apps Script is V8 JavaScript; the globals will be unknown to Node but the syntax check still works).
2. In the Sheet: Extensions, Apps Script. Select all, paste the new file, Save.
3. If the change needs new Google permissions (a new service, a new trigger, external requests), run `setup` from the function menu and approve the prompt. `setup` is idempotent.
4. Deploy, **Manage deployments**, pencil icon, Version: **New version**, Deploy. Never "New deployment": that makes a new `/exec` URL and breaks `config.js`.
5. Check Executions in the editor if anything misbehaves.

## How to change the site

Commit to `main`. GitHub Pages redeploys in about a minute. Tell testers to close the tab and reopen the family link, since the browser caches `app.js`.

## Conventions

- Private helpers end in `_` and are not callable from the function menu or as triggers. Public names (`setup`, `drainMailQueue`, `testSendMail`, `onEdit`, trigger handlers) have no underscore.
- Never log a request body or a token. Log the error only.
- Pass every user string through `clean_` before writing it to the Sheet: it trims, caps length and prefixes `'` to anything that would be read as a formula.
- `PHOTO_MAX_BYTES` in `Code.gs` and `PHOTO.maxUpload` in `app.js` must stay equal (6 MB).
- Wording in email and on the site must match: "Family code", "Registration code", "My Registration", "Email my link".
- Plain English, short sentences, no emojis anywhere in code, docs or email.
- No secrets in the repo. The Brevo key lives only in Script Properties.
- Keep `sendMail_` as the only path to Brevo or MailApp. The only `MailApp.sendEmail` call is in `mailAppSend_`.
- Everything that writes a tab runs inside `locked_`.

## Testing

- Syntax: `node --check app.js` and `node --check apps-script/Code.gs`.
- Browser smoke: Playwright against `index.html` served locally, with `page.route()` stubbing the `/exec` URL so no real backend is touched. Typical stub: answer `info` with fees, `family` with `{ ok:true, branches:[], names:[], roll:[], entries:[], pay:{} }`, `mine` with a household or `{ ok:false, error:'token' }`. Use it to exercise the code-entry form on `#me`, the gates and the registration success panel.
- Operator tests in the Apps Script editor: `testSendMail()` (full chain to the deployer's own address, logs the route), `testSendMail('mailapp')` (skips Brevo), `testEnqueue()` (forces a MailQueue row, then drains it). See `docs/EMAIL.md`.
- Hands-on checks for volunteers: `TESTING.md`.
- Secret scan before pushing: `git grep -iE 'xkeysib-[0-9a-f]'` must be empty.

## Open missions

- **Committee Updates.** A tab for broadcast emails to every registered household, gated by an Approved tick. Designed in `docs/EMAIL.md` under "Future: Committee Updates". Not built.
- **Supabase auth and an admin page.** Later. The minimum access when that mission starts: a free Supabase project created by the committee; project URL and anon key (public, repo-safe); the service role key only in Script Properties, entered by the committee; a Google OAuth client ID and secret from Google Cloud Console; Brevo SMTP login as Supabase custom SMTP; a weekly keep-alive ping so the free project does not pause. No Supabase access is needed for anything described in this file.
- **Cloudflare Pages hosting** instead of GitHub Pages. Optional; DNS is already on Cloudflare.
