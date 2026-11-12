# AGENTS.md: orientation for anyone working on this repo

## Purpose and audience

This file is for an AI agent or a committee volunteer who opens this repo cold. It says how the Lewis Family Reunion 2027 site is built, where the data lives, what the backend expects, and how to change things without breaking them. Read it before touching `app.js`, `index.html` or `apps-script/Code.gs`. The email runbook, including Committee Updates, is in `docs/EMAIL.md`. Hands-on test scripts are in `TESTING.md`. The committee-facing summary is `README.md`.

## Architecture

- **Website.** Static HTML, CSS and JavaScript in this repo, served by GitHub Pages at `https://lewisfamilyroots.com` (the `CNAME` file holds the domain). DNS for the domain is on Cloudflare. The old `alexcentered.github.io/lewis-reunion-2027` address redirects to the custom domain.
- **Backend.** One Google Apps Script project, `apps-script/Code.gs`, bound to the committee's Google Sheet named "Lewis Reunion 2027 — Site Data". It is deployed as a web app with **Execute as: Me** and **Who has access: Anyone**. The site calls its `/exec` URL.
- **Glue.** `config.js` holds only that `/exec` URL, the `photosEnabled` switch and the `sections` list (which tabs are live during the phased rollout). Nothing else in the repo points at Google.
- **Email.** Sent by the backend through the Brevo API from `committee@lewisfamilyroots.com`, with the deployer's Gmail (MailApp) as a fallback and a MailQueue tab in the Sheet as the last resort. Replies to `committee@` and mail to `info@` are forwarded by Cloudflare Email Routing to `lewisfamilyreunion2027@gmail.com`.
- **No family data in the repo.** The repo is public. Names, registrations, payments and photos live only in the Sheet and a private Drive folder.

## Repo map

| File | What it is |
|---|---|
| `index.html` | The whole site in one page: markup, CSS, and section containers. Sections switch on the URL hash (`#me`, `#register`, and so on). |
| `app.js` | Site logic: reads `?c=` and `?t=` from the link, talks to the backend, renders every section, the registration form, My Registration, the code-entry form, photo upload. |
| `tree-engine.js`, `tree.js` | The interactive family tree (layout engine and page glue). Fed by the People and Tree notes tabs. |
| `config.js` | `window.LR = { apiUrl, photosEnabled, sections, registerLines }`. The only file that changes when the backend URL changes. `sections` lists the live tabs (`home`, `reunion`, `register`, `family`, `photos`, `market`, `me`); a tab not listed has its nav link, section and Home tile hidden by `applySections()` in `app.js`, and its hash falls back to `#home`. Home is always live. Delete the key to show everything. `registerLines` lists the founding lines the Register branch dropdown offers (`['Lewis']` for phase 1); the Our Family line cards always show every Branches row; with one line offered the "Both lines" option is left out; delete the key to offer every line. |
| `apps-script/Code.gs` | The backend. Pasted by hand into the Apps Script editor. Not deployed by git. |
| `CNAME`, `.nojekyll` | GitHub Pages settings: custom domain, and "serve files as they are". |
| `README.md` | Overview and committee guide. |
| `TESTING.md` | Hands-on checklists (photos, email and codes). |
| `AGENTS.md` | This file. |
| `docs/EMAIL.md` | Email runbook: Brevo, DNS, routing, queue, troubleshooting, Committee Updates (how to send one, AI drafting). |

## Data model: the Sheet tabs

`Code.gs` reads headers by name, not by position (`headers_`, `rows_`, `rowAt_`, `writeRow_`). Columns may be reordered or added, but a renamed header breaks the code that uses it. Tab names are in the `TAB` constant.

