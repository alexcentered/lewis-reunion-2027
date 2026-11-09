# Email runbook

How the reunion site sends email, how it was set up, what each email says, and what to do when something goes wrong. Written for a committee volunteer or an agent who has not seen the setup conversation. The code is in `apps-script/Code.gs`, sections "mail" (`sendMail_`), "committee updates" (`sendUpdates`, `draftUpdate`) and "email templates".

## Overview and daily limits

Every email goes through one function, `sendMail_`. It tries three routes in order:

1. **Brevo** (API, sender `committee@lewisfamilyroots.com`). Free plan: about **300 emails a day**. Best deliverability, proper domain branding.
2. **MailApp** (the Gmail account of whoever deployed the script). Consumer Gmail: about **100 recipients a day**. Used when Brevo has no key, refuses the key, or is out of quota. The script keeps 5 sends in reserve (`MAIL_RESERVE`).
3. **MailQueue** tab in the Sheet. Catches the overflow. `drainMailQueue()` runs every hour and sends what it can, Brevo first.

Every email, sent or waiting, is one row in **MailQueue**. That tab is the full mail log.

A reunion of a few hundred households will not come near these limits on an ordinary day. The queue exists for the launch day and for committee updates, which are queued rather than sent directly (see "Committee Updates: how to send one").

## One-time setup done in Phase 1

This was done once through the Brevo and Cloudflare APIs. Record the exact values here when they are known; until then the placeholders stand.

**Brevo**
- Account login: `lewisfamilyreunion2027@gmail.com`.
- Domain `lewisfamilyroots.com` added under Senders & IP, Domains, and authenticated.
- Sender `committee@lewisfamilyroots.com` added under Senders and verified.
- API key named `reunion-apps-script` (SMTP & API, API Keys). The value lives only in Apps Script Script Properties. Never paste it into the repo, a chat, or this file.

**Cloudflare DNS for `lewisfamilyroots.com`**

| Type | Name | Value | Purpose |
|---|---|---|---|
| TXT | `@` | `brevo-code:171a641c6aeb75337da8aa9764bf4ebf` | Brevo domain ownership |
| CNAME (DKIM) | `brevo1._domainkey` | `b1.lewisfamilyroots-com.dkim.brevo.com` (DNS only, not proxied) | Brevo signs outgoing mail |
| CNAME (DKIM) | `brevo2._domainkey` | `b2.lewisfamilyroots-com.dkim.brevo.com` (DNS only, not proxied) | Brevo signs outgoing mail |
| TXT (SPF) | `@` | `v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all` | One SPF record only, covering both Cloudflare Email Routing and Brevo |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | One DMARC record only. `p=none` monitors; tighten to `quarantine` later if reports look clean |
| MX | `@` | `route1.mx.cloudflare.net` (13), `route2.mx.cloudflare.net` (11), `route3.mx.cloudflare.net` (6) | Cloudflare Email Routing inbound, added by "Add missing records" |
| TXT (DKIM) | `cf2024-1._domainkey` | Cloudflare's own key, added with the MX records | Cloudflare Email Routing; does not conflict with Brevo's two |

Rules: there must be exactly one SPF record and exactly one DMARC record on the domain. If a second one appears, merge them. The GitHub Pages `A`/`CNAME` records for the website are separate and must not be touched.

**Cloudflare Email Routing**
- Destination address `lewisfamilyreunion2027@gmail.com` (verified by clicking the link Cloudflare emailed).
- Rule: `committee@lewisfamilyroots.com` forwards to the destination.
- Rule: `info@lewisfamilyroots.com` forwards to the destination.
- Catch-all: drop. Decide later if the committee wants everything else forwarded too.

## Apps Script side

1. Apps Script editor, Project Settings (gear icon), Script Properties, Add script property: name `BREVO_API_KEY`, value = the Brevo key. Save. Optional, for "Draft update with AI": a second property `ANTHROPIC_API_KEY` (see "AI drafting" below).
2. Config tab in the Sheet. `setup` adds these rows with defaults if they are missing:
   - `mailFrom`: `committee@lewisfamilyroots.com` (must match the verified Brevo sender)
   - `mailFromName`: `Lewis Family Reunion 2027`
   - `mailReplyTo`: blank means replies go to the `email` row
   - `notifyCommittee`: `Yes` to get an email on each new registration, `No` for quiet
   Also check: `email` = `committee@lewisfamilyroots.com`, `siteUrl` = `https://lewisfamilyroots.com`, `siteLive` = `Yes` once registration opens.
