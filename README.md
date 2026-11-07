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

This repo holds **no family data**. Family names, the tree, and everything people submit live only in the Sheet.

### Privacy

- **Public, no code needed:** dates, schedule, hotel, venues, things to do in Fresno and the FAQ.
- **Family code needed:** the "Who's coming" list, stories, photos, the marketplace and registration. The code is built into the link the committee shares (`?c=…`), so relatives just tap the link. The code is set on the Sheet's **Config** tab (`familyCode`). Change it to retire an old link.
- **Tree code needed:** the family tree requires a separate code (`treeCode` in Config) on top of the family code. This adds an extra layer of protection for family genealogy data.
- **Private to the household and the committee:** contact details, attendees and payments. Each household gets a private edit link by email. Only a SHA-256 hash of that link's token is stored.
- **Payments:** a reported payment never lowers the balance. It counts only after the committee sets its **Status** to `Confirmed` on the **Payments** tab.

## One-time setup (about 5 minutes)

1. Open the **Lewis Reunion 2027 — Site Data** spreadsheet.
2. Go to **Extensions → Apps Script**. Delete the sample code and paste in all of `apps-script/Code.gs`. Save.
3. Choose `setup` in the function menu and click **Run**. Google asks for permission (Sheets, Drive, send email). Approve it. If you see "Google hasn't verified this app", choose **Advanced → Go to project**. This is your own script.
4. Click **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy** and copy the URL that ends in `/exec`.
5. Paste that URL into `config.js` (`apiUrl: "…/exec"`) and commit.

When you change `Code.gs` later:
1. Save your changes in the Apps Script editor
2. Go to **Deploy → Manage deployments**
3. Click the edit icon (pencil) on your existing deployment
4. Under "New description", change **Version** to **"New version"**
5. Click **Deploy**

This keeps the same `/exec` URL while deploying the updated code.

Photo sharing has an on/off switch in two places (Config tab `photosEnabled` and `config.js`). See **[TESTING.md](TESTING.md)** for how to turn it on and check it.

## Committee guide

- **Dashboard tab:** households, adults, children, room nights, paid / partial / unpaid, confirmed dollars, dollars awaiting a check, and households by branch.
- **Payments tab:** set **Status** to `Confirmed` or `Not received`. The date and your email fill in automatically, and the family member's page updates on their next visit.
- **Config tab:** fees per adult and child, payment handles, the verifier's name, the room-block note, the family code (`familyCode`), and the tree code (`treeCode`).
- **Agenda tab:** one row per schedule item. The website groups them by day.
- **Entries tab:** untick **Visible** to hide a story, photo or listing. A hidden photo is also made private in Drive.
- **Reunion menu** (in the Sheet's menu bar): refresh balances by hand, or **Sync photo privacy** to re-match every photo's Drive sharing to its Visible box.

## Sharing link

```
https://lewisfamilyroots.com/?c=FAMILY-CODE
```

Replace `FAMILY-CODE` with the value on the Config tab. Don't post this link anywhere public.

*Note: The old `alexcentered.github.io/lewis-reunion-2027` address redirects to the custom domain.*