**Registrations** (one row per household)
`Household ID`, `Registered`, `Updated`, `First`, `Middle`, `Last`, `Birth surname`, `Preferred`, `Email`, `Phone`, `City`, `State`, `Branch`, `Parents`, `Grandparent`, `Spouse`, `Adults`, `Children`, `Attendees` (one line per person: `name · Adult|Child · age · shirt · diet`; the fifth field is blank for "None" and absent on rows written before Nov 2026), `Shirt sizes`, `Days`, `Arrive`, `Depart`, `Nights`, `Lodging`, `Diet` (written by `register_` from the per-person choices as `Name: Vegan; Name: Gluten-free`, blank when nobody needs anything; the form no longer asks it per household), `Needs`, `Show on list`, `Token hash`, then five columns that `recompute_` writes as one block and so must sit side by side in this order: `Due`, `Confirmed`, `Awaiting`, `Balance`, `Status`. Then `Mail opt-out` (`REG_OPTOUT`, appended by `setup()`): `Yes` leaves the household out of committee updates only; link emails and receipts still go. The committee types it by hand when a household replies STOP.

**Payments** (one row per reported payment)
`Payment ID`, `Household ID`, `Household`, `Reported`, `Amount`, `Method`, `Date sent`, `Reference`, `Note`, `Status` (`Reported`, `Confirmed`, `Not received`), `Confirmed on`, `Confirmed by`, `Receipt sent`, `Received by`. `Receipt sent` is appended by `setup()` if missing and holds `<Status> · <ISO time> · <route>` once a receipt email has gone out. `Received by` (`PAY_RECEIVED_BY`, appended by `setup()`) names the committee member whose account or hand the money went to; `report_` fills it with `holderFor_` when exactly one Holders row lists the payment's Method, and the simple `onEdit` does the same for a hand-typed row left blank. `onEdit` (`fillPayments_`) also fills a blank `Household ID` when the typed `Household` matches exactly one registration by email, by Preferred-or-First + Last, or by First + Last (case and spaces ignored); otherwise it appends `Check: no single household matched` to `Note`.

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
`Status` is `Queued` (waiting), `Sending` (claimed by a running drain; `Last error` holds `claimed <ISO time>`), `Sent`, or `Failed` (20 attempts). A `Sending` row older than 15 minutes is reclaimed by the next drain. The committee retries a Failed row by typing `Queued` into Status (case and spaces do not matter). `Via` reads `Brevo <messageId>`, `MailApp`, `dupe` (the key was sent within 6 hours, so the row was marked Sent without sending), or stays blank while queued. `Kind` is one of `link`, `receipt0`, `receipt`, `committee`, `update`, `money`, `test`. Rows are written by header name, so columns may be reordered; `send_` writes `Status`, `Attempts`, `Last error`, `Sent`, `Via` as one block when they are adjacent.

**Updates** (created by `setup()` through `updatesSheet_`; one row per broadcast email). These 11 headers (`UPDATE_HEADERS`), then `Template`, appended by `templatesTab_` with a dropdown of Templates names:
`ID`, `Created`, `Subject`, `Notes`, `Draft`, `Approved`, `Audience`, `Sent at`, `Sent`, `Failed`, `Skipped`, `Template`.
`ID` is `U-` plus 8 uppercase hex characters, written by `claimUpdates_` when blank, as is `Created`. `Approved` is a checkbox (data validation on rows 2 to 200 when the tab is first created; `yes_` also accepts the text `Yes`). `Audience` is one of `UPDATE_AUDIENCES` (`all`, `unpaid`, `paid`, `test`, `everyone`, `contacts`, `unregistered`) or a Registrations Branch name, case-insensitive. `Sent at` is the idempotency gate: blank means unsent, `sending…` (`UPDATE_SENDING`) means in progress or interrupted and the next run resumes it, a date means done and the row is never sent again. The per-recipient MailQueue key `update:<ID>:<email>` is the record of who was queued; `updateKeys_` reads it before queueing so a resume never duplicates. `Sent`, `Failed`, `Skipped` are written back by `sendUpdates` as one block through `cells_` (adjacent columns are written in one call; otherwise cell by cell). `Failed` is blank on success, `In progress: N of M queued; the next run continues` when the 4-minute queueing budget (`UPDATE_QUEUE_MS`) ran out, `ERROR: ...; the next run retries` on an exception, or a text reason when nothing was queued (blank Draft, unknown audience, blank Config `email` for a test, an empty Contacts tab for `contacts` or `unregistered`, a `Template` name with no Templates row, a `{{field}}` that `MERGE_FIELDS` does not know, or a household-only field (`HOUSEHOLD_FIELDS`) with an audience that reaches Contacts; that row is finished, so fix it in a new row or clear `Sent at`). `Skipped` counts households and contacts dropped for `Mail opt-out` = Yes or a blank email. `Notes` is only read by `draftUpdate`.