3. Run `setup` from the function menu. It creates MailQueue and Updates, appends `Receipt sent` to Payments and `Mail opt-out` to Registrations, installs the hourly `drainMailQueue` trigger, the daily `sendUpdates` trigger and the `onPaymentsEdit` trigger, and logs whether `BREVO_API_KEY` and `ANTHROPIC_API_KEY` are set and how many MailApp sends are left today. Approve the new permissions (external requests, triggers).
4. Deploy, Manage deployments, pencil, New version, Deploy. Never "New deployment".

## What each email contains

All emails share the frame in `mailWrap_`: Georgia body, the sign-off "Somehow, some way, your foundation is Lewis — and you belong here.", and the committee address from Config `email`. Each has an HTML part and a real plain-text part (`htmlToText_`).

**Registration link email** (`linkEmail_`, kind `link`)
Subject: `You are registered: Lewis Family Reunion 2027` on first registration, or `Your Lewis Reunion registration link` when it is a fresh link (duplicate registration, lost link).
Contains: a button "Open my registration" to `siteUrl?c=<familyCode>&t=<token>#me`; a grey box with the same link spelled out, the website address, **Family code**, **Registration code** (32 characters in groups of 4), and "If the link does not open, go to the website, open My Registration, and type the family code and the registration code"; then the shared details block (`regDetails_`, below); a reminder that anyone with the link or codes can change the registration; and "Questions? Reply to this email. It reaches the committee."
When sent as a fresh link, the first line says older links and codes no longer work, because the token was rotated.

**Lost link** is the same email with `rotate = true`, sent by `resend_` from the "Email my link" button. The site always answers "If that email is registered, a new private link is on its way", whether or not the address was found, and ignores repeat requests for 10 minutes.

**Pre-launch receipt** (`sendReceipt_`, kind `receipt0`)
Sent instead of the link email while Config `siteLive` is not `Yes`. Subject: `You are registered: Lewis Family Reunion 2027`. Carries the same details block (`regDetails_`) and says to reply to this email to change anything or ask a question. No link, no codes, and the token is left alone.

**The details block** (`regDetails_(row, cfg, live)`, in both registration emails)
- **Your registration:** Household ID, who is coming (with dietary needs), days, arrive and leave dates, where they are staying.
- **What happens next:** before fees are set, "Registration fees will be announced soon" and "keep your household ID". Once `feeAdult` and `feeChild` are numbers: the estimated total and deadline (`dueLine_`), the ways to pay (`payLine_`), how to report the payment (My Registration when `live`, otherwise reply with amount, method and date), "put your household ID in the payment note", and that the committee confirms each payment with a receipt. Always: updates about the schedule and venues will follow by email.
- **Reunion hotel:** name, address, phone, and the group rate (group code 501, hotel code FATNOHT) from the `HOTEL` constant, then Config `roomBlock` if it is set. The hotel card in `index.html` shows the same facts; change both together.

**Payment receipt** (`receiptEmail_`, kind `receipt`)
Sent once when a Payments row is set to `Confirmed` or `Not received`. Subject: `Payment confirmed: Lewis Family Reunion 2027` or `We have not found your payment yet: Lewis Family Reunion 2027`. Contains: amount, method, date sent, reference; confirmed so far; remaining balance or "Fees to be announced"; a button to `siteUrl?c=<familyCode>#me`; the Family code; and "use the private link from your registration email, or choose Email my link on the My Registration page". It never carries the Registration code: only its hash is stored, and making a new one would log the cousin's phone out.

**Committee notification** (`committeeEmail_`, kind `committee`)
Sent to Config `email` on each new registration when `notifyCommittee` is `Yes`. Subject: `New registration: <Preferred or First> <Last>`. Lists household and ID, branch, adults, children, days, city and state, email, phone.

