# Turning on photo sharing

Photo uploads are off until **two switches** are both on:

| Switch | Where | Off (now) | On |
|---|---|---|---|
| 1. Server | Google Sheet → **Config** tab → row `photosEnabled` | `No` | `Yes` |
| 2. Website | `config.js` in this repo → `photosEnabled` | `false` | `true` |

Either order is safe. If only one is on, nobody can upload: the website either hides the form or the server politely refuses. **One switch also covers the optional photos on tributes, veterans, the directory and the marketplace**, not just the Photos page.

---

## Step 0: before Sunday (one time, about 5 minutes)

The new `Code.gs` has to be live **before** you flip the switches. Photos stay off while you do this.

1. Open the **Lewis Reunion 2027 — Site Data** sheet → **Extensions → Apps Script**.
2. Select everything in `Code.gs`, delete it, paste in the new `apps-script/Code.gs` from this repo, and press **Save**.
3. In the function menu at the top, choose **`setup`** and press **Run**.
   - Google will ask for permission again because the script now installs a trigger. Approve it. If you see "Google hasn't verified this app", choose **Advanced → Go to project**.
   - The log at the bottom should end with `Setup complete … Photo uploads are OFF`.
   - Setup is safe to run again. It keeps the photo folder private, installs the "hide photo when Visible is unticked" trigger (only once), and matches every photo's Drive sharing to its Visible box. It does not change any rows.
4. **Deploy → Manage deployments →** pencil icon on the existing deployment → **Version: New version** → **Deploy**.
   - Use *Manage deployments*, **not** *New deployment*. That keeps the same `/exec` URL, so `config.js` does not change.
5. Merge the pull request so GitHub Pages serves the new `app.js` and `index.html` (about 1 minute).
6. Quick check while photos are still off: open the site on your phone with the family link → **Photos** shows "Photos are coming soon", and the photo fields on tributes, veterans, the directory and the marketplace are hidden.

## Step 1: Sunday, flip the switches

1. Sheet → **Config** tab → `photosEnabled` → type `Yes`.
2. GitHub → `config.js` → change `photosEnabled: false` to `photosEnabled: true` → commit to `main`.
3. Wait 1–2 minutes for GitHub Pages, then fully reload the site on your phone (close the tab and reopen the family link).

## Step 2: Sunday, check it (about 10 minutes, on an iPhone)

Use Safari on an iPhone, since that's what most of the family uses. Tick each box as you go.

**Upload**
- [ ] Open the family link → **Photos**. "Coming soon" is gone and **Add a photo** is there.
- [ ] Tap **Choose File → Photo Library**, pick a normal photo. A small preview appears with its size and "We will shrink it so it sends faster".
- [ ] Fill in "Who's in it" and your name → **Add photo**. You see "Getting your photo ready…", then "Uploading your photo (about 0.5 MB)…" with a moving bar, then "Shared. Thank you."
- [ ] The photo shows at the top of the gallery and in the scrolling strip. If it says "Photo is still processing", wait a minute and refresh: Google needs a few seconds to make the preview.
- [ ] Tap the photo. The full-size version opens in a new tab.
- [ ] Repeat with **Take Photo** (camera) instead of the library.

**Guard rails**
- [ ] Tap **Add photo** two or three times fast. Only **one** new photo appears.
- [ ] Choose the same photo again and send it. You see "That photo was already shared".
- [ ] Choose something that isn't a JPG/PNG/HEIC/WebP (a GIF, a PDF from Files). You see a plain message and nothing is sent.
- [ ] Turn on Airplane Mode and press **Add photo**. You see "You seem to be offline". Turn it off again.
- [ ] Optional slow-network test on a computer: Chrome → DevTools → Network → **Slow 3G**, then upload. You see "Still uploading…" after 15 seconds and it finishes. If it gives up, pressing the button again does **not** post twice.

**Other sections**
- [ ] **Our Family → In memoriam → Add a tribute** with a photo. It saves and shows the picture.

**Behind the scenes (on a computer)**
- [ ] Sheet → **Entries** tab: a new row with Type `photo` and a **Photo ID**.
- [ ] Drive → folder **Lewis Reunion 2027 — Shared Photos**: a file named like `E-1A2B3C4D.jpg`. Its **Share** setting says *Anyone with the link · Viewer*.
- [ ] The **folder's** Share setting says **Restricted** (only people added by name). This stops anyone from listing the uploads.
- [ ] Untick **Visible** on your test row. Within a few seconds the file's Share setting changes to **Restricted** and the photo disappears from the site after a refresh. Tick it again and the link opens again.
- [ ] Open the site in a private window **without** the family link → **Photos** asks for the family code and shows no pictures.