**Contacts** (created by `setup()` through `ensureTab_`; `CONTACT_HEADERS`): `First`, `Last`, `Email`, `Branch`, `Notes`, `Mail opt-out`. Relatives the committee wants to reach before they register, typed or pasted by hand; the code only reads it. The Audiences in `CONTACT_AUDIENCES` use it: `everyone` (every registered household, then every Contacts row), `contacts` (the tab alone), `unregistered` (Contacts rows whose email is not on Registrations). A row with no First, Last or Email is ignored. Contacts rows reach `updateEmail_` as copies with `_contact: true`, which picks `CONTACT_FOOTER` and writes `CONTACT` as the MailQueue `Household ID`. `Branch` is a note for the committee; Branch audiences still match Registrations only.

**Templates** (created by `setup()` through `templatesTab_`, seeded from `TEMPLATE_SEED` when empty): `Name`, `Subject`, `Body`, `Notes`. A tab that already has rows but none named `Welcome from the committee` (`TPL_WELCOME`) gets `WELCOME_SEED` appended once; renaming that row stops `setup` from adding it again, deleting it does not.
- An Updates row whose `Template` names a row (case and spaces ignored) takes that row's `Subject` and `Body` for a blank `Subject` and `Draft`: at once in the cells, by the simple `onEdit` (`fillFromTemplate_`, never overwriting typed text or a sent row), and again at send time (`withTemplate_`) in case the cells were left blank.
- Merge fields, written `{{first name}}` (case and spaces ignored): `first name`, `last name`, `household id`, `total due`, `paid so far`, `balance`, `deadline` (as "April 30, 2027"), `ways to pay` (`payLine_`), `website`, `my registration` (`siteUrl#me`, no code), `family link` (`familyLink_`: `siteUrl?c=<familyCode>`, the website alone when either is blank). Defined in `MERGE_FIELDS`; amounts read "to be announced" until fees are set. `updateEmail_` fills them per household in the Subject (`mergeText_`) and in the HTML after `draftHtml_` (`mergeHtml_`: values escaped, the three link fields in `MERGE_LINKS` as links, except inside a tag, where a field such as `href="{{family link}}"` gets the bare escaped value so committee HTML buttons work). A Draft containing `<p` or `<br` is committee HTML used as written; `docs/templates/welcome.html` is the designed welcome, pasted into a Templates Body by hand (it is not seeded). An unknown field stops the row (`unknownFields_`), so no family ever gets a raw `{{...}}`. `HOUSEHOLD_FIELDS` (`household id`, `total due`, `paid so far`, `balance`, `my registration`) stop a row whose audience reaches Contacts (`householdFields_`), so a relative who has not registered is never told a balance. Updates carry no token, and carry the family code only when the committee puts `{{family link}}` in the Draft.
- The Audience `test` row and **Email me this draft** use a made-up household (`sampleRow_`: Cousin Lewis, `H-SAMPLE1`, two adults and a child, amounts from the Config fees).
- Two reserved rows word the registration email: `Registration: thank you` (`TPL_REG_THANKS`, its opening line, read by `regThanks_`) and `Registration: what happens next` (`TPL_REG_NEXT`, extra "What happens next" bullets, one per line, read by `regNext_`; a blank Body means none). A missing row, or a Body with an unknown field, falls back to the built-in wording (`REG_THANKS_DEFAULT`, `REG_NEXT_DEFAULT`). The Household ID, codes, link, fee and payment lines and the hotel stay in code.

