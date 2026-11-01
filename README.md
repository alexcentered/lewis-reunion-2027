# Lewis Family Reunion 2027

Website for the Lewis Family Reunion, Fresno, California, July 2–5, 2027.

Family members register, report payments, and share stories, tributes, veterans, photos and marketplace listings. **No accounts are needed.** The reunion committee works from a Google Sheet.

## How it works

| Piece | Where it lives |
|---|---|
| Website (`index.html`, `app.js`) | This repo, served by GitHub Pages |
| Data (registrations, payments, stories, schedule, settings) | A private Google Sheet owned by the committee |
| Photos | A private Drive folder next to the Sheet (each photo is viewable by link) |
| Backend (`apps-script/Code.gs`) | Google Apps Script bound to the Sheet |

This repo holds **no family data**. Family names, the tree, and everything people submit live only in the Sheet.

### Privacy

- **Public, no code needed:** dates, schedule, hotel, venues, things to do in Fresno and the FAQ.
- **Family code needed:** the tree, the "Who's coming" list, stories, photos, the marketplace and registration. The code is built into the link the committee shares (`?c=…`), so relatives just tap the link. The code is set on the Sheet's **Config** tab. Change it to retire an old link.
- **Private to the household and the committee:** contact details, attendees and payments. Each household gets a private edit link by email. Only a SHA-256 hash of that link's token is stored.
- **Payments:** a reported payment never lowers the balance. It counts only after the committee sets its **Status** to `Confirmed` on the **Payments** tab.

## One-time setup (about 5 minutes)

1. Open the **Lewis Reunion 2027 — Site Data** spreadsheet.
2. Go to **Extensions → Apps Script**. Delete the sample code and paste in all of `apps-script/Code.gs`. Save.
3. Choose `setup` in the function menu and click **Run**. Google asks for permission (Sheets, Drive, send email). Approve it. If you see "Google hasn't verified this app", choose **Advanced → Go to project**. This is your own script.
4. Click **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy** and copy the URL that ends in `/exec`.
5. Paste that URL into `config.js` (`apiUrl: "…/exec"`) and commit.

When you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version**. That keeps the same URL.

## Committee guide

- **Dashboard tab:** households, adults, children, room nights, paid / partial / unpaid, confirmed dollars, dollars awaiting a check, and households by branch.
- **Payments tab:** set **Status** to `Confirmed` or `Not received`. The date and your email fill in automatically, and the family member's page updates on their next visit.
- **Config tab:** fees per adult and child, payment handles, the verifier's name, the room-block note, and the family code.
- **Agenda tab:** one row per schedule item. The website groups them by day.
- **Entries tab:** untick **Visible** to hide a story, photo or listing.
- **Reunion menu** (in the Sheet's menu bar): refresh balances by hand.

## Sharing link

```
https://alexcentered.github.io/lewis-reunion-2027/?c=FAMILY-CODE
```

Replace `FAMILY-CODE` with the value on the Config tab. Don't post this link anywhere public.