**Committee update** (`updateEmail_`, kind `update`)
One per household when an Updates row is approved and sent. Subject: the row's `Subject` (or `An update from the Lewis Family Reunion committee` if blank). Contains: `Hi <Preferred or First>,` (or `Hi cousin,`), the `Draft` as paragraphs, and the footer "You are getting this because your household is registered for the Lewis Family Reunion. To stop these updates, reply with the word STOP." No link and no codes. Always queued, never sent directly. Key `update:<ID>:<email>`. See "Committee Updates: how to send one".

## MailQueue tab: how-to for the committee

Columns: `Queued` (when the row was written), `To`, `Subject`, `Html`, `Text`, `Status`, `Attempts`, `Last error`, `Sent`, `Via`, `Key`, `Kind`, `Household ID`.

| Status | Meaning |
|---|---|
| `Sent` | Went out. `Via` says how: `Brevo <id>` or `MailApp`. `dupe` means the same email had already gone out in the last 6 hours, so it was not sent twice. `Sent` has the time. |
| `Queued` | Waiting. `Last error` says why it did not go straight out. The hourly job will try again. |
| `Sending` | A run is working on it right now. If it stays `Sending` for more than 15 minutes, the next run picks it up again. |
| `Failed` | Given up after 20 tries. Nothing is deleted. |

To retry a Failed row: type `Queued` into its Status cell. To send waiting mail right now instead of waiting for the hour: Sheet menu **Reunion**, **Send queued mail now**. The log at the end of a run says how many were sent, failed, and are still queued.

Do not edit `Key`. It stops the same email going twice.

Leave old rows in place. They are the record of what was sent to whom. If the tab gets very long, move old `Sent` rows to an archive tab by hand.

## Operator tests

Run from the Apps Script editor (function menu, then Run) and read the Execution log. Each sends to the address of the person running it.

| Test | What it does | Expect |
|---|---|---|
| `testSendMail()` (also menu **Reunion**, **Send me a test email**) | Sends a sample registration email through the full chain. | Log says `sent via Brevo <id>` when the key works, otherwise `sent via MailApp` with the Brevo reason in brackets. The email arrives with subject `[Test] You are registered: Lewis Family Reunion 2027`. Its link leads nowhere on purpose. One `Sent` row in MailQueue, Kind `test`. |
| `testSendMail('mailapp')` | Same, but skips Brevo. | `sent via MailApp`. The email comes from the deployer's Gmail with the Config sender name. |
| `testEnqueue()` | Skips both routes so one row is forced into MailQueue, then runs `drainMailQueue()`. | Log shows `Before drain: ... row status Queued` and `After drain: Sent via Brevo <id>` (or `MailApp`). Subject `[Test] Queued mail: Lewis Family Reunion 2027`. |

To type an argument in the editor, call it from a one-line wrapper or the editor's console; the function menu runs functions without arguments.

## Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| No email arrived | Check MailQueue first. No row: the action never reached the mail code (look at Executions). Row `Sent`: check spam, then Brevo's Transactional log. Row `Queued`: read `Last error`. | Run **Send queued mail now**. Fix what `Last error` says. |
| `Last error` says `Brevo 401` or `403` | Key missing, wrong, or revoked. | Check Script Properties `BREVO_API_KEY`. Make a new key in Brevo if needed (see Rotating the key). Mail is already falling back to MailApp meanwhile. |
| `Last error` says `Brevo 402` or `429` | Daily quota used or plan limit. | Nothing to fix. MailApp takes over within its quota; the rest waits in the queue and goes the next day. |
| Brevo account "under review" | New accounts can wait a few hours before sending is allowed. | Wait. MailApp covers the gap. |
| Landed in spam | SPF, DKIM or DMARC not right, or the Brevo domain is not authenticated. | In Cloudflare, confirm one SPF record with both includes, the two brevo1/brevo2 DKIM CNAMEs, and one DMARC record. In Brevo, confirm the domain shows as authenticated. Ask the tester to mark "Not spam". |
| MailQueue growing with `Queued` rows | Both routes closed, or the hourly trigger is missing. | Editor, Triggers (clock icon): `drainMailQueue` should be listed. If not, run `setup`. Then run **Send queued mail now** and read the log. |
| Receipt sent twice | `Receipt sent` cell was cleared by hand, or two different payment rows. | Do not clear `Receipt sent`. Each Payments row sends at most one email per Status. |
| An update was not sent, or was sent twice | See "Troubleshooting updates" under Committee Updates. | |
| Receipt never sent | `onPaymentsEdit` trigger missing, or the household row has no email, or `Receipt sent` already starts with that Status. | Check Triggers; run `setup` if missing. Check Executions for `Payment receipts:` warnings. |
| Replies to committee@ or mail to info@ not arriving | Cloudflare Email Routing rule missing or destination unverified. | Cloudflare dashboard, Email, Email Routing: both rules Active, destination Verified, routing Enabled. |
| `MailApp daily quota used up` | The deployer's Gmail hit 100 for the day. | Wait for the next day, or fix Brevo so MailApp is not needed. |

