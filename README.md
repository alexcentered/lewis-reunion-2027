# Lewis Family Reunion 2027

Website for the Lewis Family Reunion, Fresno, California, July 2–5, 2027.

Family members register, report payments, and share stories, tributes, veterans, photos and marketplace listings. **No accounts are needed.** The reunion committee works from a Google Sheet.

## How it works

| Piece | Where it lives |
|---|---|
| Website (`index.html`, `app.js`) | This repo, served by GitHub Pages |
| Data (registrations, payments, stories, schedule, settings) | A private Google Sheet owned by the committee |
| Photos | A private Drive folder next to the Sheet. The folder can't be listed. Each visible photo opens only by its exact link, and those links go only to people with the family code |
| Backend (`apps-script/Code.gs`) | Google Apps Script bound to the Sheet |
| Email | Sent by the backend through Brevo from `committee@lewisfamilyroots.com`, with the Gmail account that deployed the script as a fallback and a **MailQueue** tab in the Sheet for anything that has to wait. Replies and `info@` forward to the committee Gmail. Details in [docs/EMAIL.md](docs/EMAIL.md) |

This repo holds **no family data**. Family names, the tree, and everything people submit live only in the Sheet.

Working on the code? Start with **[AGENTS.md](AGENTS.md)**: architecture, every Sheet tab and column, Config keys, deploy steps and conventions.

### Privacy

- **Public, no code needed:** dates, schedule, hotel, venues, things to do in Fresno and the FAQ.
- **Family code needed:** the family tree, the "Who's coming" list, stories, photos, the marketplace and registration. The code is built into the link the committee shares (`?c=…`), so relatives just tap the link. The code is set on the Sheet's **Config** tab (`familyCode`). Change it to retire an old link.
- **Private to the household and the committee:** contact details, attendees and payments. Each household gets a private edit link by email. Only a SHA-256 hash of that link's token is stored.
- **Payments:** a reported payment never lowers the balance. It counts only after the committee sets its **Status** to `Confirmed` on the **Payments** tab.

### Codes in the email

The registration email carries a button with the private link, and under it two codes in plain text: the **Family code** (the same one in the shared link) and the **Registration code** (32 letters and numbers, shown in groups of 4). If the link will not open, a relative goes to the website, opens **My Registration**, and types both codes. Lost the email? **Email my link** on the same page sends a fresh one; older links and codes stop working. Payment receipts repeat the Family code but never the Registration code.

## One-time setup (about 10 minutes)

1. Open the **Lewis Reunion 2027 — Site Data** spreadsheet.
2. Go to **Extensions → Apps Script**. Delete the sample code and paste in all of `apps-script/Code.gs`. Save.
3. In the editor, open **Project Settings** (gear icon) → **Script Properties** → **Add script property**. Name `BREVO_API_KEY`, value = the Brevo API key. Save. Without it, email still goes out, but only through Gmail (about 100 a day). Optional: a second property `ANTHROPIC_API_KEY` (from console.anthropic.com) turns on **Draft update with AI**; updates can be sent without it.
4. Choose `setup` in the function menu and click **Run**. Google asks for permission (Sheets, Drive, send email, connect to an external service, run triggers). Approve it. If you see "Google hasn't verified this app", choose **Advanced → Go to project**. This is your own script. The log at the bottom says whether the Brevo key was found.
5. Click **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy** and copy the URL that ends in `/exec`.
6. Paste that URL into `config.js` (`apiUrl: "…/exec"`) and commit.
7. Before launch, on the **Config** tab set `siteLive` to `Yes`, `email` to `committee@lewisfamilyroots.com`, `siteUrl` to `https://lewisfamilyroots.com`, and `feeAdult` / `feeChild` once the fees are decided. `setup` has already added `mailFrom`, `mailFromName`, `mailReplyTo` and `notifyCommittee` with sensible defaults.

When you change `Code.gs` later:
1. Save your changes in the Apps Script editor
2. Go to **Deploy → Manage deployments**
3. Click the edit icon (pencil) on your existing deployment
4. Under "New description", change **Version** to **"New version"**
5. Click **Deploy**

This keeps the same `/exec` URL while deploying the updated code.

**Turning tabs on.** The site opens with only Home, The Reunion, Register and My Registration. To turn on Our Family, Photos or Marketplace, add `'family'`, `'photos'` or `'market'` to the `sections` line in `config.js` and commit; remove the word to hide the tab again.

Photo sharing has an on/off switch in two places (Config tab `photosEnabled` and `config.js`). See **[TESTING.md](TESTING.md)** for how to turn it on and check it, for the email and codes checklist, and for checking a committee update.

## Committee guide

