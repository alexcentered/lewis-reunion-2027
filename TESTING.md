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
- The **Reunion** menu in the Sheet: *Refresh balances and status*, *Sync photo privacy*, *Run setup*.
- Keep `PHOTO_MAX_BYTES` in `Code.gs` and `PHOTO.maxUpload` in `app.js` the same (6 MB).