## Rotating the Brevo key

1. Brevo, SMTP & API, API Keys: create a new key (name it with the date). Copy it; it is shown once.
2. Apps Script, Project Settings, Script Properties: replace the value of `BREVO_API_KEY`. Save. No redeploy is needed; the next send reads the new value.
3. Run `testSendMail()` and confirm `sent via Brevo`.
4. Back in Brevo, delete the old key.
5. If the old key may have leaked, do steps 1 and 2 first and the deletion within minutes.

## Acceptance checklist (Phase 6)

- [ ] Register a test household. The email arrives from `committee@lewisfamilyroots.com` and lands in the inbox on Gmail, Yahoo and iCloud.
- [ ] The button in the email opens My Registration (`#me`) with the household loaded.
- [ ] In a fresh private window with no link, typing the Family code and Registration code on My Registration opens the household.
- [ ] Reply to the email. It arrives in `lewisfamilyreunion2027@gmail.com`. Send a message to `info@lewisfamilyroots.com`. It arrives too.
- [ ] Temporarily blank `BREVO_API_KEY`. Register another test household. The registration saves; MailQueue shows `Via = MailApp` (or a `Queued` row if the Gmail quota is gone). Restore the key. **Send queued mail now** sends anything left.
- [ ] Mark a test payment `Confirmed`. One receipt arrives; `Receipt sent` is filled. Edit the same row again. No second email.
- [ ] Register with the same email again. A fresh-link email arrives and the site says the email is already registered. No server error.
- [ ] `git grep -iE 'xkeysib-[0-9a-f]'` in the repo returns nothing.

## Committee Updates: how to send one

A committee update is one email to every registered household (or to a slice of them). It is written in the **Updates** tab of the Sheet and sent by the script, through the same MailQueue as every other email. Nothing goes out until a person ticks **Approved**. The code is in `apps-script/Code.gs`, section "committee updates" (`sendUpdates`, `draftUpdate`).

### The steps

1. **Open the Updates tab** and start a new row. Leave `ID`, `Created`, `Sent at`, `Sent`, `Failed` and `Skipped` blank; the script fills them.
2. **Write the Subject.** This is the email subject line, for example `Fees are set: $120 per adult`.
3. **Write the body.** Two ways:
   - Type the email yourself into `Draft`. Plain paragraphs separated by a blank line are fine; simple HTML (`<p>`, `<br>`, `<b>`, `<a>`) also works. Start with a greeting line such as `Hi,`, `Hello,`, `Hi everyone,` or `Dear family,` and the script will put each household's name in (`Hi Denise,`). If you leave the greeting out, the script adds one. Do not add the sign-off line or your name at the bottom; the email frame adds "Somehow, some way, your foundation is Lewis — and you belong here." and the committee address itself. If you type the sign-off anyway, it is removed so it does not appear twice.
   - Or put bullet points in `Notes` and choose **Reunion, Draft update with AI** from the Sheet menu. The script sends your notes to Claude and writes the result into `Draft`. Read it. Change anything you like. It is a draft, not the email. (Setup for this is below.)