- **Dashboard tab:** households, adults, children, room nights, paid / partial / unpaid, confirmed dollars, dollars awaiting a check, and households by branch.
- **Payments tab:** set **Status** to `Confirmed` or `Not received`. The date and your email fill in automatically, and the family member's page updates on their next visit. The household also gets **one** receipt email per status change; the **Receipt sent** column records it, and editing the row again sends nothing more.
- **Tracking money** (Holders, Expenses, Transfers, Budget and Money tabs; all of it works from the Google Sheets phone app):
  - **Once:** on **Holders**, add a row for each person who receives or spends reunion money, with the ways they take payments (for example `Zelle, Cash App`). Put the treasurer's email in the Config row `treasurerEmail` to get the money report every Monday morning.
  - **Someone hands you cash or a check:** add a **Payments** row. Type their name or email in **Household**, the **Amount**, the **Method**, who has the money in **Received by**, and set **Status** to `Confirmed`. The Household ID fills in by itself; if the name matches nobody, or more than one household, the **Note** says so and you type the ID. Payments reported on the website fill in **Received by** from the Holders tab.
  - **Money goes out:** add an **Expenses** row: what, the amount, the **Category**, who paid in **Paid by**, and a link to the receipt. Set **Status** to `Planned` for a bill not paid yet.
  - **Money moves between people** (one member hands money to another, a deposit, or paying back someone who spent their own money): add a **Transfers** row.
  - **Read the Money tab:** cash on hand, money in, who is holding what, spending against the **Budget** tab, and anything that needs a look. It updates after every edit; do not type on it. "Owed back" means that person spent more of their own money than they hold; a Transfer to them settles it.
- **Config tab:** fees per adult and child, payment handles, the verifier's name, the room-block note, the family code (`familyCode`), the treasurer's address (`treasurerEmail`), and the email rows (`mailFrom`, `mailFromName`, `mailReplyTo`, `notifyCommittee`). Set `notifyCommittee` to `Yes` to get an email about each new registration.
- **Agenda tab:** one row per schedule item. The website groups them by day.
- **Entries tab:** untick **Visible** to hide a story, photo or listing. A hidden photo is also made private in Drive.
- **Sending an update to everyone:** the **Updates** tab holds one row per committee email. Write the **Subject** and the **Draft** (plain paragraphs are fine; start with `Hi,` and each household gets its own name), set **Audience** to `all`, `unpaid`, `paid`, `test` (only the committee address), a branch name, or, to reach relatives who have not registered, `everyone`, `contacts` or `unregistered` (see **Contacts** below), and tick the **Approved** box. The script sends it at 9 the next morning, or right away from **Reunion → Send approved updates now**; to hold it for a later day, put the date in **Send on** (it goes out at 9 that morning, and **Failed** says "Scheduled" until then), one MailQueue row per household; **Sent**, **Failed** and **Skipped** fill in. Proof it with Audience `test` first. Every update ends "To stop these updates, reply with the word STOP"; when someone does, type `Yes` in their **Mail opt-out** column on **Registrations** (or **Contacts**) and they are left out of future updates (receipts and links still go). To reuse wording, pick a **Template** in the last column: the Subject and Draft fill in from the **Templates** tab, with fields such as `{{first name}}`, `{{balance}}` and `{{deadline}}` filled in per household. Click any row and choose **Reunion → Email me this draft** to get it yourself first, as a family would see it. The Templates tab also holds the two editable lines of the registration email ("Registration: thank you" and "Registration: what happens next"). If you would rather not write it yourself, put bullet points in **Notes** and choose **Reunion → Draft update with AI**; read and edit the draft before approving. Full steps in [docs/EMAIL.md](docs/EMAIL.md).
- **Contacts tab and the welcome email:** list relatives who have not registered yet, one per row (`First`, `Last`, `Email`, optional `Branch` and `Notes`). Pasting from another sheet is fine. Then send the **Welcome from the committee** template: an Updates row with that Template, Audience `test` first, then `everyone` (every registered household and everyone on Contacts, one copy per email). Its `{{family link}}` is the family link with the code, so people can register; keep it in the family. `unregistered` reaches only Contacts who have not registered yet, which suits a reminder. Fields about money or a household (`{{balance}}`, `{{household id}}` and similar) are refused for these audiences, because a relative who has not registered has none.
- **MailQueue tab:** one row per email, sent or waiting. `Status` is `Sent`, `Queued` or `Failed`; `Last error` says why. To retry a Failed row, type `Queued` in its Status cell. See [docs/EMAIL.md](docs/EMAIL.md).
- **Reunion menu** (in the Sheet's menu bar): **Refresh balances and status**, **Send queued mail now** (sends waiting MailQueue rows without waiting for the hourly run), **Send me a test email** (a sample registration email to you, so you can see the route and the wording), **Send approved updates now** (sends ticked Updates rows without waiting for 9 am), **Send the money report now** (emails the money report to `treasurerEmail` right away), **Draft update with AI** (turns Notes into a Draft; needs the optional key), **Email me this draft** (the row you clicked on Updates or Templates, to you, filled in for a made-up household), **Sync photo privacy** (re-match every photo's Drive sharing to its Visible box), **Run setup**.

## Sharing link

```
https://lewisfamilyroots.com/?c=FAMILY-CODE
```

Replace `FAMILY-CODE` with the value on the Config tab. Don't post this link anywhere public.

*Note: The old `alexcentered.github.io/lewis-reunion-2027` address redirects to the custom domain.*
