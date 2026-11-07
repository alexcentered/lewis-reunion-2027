# Email runbook

How the reunion site sends email, how it was set up, what each email says, and what to do when something goes wrong. Written for a committee volunteer or an agent who has not seen the setup conversation. The code is in `apps-script/Code.gs`, section "mail" (`sendMail_`) and "email templates".

## Overview and daily limits

Every email goes through one function, `sendMail_`. It tries three routes in order:

1. **Brevo** (API, sender `committee@lewisfamilyroots.com`). Free plan: about **300 emails a day**. Best deliverability, proper domain branding.
2. **MailApp** (the Gmail account of whoever deployed the script). Consumer Gmail: about **100 recipients a day**. Used when Brevo has no key, refuses the key, or is out of quota. The script keeps 5 sends in reserve (`MAIL_RESERVE`).
3. **MailQueue** tab in the Sheet. Catches the overflow. `drainMailQueue()` runs every hour and sends what it can, Brevo first.

Every email, sent or waiting, is one row in **MailQueue**. That tab is the full mail log.

A reunion of a few hundred households will not come near these limits on an ordinary day. The queue exists for the launch day and for broadcast updates later.

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

1. Apps Script editor, Project Settings (gear icon), Script Properties, Add script property: name `BREVO_API_KEY`, value = the Brevo key. Save.
2. Config tab in the Sheet. `setup` adds these rows with defaults if they are missing:
   - `mailFrom`: `committee@lewisfamilyroots.com` (must match the verified Brevo sender)
   - `mailFromName`: `Lewis Family Reunion 2027`
   - `mailReplyTo`: blank means replies go to the `email` row
   - `notifyCommittee`: `Yes` to get an email on each new registration, `No` for quiet
   Also check: `email` = `committee@lewisfamilyroots.com`, `siteUrl` = `https://lewisfamilyroots.com`, `siteLive` = `Yes` once registration opens.
3. Run `setup` from the function menu. It creates MailQueue, appends `Receipt sent` to Payments, installs the hourly `drainMailQueue` trigger and the `onPaymentsEdit` trigger, and logs whether `BREVO_API_KEY` is set and how many MailApp sends are left today. Approve the new permissions (external requests, triggers).
4. Deploy, Manage deployments, pencil, New version, Deploy. Never "New deployment".

## What each email contains

All emails share the frame in `mailWrap_`: Georgia body, the sign-off "Somehow, some way, your foundation is Lewis — and you belong here.", and the committee address from Config `email`. Each has an HTML part and a real plain-text part (`htmlToText_`).

**Registration link email** (`linkEmail_`, kind `link`)
Subject: `You are registered: Lewis Family Reunion 2027` on first registration, or `Your Lewis Reunion registration link` when it is a fresh link (duplicate registration, lost link).
Contains: a button "Open my registration" to `siteUrl?c=<familyCode>&t=<token>#me`; a grey box with the same link spelled out, the website address, **Family code**, **Registration code** (32 characters in groups of 4), and "If the link does not open, go to the website, open My Registration, and type the family code and the registration code"; who is coming; the estimated total (`dueLine_`: adults times fee plus children times fee, with the deadline) or "Registration fees will be announced soon; nothing is due yet."; payment handles if any are set (`payLine_`); a reminder that anyone with the link or codes can change the registration.
When sent as a fresh link, the first line says older links and codes no longer work, because the token was rotated.

**Lost link** is the same email with `rotate = true`, sent by `resend_` from the "Email my link" button. The site always answers "If that email is registered, a new private link is on its way", whether or not the address was found, and ignores repeat requests for 10 minutes.

**Pre-launch receipt** (`sendReceipt_`, kind `receipt0`)
Sent instead of the link email while Config `siteLive` is not `Yes`. Subject: `You are registered: Lewis Family Reunion 2027`. Lists who is coming and says the committee will email about fees. No link, no codes, and the token is left alone.

**Payment receipt** (`receiptEmail_`, kind `receipt`)
Sent once when a Payments row is set to `Confirmed` or `Not received`. Subject: `Payment confirmed: Lewis Family Reunion 2027` or `We have not found your payment yet: Lewis Family Reunion 2027`. Contains: amount, method, date sent, reference; confirmed so far; remaining balance or "Fees to be announced"; a button to `siteUrl?c=<familyCode>#me`; the Family code; and "use the private link from your registration email, or choose Email my link on the My Registration page". It never carries the Registration code: only its hash is stored, and making a new one would log the cousin's phone out.

**Committee notification** (`committeeEmail_`, kind `committee`)
Sent to Config `email` on each new registration when `notifyCommittee` is `Yes`. Subject: `New registration: <Preferred or First> <Last>`. Lists household and ID, branch, adults, children, days, city and state, email, phone.

## MailQueue tab: how-to for the committee

Columns: `Queued` (when the row was written), `To`, `Subject`, `Html`, `Text`, `Status`, `Attempts`, `Last error`, `Sent`, `Via`, `Key`, `Kind`, `Household ID`.

| Status | Meaning |
|---|---|
| `Sent` | Went out. `Via` says how: `Brevo <id>` or `MailApp`. `Sent` has the time. |
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

## Future: Committee Updates

Not built yet. This is the design so the next agent can build it directly.

**Tab `Updates`**, headers: `ID | Created | Subject | Notes | Draft | Approved | Audience | Sent at | Sent | Failed`.
- `ID`: `U-` plus 8 characters, filled by the script when blank.
- `Draft`: the body as simple HTML or plain paragraphs. The script wraps it in `mailWrap_` and adds an opt-out footer.
- `Approved`: a checkbox. Nothing is sent until it is ticked. Unticking after sending does nothing.
- `Audience`: `all` (every Registrations row with an email), `unpaid` (Balance greater than 0), `paid` (Status `Paid in full`), or a Branch name.
- `Sent at`: written by the script. Blank means not sent.
- `Sent`, `Failed`: counts written at the end.

**Column `Mail opt-out` on Registrations.** `Yes` excludes the household from updates. Receipts and link emails still go, because they are about that household's own registration.

**`sendUpdates()`**: menu item under Reunion and a daily time trigger. Under `locked_`:
1. For each Updates row with `Approved` ticked and `Sent at` blank: write `Sent at = sending…` first. That write is the idempotency gate; a second run skips rows that are not blank.
2. Build the recipient list from Registrations by `Audience`, skipping `Mail opt-out = Yes` and blank emails.
3. For each recipient, `enqueue_` one MailQueue row (not a direct send, so a 300-household blast cannot time out) with `key = update:<ID>:<email>`, `kind = update`, `householdId`, and the opt-out footer: "To stop these updates, reply with the word STOP." The committee sets `Mail opt-out` by hand when a STOP reply arrives.
4. Write `Sent at` = now, `Sent` = rows enqueued, `Failed` = recipients skipped for a bad address.
5. `drainMailQueue` does the sending over the next hours, within the daily limits. With Brevo at 300 a day, a 400-recipient update finishes the next day; say so in the log.

An AI drafting step for the `Draft` column is optional and not designed.