**Clean up:** untick **Visible** on your test uploads (or delete those rows and move the files to Drive's trash). Leave the existing test data rows alone.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| "Photo sharing is not open yet" after flipping both | The Config value must read exactly `Yes`. Check that the Apps Script deployment was updated (Step 0.4). |
| Form still hidden | `config.js` change not live yet. Wait 2 minutes, close the tab, open the family link again. |
| "We could not save that photo" | Apps Script → **Executions** shows the error. Most often Drive permissions: run `setup` again and approve. |
| Photo stays "still processing" for more than 5 minutes | Check the file's Share setting in Drive is *Anyone with the link*. Run **Reunion → Sync photo privacy** from the Sheet menu. |
| "Lots of photos are coming in right now" | The site-wide brake (150 uploads per hour) kicked in. It resets on the hour. Change `PHOTO_UPLOADS_PER_HOUR` in `Code.gs` if you need more. |

**Emergency off switch:** set `photosEnabled` to `No` on the Config tab. Uploads stop at once, with no redeploy needed. Set `config.js` back to `false` afterwards so the form hides too. Photos already shared stay visible to family; untick **Visible** to hide any one of them.

## How photos are kept private

- **Family code on every request.** Uploading and loading the gallery both go to the server, which checks the family code each time. The code travels only inside the request body (POST), never in a web address, and is never logged or sent back. The server now refuses plain web-address (GET) requests for anything except public info.
- **What is public.** Each *visible* photo can be opened by someone who has its exact link, because that's how the gallery shows pictures from Drive. Those links are handed out only after the family-code check. The folder itself is private, so nobody can browse or list it. Hidden photos (Visible unticked) are made private in Drive.
- **Checked on both sides.** The phone accepts only JPG, PNG, HEIC or WebP up to 30 MB and shrinks the photo to at most 1600 px (usually 0.3–1 MB) before sending. The server checks the file's real contents (not just its name), refuses anything over 6 MB, and names the file itself.
- **Location data removed.** Shrinking redraws the picture, which drops the hidden camera and GPS data. One exception: a computer that cannot open HEIC files (most Windows PCs) sends the HEIC as it is, so its location data stays in the file. iPhones convert to JPG automatically, so this does not affect phone uploads.

## Apps Script redeploy notes (for any future `Code.gs` change)

- Paste → Save → **Deploy → Manage deployments → Edit → New version → Deploy**. Never "New deployment", which would change the URL.
- Run `setup` again only when a change adds new Google permissions (Google will prompt you), like this one did.
- The **Reunion** menu in the Sheet: *Refresh balances and status*, *Send queued mail now*, *Send me a test email*, *Send approved updates now*, *Draft update with AI*, *Sync photo privacy*, *Run setup*.
- Keep `PHOTO_MAX_BYTES` in `Code.gs` and `PHOTO.maxUpload` in `app.js` the same (6 MB).

---

# Email and codes

Checks for the registration email, the two codes, and payment receipts. Do them after the email setup in **[docs/EMAIL.md](EMAIL.md)** is done, `BREVO_API_KEY` is in Script Properties, `setup` has been run, the deployment has a new version, and the Config tab has `siteLive` = `Yes`, `email`, `siteUrl` and (if known) the fees.

Use your phone for the inbox checks and a computer for the Sheet. Use an email address you can read on the phone. Tick each box as you go.

**Register a test household**
- [ ] Open the family link on your phone → **Register**. Fill in a made-up household with your own email, two adults and one child, pick at least one day, tick the travel box → **Send**.
- [ ] The success panel shows "You're registered. Welcome home.", your private link, and under it **Family code** and **Registration code** with Copy buttons. The registration code is 32 letters and numbers in groups of 4.
- [ ] Within a minute an email arrives **from committee@lewisfamilyroots.com**, subject "You are registered: Lewis Family Reunion 2027". It is in the inbox, not spam. Check a Gmail, a Yahoo and an iCloud address if you can.
- [ ] The email has a green **Open my registration** button, a grey box with the link, the website, the Family code and the Registration code, who is coming, and either "Estimated total: $…" or "Registration fees will be announced soon".
- [ ] Tap the button. The site opens on **My Registration** with your household loaded.

**Type the codes**
- [ ] Open a **private window** (Safari: tabs button → Private) and go to `https://lewisfamilyroots.com/#me` with no `?c=` in the address.
- [ ] You see "Find your registration" with two boxes, **Family code** and **Registration code**. Type a wrong family code and the real registration code → **Open my registration**. You see "That family code is not right. Check it against your email."
- [ ] Type the real family code and a registration code with one character wrong. You see "That registration code did not match. Check it against your email, or use Email my link below." The Family code box disappears, because the site now knows the family code.
- [ ] Type the real registration code (spaces and dashes do not matter, capital letters do not matter) → **Open my registration**. Your household loads.

**Lost link**
- [ ] On **My Registration**, under "Lost the email?", enter your email → **Email my link**. The site says "If that email is registered, a new private link is on its way."
- [ ] A new email arrives, subject "Your Lewis Reunion registration link", saying older links and codes no longer work. The new registration code is different. In the private window, the old code now fails and the new one works.
- [ ] Press **Email my link** again straight away. The site says the same thing, but no second email arrives for 10 minutes. That is on purpose.

**Register twice**
- [ ] Register again with the same email. The site says "That email is already registered. We just emailed you a private link to view and change it." An email arrives. There is no "Something went wrong" message.

**Payment receipt (on a computer)**
- [ ] On your phone, **My Registration** → report a payment of $1 by Zelle.
- [ ] Sheet → **Payments** tab: the new row has Status `Reported`. Change it to `Confirmed`. **Confirmed on** and **Confirmed by** fill in, and within a few seconds **Receipt sent** reads `Confirmed · <time> · Brevo …` (or `MailApp`).
- [ ] One email arrives: "Payment confirmed: Lewis Family Reunion 2027" with the amount, confirmed total, balance (or "Fees to be announced") and the Family code. It does **not** contain the Registration code.
- [ ] Edit the same row again (add a note, or set `Confirmed` again). No second email. **Receipt sent** does not change.
- [ ] Change Status to `Not received`. One email arrives: "We have not found your payment yet". Change it back to `Reported`. No email.
- [ ] Paste `Confirmed` into two or three Reported rows at once. Each household gets one email.

**Gmail fallback (on a computer)**
- [ ] Apps Script → Project Settings → Script Properties → delete the `BREVO_API_KEY` row (keep a copy of the value) → Save.
- [ ] Register another test household on your phone. It saves. The email still arrives, this time from the Gmail address that deployed the script, with the sender name "Lewis Family Reunion 2027".
- [ ] Sheet → **MailQueue** tab: the newest row says `Sent`, Via `MailApp`. Apps Script → **Executions** shows the registration run without errors.
- [ ] Add the property back → Save. Sheet menu **Reunion → Send me a test email**. The email arrives and the new MailQueue row says Via `Brevo …`.
- [ ] If any row says `Queued`: **Reunion → Send queued mail now**. It changes to `Sent`.

**Replies**
- [ ] Reply to any of the test emails. It arrives in `lewisfamilyreunion2027@gmail.com`.
- [ ] Send a message to `info@lewisfamilyroots.com`. It arrives there too.

**Clean up:** delete your test rows on **Registrations** and **Payments** (or leave them and note them as tests). Leave **MailQueue** rows alone; they are the record. In the repo, `git grep -iE 'xkeysib-[0-9a-f]'` must find nothing.

| What you see | What to do |
|---|---|
| No email at all | Sheet → **MailQueue**. No row: look at Apps Script → **Executions**. Row `Queued`: read **Last error** and run **Send queued mail now**. |
| Email in spam | Mark it "Not spam". Then check the DNS records in [docs/EMAIL.md](EMAIL.md). |
| "Brevo 401" or "403" in Last error | The key is missing or wrong. Fix Script Properties. Mail is using Gmail meanwhile. |
| Receipt did not send | Apps Script → **Triggers** (clock icon): `onPaymentsEdit` must be listed. If not, run `setup`. |
| Codes do not open the household | Check `siteLive` is `Yes` and the deployment was updated. Then use **Email my link** for fresh codes. |

---

# Sending an update

Checks for a committee update to every household. Do them after `setup` has been run on the new code (it adds the **Updates** tab, the **Mail opt-out** column on Registrations and the daily `sendUpdates` trigger) and the deployment has a new version. Use a computer for the Sheet and your phone for the inbox. The Config `email` address must be one you can read.

**Test audience run**
- [ ] Sheet → **Updates** tab. In a new row type Subject `Test update from the committee`, Draft `Hi,` on the first line, a blank line, then two short paragraphs. Set Audience to `test`. Tick **Approved**.
- [ ] Menu **Reunion → Send approved updates now**. Within a few seconds the row's **Sent at** changes to `sending…` and then to the time. **Sent** reads `1`, **Failed** is blank, **Skipped** `0`. **ID** reads `U-` and 8 characters.
- [ ] Apps Script → **Executions**: the `sendUpdates` run ends with `1 queued; Brevo allows about 300 a day, and the hourly drain carries the rest.`

**Check the committee inbox**
- [ ] Within a minute an email arrives at the Config `email` address from `committee@lewisfamilyroots.com` with your subject. It opens `Hi committee,`, shows your two paragraphs, then "Somehow, some way, your foundation is Lewis — and you belong here.", the committee address, and in small grey text "You are getting this because your household is registered for the Lewis Family Reunion. To stop these updates, reply with the word STOP."
- [ ] The sign-off appears once, not twice. There is no link, no Family code and no Registration code in the email.

**Check MailQueue**
- [ ] Sheet → **MailQueue** tab: one new row. **To** is the Config `email`, **Kind** `update`, **Key** `update:U-…:<that email>`, **Household ID** `COMMITTEE`, **Status** `Sent`, **Via** `Brevo …` (or `MailApp`).
- [ ] If the row says `Queued`: read **Last error**, then **Reunion → Send queued mail now**.

**A second run sends nothing**
- [ ] Leave **Approved** ticked. Menu **Reunion → Send approved updates now** again. **Sent at** does not change, no new MailQueue row appears, and Executions says `Updates: nothing approved and unsent.`
- [ ] Untick and re-tick **Approved**. Still nothing. (A row with anything in **Sent at** is finished. To send again, make a new row.)

**Opt-out check with a test household**
- [ ] Sheet → **Registrations**: find a test household with your own email (register one from the phone if there is none) and note its **Branch**. Type `Yes` in its **Mail opt-out** column (the last column; run `setup` if it is missing).
- [ ] Updates tab, new row: any Subject and Draft, Audience = that household's Branch name, **Approved** ticked. **Reunion → Send approved updates now**.
- [ ] The row shows **Skipped** `1` (plus any other opted-out rows in that branch) and **Sent** counts the rest of the branch. No email arrives at your address. If the branch has other real households, they will get this test email, so use a branch that holds only test rows or clear the row's Approved box first and skip this check.
- [ ] Clear **Mail opt-out** on your test household. New row, same Branch, **Approved** ticked, run again. **Sent** goes up by one and the email arrives, opening with that household's first name.
- [ ] Misspell the Audience on a new row (for example `Melvn`), tick **Approved**, run. **Sent** `0`, **Failed** reads `No households matched audience "Melvn"`, nothing in MailQueue. Fix the spelling, clear **Sent at**, run again if you want it to go.

**AI draft check (only if `ANTHROPIC_API_KEY` is set)**
- [ ] Updates tab, new row: Subject `Hotel block`, Notes `hotel block open, code LEWIS27, closes June 1`, Draft empty. Menu **Reunion → Draft update with AI**.
- [ ] A dialog says `Draft written to row N. Read it, edit it, set the Audience, then tick Approved.` The **Draft** cell holds short paragraphs mentioning the code and the date, no greeting at the top, and **Approved** is unticked.
- [ ] Type `redo` into that Draft cell and run the menu item again. A new draft replaces it.
- [ ] Without the key (or with a wrong one): the menu item shows a dialog about `ANTHROPIC_API_KEY` and Project Settings, or writes `ERROR: HTTP 401 …` into Draft. Nothing is sent either way.

**Clean up:** leave the Updates rows; they are the record of what went out. Leave MailQueue alone. Clear `Mail opt-out` on your test household if you set it.

| What you see | What to do |
|---|---|
| **Sent at** stays blank after the menu item | Approved is not ticked, or the Sheet was busy. Tick it and run again. Check Executions. |
| **Sent at** stuck on `sending…` | A big list needs another run, or the run died. **Failed** says which. Run **Send approved updates now** again; households already queued are skipped. |
| **Failed** has words in it | Read them: blank Draft, misspelt Audience, or blank Config `email`. Fix, clear **Sent at**, run again. |
| Email says `Hi cousin,` | The household has no Preferred or First name on Registrations. |
| **Draft** starts with `ERROR:` | The AI call failed; the text says why. Fix the key or credit, clear the cell, try again, or write the email by hand. |
| Only some households got it today | Normal for a big list. Brevo allows about 300 a day; the hourly drain sends the rest tomorrow. |