4. **Set the Audience.** One word from the table below, or a Branch name exactly as it appears on the Registrations tab.
5. **Test it first.** Set Audience to `test`, tick **Approved**, and choose **Reunion, Send approved updates now**. Within a minute the email arrives at the Config `email` address with the greeting `Hi committee,`. Read it on a phone. If you want to change it, make a new row (a sent row is finished).
6. **Send it.** Make a new row, or copy the tested one, with the real Audience. Tick **Approved**. Then either wait for the daily run at 9 in the morning (the script's time zone, normally Pacific) or choose **Reunion, Send approved updates now**.
7. **Check the counts.** `Sent at` gets the time, `Sent` the number of households queued, `Skipped` the number left out, and `Failed` any problem. Then look at the **MailQueue** tab: one row per household, Kind `update`. Rows go from `Queued` to `Sent` as the hourly drain works through them.

### A worked example

| ID | Created | Subject | Notes | Draft | Approved | Audience | Sent at | Sent | Failed | Skipped |
|---|---|---|---|---|---|---|---|---|---|---|
| `U-3F9A12C0` | 2027-02-01 | Fees are set and the hotel block is open | fees $120 adult $60 child, deadline May 1, hotel block code LEWIS27 | Hi, The committee has set the fees: ... (two or three paragraphs) | ticked | all | 2027-02-02 09:00 | 184 | 0 | 3 |

Read it as: 184 households were queued, 3 were left out (opted out or no email), nothing failed. `ID` and `Created` were blank when the row was written; the script filled them.

### Audience values

| Audience | Who gets it |
|---|---|
| `all` | Every Registrations row with an email. |
| `unpaid` | Households whose `Balance` is more than 0. |
| `paid` | Households whose `Status` is `Paid in full`. |
| `test` | Only the Config `email` address. No household is touched. Use this to proof an email. |
| a Branch name | Households whose `Branch` matches, for example `Melvin`. Capital letters do not matter. Spelling does. |

Case does not matter for the keywords either. Whatever the audience, a household with `Mail opt-out` = `Yes` or a blank email is skipped, and two households sharing one email address get one copy.

### What Sent, Failed and Skipped mean

- **Sent at**: when the run finished. The script writes `sending…` here while it is working, then the time. Blank means not sent yet. A row that still says `sending…` is picked up again by the next run (menu or 9 am) and continues where it left off; households already queued are never queued twice. A row with a time in `Sent at` is never sent again, even if `Approved` stays ticked.
- **Sent**: how many emails were queued. Not how many have arrived yet; that is in MailQueue.
- **Skipped**: households left out for `Mail opt-out` = `Yes` or a blank email.
- **Failed**: blank when everything went well. `In progress: N of M queued; the next run continues` means a big list ran out of time this run and will finish on the next one. Text that starts with `ERROR:` means the run hit a problem and will retry next run. Other text means nothing was queued and says why: `Draft is blank; nothing was sent`, `No households matched audience "Melvn"`, `Config "email" is blank, so a test has nowhere to go`. Fix the row, clear `Sent at`, and run again; nothing was queued, so nobody gets a duplicate.

Delivery problems after queueing (Brevo down, quota used) do not show up in `Failed`. They show in MailQueue as `Queued` rows with a `Last error`, and are retried every hour as usual.

### STOP replies

The footer of every update says: "You are getting this because your household is registered for the Lewis Family Reunion. To stop these updates, reply with the word STOP." Replies land in `lewisfamilyreunion2027@gmail.com`.

When someone replies STOP:
1. Find their row on the **Registrations** tab (search by email).
2. Type `Yes` in the `Mail opt-out` column (added by `setup`; it sits after the other columns).
3. Reply to them if you like. Nothing else is needed.

`Mail opt-out` stops committee updates only. Registration links and payment receipts still go, because they are about that household's own registration. There is no unsubscribe link and the script does not read the inbox; this step is by hand on purpose.

### Testing with Audience `test`

- From the Sheet: a row with Audience `test` and **Approved** ticked, then **Reunion, Send approved updates now**. One MailQueue row, To = Config `email`, Kind `update`, Household ID `COMMITTEE`. The Updates row shows `Sent` = 1, `Skipped` = 0.
- From the Apps Script editor: run `testUpdate()`. It appends a test row (ID `U-TEST-…`, Subject `Test update`, Audience `test`, Approved ticked) and sends only that row, so other approved updates wait for their normal run. It logs the last MailQueue row. Delete or keep the row; it is finished either way.
- Run **Send approved updates now** a second time. The log says `Updates: nothing approved and unsent.` and no new MailQueue row appears.

### AI drafting (optional)

"Draft update with AI" is a convenience, not a requirement. Sending works without it.

1. Get a key: sign in at console.anthropic.com, open API Keys, create a key, and copy it (it is shown once). It needs a small amount of credit on the account.
2. Apps Script editor, **Project Settings** (gear icon), **Script Properties**, **Add script property**: name `ANTHROPIC_API_KEY`, value = the key. Save. No redeploy is needed.
3. In the Updates tab, put bullet points in `Notes` on a row whose `Draft` is empty. Choose **Reunion, Draft update with AI**. The script takes the first such row (or a row whose `Draft` says exactly `redo`, to try again), asks Claude for the body, and writes it into `Draft`. `Approved` is unticked, so nothing is sent until a person reads it.
4. If something goes wrong, `Draft` starts with `ERROR:` and says what happened. Fix it, clear the cell, and run the menu item again.

Cost: pennies per draft. The model is `claude-opus-5-5` and the request is a few thousand characters. Claude gets your notes plus the reunion facts from Config (dates and city, fees and deadline if set, payment handles, the website). It is told to invent nothing, to leave the greeting out (the script adds it), and to end with the family sign-off (which `draftHtml_` then removes, because the frame adds it). The key is never logged. Running `setup` logs whether the key is present.

### Troubleshooting updates

| What you see | Likely cause | What to do |
|---|---|---|
| Nothing was sent; `Sent at` still blank | `Approved` is not ticked, or the daily run has not happened yet, or the trigger is missing. | Tick the box. Choose **Reunion, Send approved updates now**. Editor, Triggers (clock icon): `sendUpdates` should be listed as daily; if not, run `setup`. |
| `Sent at` says `sending…` and stays that way | The list is large and needs more than one run, or a run died halfway. | Read `Failed`: `In progress` means wait for the next run or use **Send approved updates now** again; `ERROR:` tells you what broke (Executions has the detail). Running again is safe: households already queued are skipped by their MailQueue key. |
| `Failed` has text | Blank `Draft`, misspelt Audience, blank Config `email` for a test, or an error. | Fix what it says, clear `Sent at`, run again. Nothing was queued. |
| `Draft` starts with `ERROR:` | The AI call failed: `HTTP 401` means the key is wrong or missing; `HTTP 429` or `402` means the account is out of credit or rate-limited; `the AI declined` means Claude refused the request; anything else is network or a malformed reply. | Fix the key or the credit, clear `Draft`, run **Draft update with AI** again. Or just write the email yourself. |
| Someone got the update twice | Two Registrations rows with different spellings of the same email (dedupe compares exact lowercase addresses), or the MailQueue rows for that update were deleted and the row re-run. | Merge the duplicate household rows. Leave MailQueue rows alone; they are the record of who was sent what. |
| Someone who asked STOP still got one | `Mail opt-out` was not set, or set to something other than `Yes` (the script accepts `Yes`, `Y`, `True`, `1`), or set on a different household row than the one with that email. | Search Registrations by email, set `Mail opt-out` to `Yes` on every row with that address. Apologise. |
| The update arrived with `Hi cousin,` | The household has no `Preferred` and no `First` name. | Fill in the Registrations row. |
| Only about 100 went out right away | By design. The run queues everything and drains one batch at once (up to 100 rows). | Wait. The hourly drain sends the rest. |

### The daily limit

Brevo's free plan allows about 300 emails a day, and MailApp about 100. `sendUpdates` never sends directly; it writes one MailQueue row per household and calls the drain once. The drain sends what the day's quota allows and the hourly `drainMailQueue` carries the rest, so a 400-household update finishes on the second day. The run's log ends with `N queued; Brevo allows about 300 a day, and the hourly drain carries the rest.` Do not approve two large updates on the same day; the second one waits behind the first. If a quota is hit, MailQueue rows sit at `Queued` with `Brevo 402` or `429` in `Last error` and go out the next day without anyone doing anything.