**Dashboard** is a committee tab of plain spreadsheet formulas. The code never touches it.

**Money tabs** (created by `setup()` through `moneyTabs_`; the treasurer's tabs). Every dollar names the person holding it, because payments land in different committee members' own accounts.
- **Holders**: `Name`, `Methods` (comma list such as `Zelle, Cash App`; drives `holderFor_`), `Email`, `Notes`. One row per person who receives or spends reunion money. Its Name column feeds the dropdowns below.
- **Expenses**: `Date`, `What`, `Vendor`, `Category` (dropdown from Budget), `Amount`, `Status` (`Paid` or `Planned`; blank counts as Paid), `Paid by` (dropdown from Holders), `Receipt` (a Drive link), `Note`.
- **Transfers**: `Date`, `From`, `To`, `Amount`, `Note`. Money handed between holders, a deposit to a bank account (add the account as a Holders row), or paying someone back.
- **Budget**: `Category`, `Budget`, `Notes`. Seeded with `BUDGET_CATEGORIES` when the tab is empty.
- **Money**: written only by `moneySummary_`, which `recompute_` runs after `balances_` and `onEdit` runs after any Expenses, Transfers, Budget or Holders edit. It is cleared and rewritten each time, protected with a warning. Blocks: cash on hand; money in (expected, confirmed, waiting, not received, still owed, households paid in full / partly / nothing); who holds what (received + transfers in - transfers out - spent = holds now; below zero reads "Owed back", settled by a Transfer to that person); money out by category (budget, paid, planned, left); needs a look (payments still Reported after `MONEY_STALE_DAYS` = 3 days, paid expenses with no receipt link). A name that is not on Holders is marked `(not on Holders tab)`; money with no name is the `Not filled in` row. All numbers come from `moneyData_`, which the money report uses too.
- `setup` adds dropdowns (`dropdown_`, invalid values allowed with a warning) only where a column's first data cell has no validation yet: Payments `Status`, `Method` (`PAY_METHODS`, the same list as `#pMethod` in `index.html`), `Received by`; Expenses `Category`, `Status`, `Paid by`; Transfers `From`, `To`. A rule the committee set by hand is left alone.
- Everything is cell edits and dropdowns, so it works from the Google Sheets phone app, where custom menus do not appear.

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
| `roomBlock` | Hotel room-block note shown on the site under the group-rate codes, and in the registration email under the hotel. | none |
| `zelle`, `cashapp`, `venmo`, `paypal` | Payment handles shown on the site and in the registration email. | none |
| `verifier` | Name of the person who confirms payments, shown on the site. | none |
| `photosEnabled` | `Yes` allows photo uploads (also the optional photos on tributes, veterans, directory, marketplace). | treated as No |
| `photoFolderId` | Drive folder id for uploads. Filled in by `setup()`. | created on first setup |
| `mailFrom` | Brevo sender address. Must be a verified sender on the domain. | `committee@lewisfamilyroots.com` |
| `mailFromName` | Display name on every email. | `Lewis Family Reunion 2027` |
| `mailReplyTo` | Reply-To address. Blank means use `email`. | blank |
| `notifyCommittee` | `Yes` sends `committeeEmail_` to `email` on each new registration. | `No` |
| `treasurerEmail` | Gets the money report (`moneyReport`) every Monday morning. | blank: no report |

The last five come from `CONFIG_DEFAULTS`. `config_()` fills them in when the row is missing or blank, and `ensureConfigKeys_()` (run by `setup`) appends the rows so the committee can see them.

## Script Properties

Apps Script editor, Project Settings, Script Properties:

- `BREVO_API_KEY`: the Brevo transactional API key. Without it, `brevoSend_` reports a config error and mail falls through to MailApp.
- `ANTHROPIC_API_KEY`: optional. Read only by `draftUpdate` for the menu item "Draft update with AI". Without it, that menu item shows a dialog saying where to add the key; sending updates does not need it.

These are the only secrets. Neither is ever in the repo, in `config.js`, or logged. The repo is public; `git grep -iE 'xkeysib-[0-9a-f]'` and `git grep -E 'sk-ant-api[0-9]'` must return nothing.

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
- Committee updates go only to addresses the committee put in the Sheet (Registrations, or the Contacts tab), carry no token, and are gated by a checkbox a committee member ticks. They carry the family code only through `{{family link}}`, which the committee types on purpose (the welcome template uses it): that is the same link the committee already shares by hand, and changing `familyCode` retires it. Opt-out is a hand-set column on either tab, not a link, so there is no unsubscribe endpoint to abuse; an address marked on either tab is skipped by every audience.

## Email flow

One door: `sendMail_(msg, cfg)`. `msg = { to, toName, subject, html, text, key, kind, householdId }`. It never throws and returns `{ ok, via, error }`.

1. If `key` was seen in the script cache in the last 6 hours, return `via:'dupe'` and send nothing.
2. `brevoSend_`: POST to `https://api.brevo.com/v3/smtp/email` with the `api-key` header from `BREVO_API_KEY`. Any 2xx is success. 401/403 = key problem (`config`), 402/429 = quota; every other failure falls through to the next step.
3. On any Brevo failure, `mailAppSend_` through MailApp if `getRemainingDailyQuota() > MAIL_RESERVE` (5).
4. Otherwise `enqueue_`: a MailQueue row with Status `Queued` and the reason in `Last error`.
5. Every direct success is also logged as a MailQueue row with Status `Sent` (`logMail_`), so MailQueue is the full mail log.

`drainMailQueue()` runs hourly (installable time trigger) and from the menu "Send queued mail now". `claim_` runs under `locked_` only long enough to mark up to 100 Queued rows (oldest first) as `Sending`; `send_` then works outside the lock for at most 4.5 minutes so registrations are never blocked. Brevo is tried until a quota or key error closes it for the run (no attempt counted), then MailApp within today's quota; a row that cannot go out returns to `Queued` with one attempt added. 20 attempts mark the row Failed. Nothing is deleted.

Who sends what:
- `register_` (new household) calls `sendLink_` with the fresh token, then `committeeEmail_` if `notifyCommittee` is Yes. Both inside try/catch; the row is written and `recompute_` has run before any mail.
- `register_` (duplicate email) and `resend_` call `sendLink_(row, cfg, true)`, which rotates the token (older links stop working) and emails a fresh link. Both inside try/catch.
- `sendLink_` sends `sendReceipt_` (kind `receipt0`, no link, no token change, deduplicated per minute only) when `siteLive` is not Yes.
- `onPaymentsEdit` (installable on-edit trigger) calls `paymentReceipts_` when a Payments Status cell changes to `Confirmed` or `Not received`. It skips rows whose `Receipt sent` already starts with that Status, gives a hand-typed row a `Payment ID` if blank, sends `receiptEmail_`, and writes `Receipt sent`. The `receipt:<Payment ID>:<Status>` key is the second guard.

Both registration emails (`linkEmail_` and the pre-launch `sendReceipt_`, built by `receipt0Email_`) open with `regThanks_` and share one details block, `regDetails_`: Household ID, who is coming, days, travel dates and lodging; what happens next (fees and how to pay, or that fees are coming); and the reunion hotel with its group rate from the `HOTEL` constant. The hotel card in `index.html` holds the same name, address, phone, group code (501) and hotel code (FATNOHT): change both together. My Registration shows the Household ID under the totals, with "put it in the note when you pay".

Which emails carry the registration token: only `linkEmail_` (new registration, duplicate, lost link), because that is the moment a plaintext token exists. Receipts carry the family code and `siteUrl?c=<code>#me` but no token: only the hash is stored, and rotating it would log the cousin's phone out. Committee updates carry no token, and the family code only when the Draft uses `{{family link}}`.

**Committee updates** (`sendUpdates`, daily trigger at 9 and menu "Send approved updates now") take a different path: they never call `sendMail_` directly.
1. `claimUpdates_(onlyId)` runs under `locked_` only long enough to find Updates rows with `Approved` true and `Sent at` blank or `sending…` (resume), give each an `ID` and `Created` if blank, write `Sent at` = `sending…`, and `SpreadsheetApp.flush()` before releasing. With `onlyId` (used by `testUpdate`) it claims that row alone. An overlapping run finds the rows claimed and, because every queued recipient is recorded by key, cannot duplicate them. If the lock is busy the run logs and returns.
2. Outside the lock, per claimed row: `audience_(upd.Audience, regs, cfg, contacts)` picks Registrations rows (`all` = any row with an email; `unpaid` = `Balance` > 0; `paid` = `Status` is `Paid in full`; `test` = a synthetic row `{ 'Household ID':'COMMITTEE', Email: cfg.email, Preferred:'committee' }`; anything else = `Branch` equals the value, case-insensitive) or, for `everyone`, `contacts` and `unregistered`, Registrations and Contacts rows as described under Contacts. It drops blank emails, and any address with `Mail opt-out` = Yes on either tab, into `skipped`, and de-duplicates by lowercase email with registered households first. It returns `contacts: true` for those three audiences, which turns on the `HOUSEHOLD_FIELDS` check. `known` is false when the value is not a keyword and matched no Branch, which makes `Failed` read `No households matched audience "<value>"`.
3. For each recipient `enqueue_(updateEmail_(row, upd, cfg), 'update <ID>')` writes one MailQueue row with Status `Queued`, kind `update`, key `update:<ID>:<email>`, `Household ID`. `updateEmail_` builds `mailWrap_(greet_(draftHtml_(Draft), name) + footer)`: `draftHtml_` uses the Draft as is when it contains `<p` or `<br`, else splits on blank lines into escaped `<p>` with `<br>` for single newlines, and strips a trailing `SIGNOFF` line because `mailWrap_` adds it; `greet_` replaces a first line that is only a greeting (`Hi,`, `Hello,`, `Hey`, `Dear family,`, `Greetings,` and similar, up to 40 characters before the comma) with `Hi <Preferred or First or cousin>,` or prepends one. The footer is `UPDATE_FOOTER`, or `CONTACT_FOOTER` for a Contacts row (both say reply STOP).
4. Queueing stops after `UPDATE_QUEUE_MS` (4 minutes); the write-back then keeps `sending…` with an `In progress` note, otherwise `cells_` writes `Sent at` = now, `Sent` (recipients present in MailQueue), blank `Failed`, `Skipped`. `drainMailQueue(maxMs)` runs once only if more than 60 seconds of the 6-minute run (`RUN_MS`) remain, with the remaining time as its budget; the hourly drain carries the rest. `send_` checks the script cache per row and marks a hit Sent with Via `dupe`.
Delivery failures live in MailQueue, not in `Failed`. The `sendMail_` 6-hour key cache is the second guard against a duplicate.

## Triggers and menu items

Installed by `setup()` through `installTriggers_` and `ensureTrigger_` (one per handler, never duplicated):
- `onEntriesEdit`: on edit, photo privacy sync.
- `onPaymentsEdit`: on edit, payment receipt emails.
- `drainMailQueue`: time-based, every hour.
- `sendUpdates`: time-based, every day at hour 9 (`everyDays(1).atHour(9)`, in the script's time zone).
- `moneyReport`: time-based, Mondays at hour 8 (`onWeekDay(MONDAY).atHour(8)`). Emails `moneyEmail_` to Config `treasurerEmail` through `sendMail_`, kind `money`, key `money:<date>` (so at most one a day); does nothing but log when `treasurerEmail` is blank. The email names households and amounts and carries no codes.

The simple `onEdit(e)` (no install needed) stamps `Confirmed on` and `Confirmed by` on Payments, fills `Household ID` and `Received by` on hand-typed Payments rows (`fillPayments_`), fills a blank Subject and Draft on Updates from the chosen `Template` (`fillFromTemplate_`), runs `recompute_` after Payments, Config or Registrations edits, and `moneySummary_` after Expenses, Transfers, Budget or Holders edits. It cannot call the network, which is why receipts need the installable trigger.

The **Reunion** menu (`onOpen`), in this order: "Refresh balances and status" (`recompute_`), "Send queued mail now" (`drainMailQueue`), "Send me a test email" (`testSendMail`), "Send approved updates now" (`sendUpdates`), "Send the money report now" (`moneyReportNow`: the same email, sent even if one went out today), "Draft update with AI" (`draftUpdate`), "Email me this draft" (`emailMeDraft`: the clicked Updates or Templates row, filled in for `sampleRow_`, to the person clicking, subject `[Draft] ...`, kind `test`; a registration template row sends the registration email instead), "Sync photo privacy" (`syncPhotoSharing`), "Run setup" (`setup`).

## Claude API call

`draftUpdate` (menu "Draft update with AI") picks the first Updates row whose `Notes` is non-blank and whose `Draft` is blank or exactly `redo`. With no `ANTHROPIC_API_KEY` it calls `alert_` (a dialog from the menu, a log line from the editor) and stops. Otherwise `claudeDraft_(key, updatePrompt_(), updateContext_(row, cfg))` makes one `UrlFetchApp.fetch` to `CLAUDE_URL` = `https://api.anthropic.com/v1/messages`:

- method `post`, `contentType: 'application/json'`, `muteHttpExceptions: true`
- headers `x-api-key: <key>`, `anthropic-version: 2026-10-21`, `anthropic-beta: server-side-fallback-2026-07-01`
- body `{ model: 'claude-opus-5-5' (CLAUDE_MODEL), max_tokens: 16000, fallbacks: 'default', system: <updatePrompt_>, messages: [{ role: 'user', content: <updateContext_> }] }`. No thinking, temperature or tools are sent.

`updatePrompt_` sets the voice (warm committee cousin, plain English, no emojis, no subject, no greeting because `greet_` adds it, invent nothing, end with `SIGNOFF`, plain text with blank lines between paragraphs). `updateContext_` passes the Subject, the Notes, and facts from Config: dates and city, fees and `childAge` when both fees are numbers, `deadline`, `payLine_`, `siteBase_`.

The result written into `Draft` is the joined `text` blocks, or a line starting `ERROR:` for: a thrown fetch (`ERROR: <message>`), a non-2xx status (`ERROR: HTTP <status> <first 200 chars>`), a body that is not JSON, `stop_reason === 'refusal'` (`ERROR: the AI declined to draft this one. <stop_details.explanation>`), or no text blocks. `Approved` is set to false either way. The key and the request body are never logged; the log line holds the row number and the character count or the first 200 characters of the error. There is no SDK in Apps Script, so this is the only place that speaks to Anthropic.

## How to change the backend

1. Edit `apps-script/Code.gs` in the repo. Check syntax with `node --check - < apps-script/Code.gs` (Apps Script is V8 JavaScript; the globals will be unknown to Node but the syntax check still works). Node 22 and later refuse `node --check apps-script/Code.gs` because of the `.gs` extension; reading from stdin avoids that.
2. In the Sheet: Extensions, Apps Script. Select all, paste the new file, Save.
3. If the change needs new Google permissions (a new service, a new trigger, external requests), run `setup` from the function menu and approve the prompt. `setup` is idempotent.
4. Deploy, **Manage deployments**, pencil icon, Version: **New version**, Deploy. Never "New deployment": that makes a new `/exec` URL and breaks `config.js`.
5. Check Executions in the editor if anything misbehaves.

## How to change the site

Commit to `main`. GitHub Pages redeploys in about a minute. The four `<script src>` tags at the end of `index.html` carry a `?v=YYYYMMDD` query so phones fetch fresh copies: bump it to the day's date whenever `app.js`, `tree.js`, `tree-engine.js` or `config.js` changes (an `index.html`-only change needs no bump, because the page itself is not cached long).

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

- Syntax: `node --check app.js` and `node --check - < apps-script/Code.gs`.
- Browser smoke: Playwright against `index.html` served locally, with `page.route()` stubbing the `/exec` URL so no real backend is touched. Typical stub: answer `info` with fees, `family` with `{ ok:true, branches:[], names:[], roll:[], entries:[], pay:{} }`, `mine` with a household or `{ ok:false, error:'token' }`. Use it to exercise the code-entry form on `#me`, the gates and the registration success panel.
- Operator tests in the Apps Script editor: `testSendMail()` (full chain to the deployer's own address, logs the route), `testSendMail('mailapp')` (skips Brevo), `testEnqueue()` (forces a MailQueue row, then drains it), `testUpdate()` (appends an Updates row with ID `U-TEST-…`, Subject `Test update`, Audience `test` and Approved ticked, runs `sendUpdates(thatId)` so no other approved row is touched, logs the last MailQueue row; the email goes to Config `email`). See `docs/EMAIL.md`.
- Node simulation of the backend: a scratch harness (`sim2.js` in the agent's scratchpad, not committed) stubs `SpreadsheetApp`, `UrlFetchApp`, `LockService`, `CacheService`, `PropertiesService`, `MailApp` and `Utilities`, loads `Code.gs` with `eval` after turning its top-level `const` and `function` declarations into globals, and asserts: Updates tab creation with the checkbox validation; `ensureTab_` appending `Mail opt-out`; `audience_` for each keyword, a Branch, opt-out, blank email and de-dup; `draftHtml_` and `greet_`; `updateEmail_` key and kind; `sendUpdates` end to end for `all`, `paid`, a Branch, `test`, an unknown audience and a blank Draft; the second run sending nothing; a filled `Sent at` being skipped; `Approved` as the text `Yes`; `testUpdate()`; `draftUpdate` success, each `ERROR:` path (HTTP 401, refusal, non-JSON, no key), `redo`, and the no-fees context; `installTriggers_` asking for `sendUpdates` daily; the `onOpen` menu labels. For Contacts: `everyone`, `contacts` and `unregistered` with a registered household winning over its Contacts row, an opt-out on either tab stopping the address everywhere, blank emails and empty rows skipped; `{{family link}}` encoded and linked; `CONTACT_FOOTER` and Household ID `CONTACT`; the `HOUSEHOLD_FIELDS` stop; no Contacts tab at all; and the welcome row added once to a Templates tab that already has rows. Rebuild it from that list when the backend changes; it is the only way to run the Sheet code outside Google.
- Hands-on checks for volunteers: `TESTING.md`.
- Secret scan before pushing: `git grep -iE 'xkeysib-[0-9a-f]'` must be empty.

## Open missions

- **Supabase auth and an admin page.** Later. The minimum access when that mission starts: a free Supabase project created by the committee; project URL and anon key (public, repo-safe); the service role key only in Script Properties, entered by the committee; a Google OAuth client ID and secret from Google Cloud Console; Brevo SMTP login as Supabase custom SMTP; a weekly keep-alive ping so the free project does not pause. No Supabase access is needed for anything described in this file.
- **Cloudflare Pages hosting** instead of GitHub Pages. Optional; DNS is already on Cloudflare.
