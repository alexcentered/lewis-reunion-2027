# Outreach kit: text messages, the flyer and the QR code

This is how the committee tells the family that registration is open, outside of email. Everything here is made on one page of the website, so it always matches the current family code and the current fees:

**https://lewisfamilyroots.com/share/**

The page is not linked from the site and search engines are asked not to list it. Nothing on it is sent anywhere: the family code is read from your browser (or typed in) and stays there.

## What the page gives you

1. **The family link.** `https://lewisfamilyroots.com/?c=FAMILY-CODE#register` opens the registration page with the family code already in place. If you have opened the family link on this device before, the page already knows the code; otherwise type it in (it is on the Config tab of the Sheet, row `familyCode`).
2. **Three text messages** with a Copy button each. Paste one into a text or a group chat.
3. **The flyer**, dark (for texting and screens) or light (for printing), with a QR code that opens the registration page. **Print or save as PDF** prints one letter-size page; **Download the QR code** saves the code alone as a picture.

Without a family code the page still works, but the link and the QR code are the public address, and the messages tell people to ask the committee for the code.

## Rules of the road

- **Family only.** The family link, the QR code made from it and the flyer that prints the code let anyone register and read the family pages. Send them by text, email or hand. Do not post them on a public page or a public social media post.
- **Never put the family code in this repository.** The repo is public. The drafts below use `[FAMILY LINK]` on purpose. A flyer or QR picture made with the code belongs in the committee's Drive or on a phone, not here.
- **If the link leaks**, change `familyCode` on the Config tab. Old links, old QR codes and old flyers stop working at once; open the share page, type the new code, and make new ones. Households that already registered keep their own private links.
- **No emojis** in committee messages, here or anywhere else.

## The text messages

The share page fills in the link and the fees for you. These are the same words with a placeholder, for reference.

### Plain

Uses only characters every phone shows the same way. About 480 characters with the link in: older phones may deliver it in several parts, which is fine.

```
Hello family! Registration is open for the Lewis Family Reunion 2027, July 2-5 in Fresno, California.

Register your household here:
[FAMILY LINK]

Fees by age at the reunion: 23 and older $245, 16 to 22 $95, 4 to 15 $55, 3 and under free. You can register now and pay later.

Hotel: Home2 Suites by Hilton Fresno Northwest, (559) 512-8410, group code 501.

Please share this with Lewis family only. Questions? committee@lewisfamilyroots.com
```

### Short

One line and the link. Good for a reminder a week later.

```
Lewis Family Reunion 2027: July 2-5 in Fresno, CA. Registration is open. Register your household: [FAMILY LINK]
```

### Styled

The same news with some flourish, for iMessage, WhatsApp and Messenger. The special characters are plain symbols, not emojis, so they look the same everywhere; as an old-style SMS it is cut into more parts.

```
━━━━━━━━━━━━━━━━
L E W I S   F A M I L Y
R E U N I O N   2 0 2 7
━━━━━━━━━━━━━━━━
From their roots, we rise.

◆ July 2 → 5, 2027
◆ Fresno, California
◆ Four days. One family.

REGISTRATION IS OPEN
▸ [FAMILY LINK]

23+ $245 · 16–22 $95 · 4–15 $55 · 3 and under free
Stay: Home2 Suites Fresno Northwest · group code 501

“Somehow, some way, your foundation is Lewis, and you belong here.”
```

## The flyer

- One letter-size page: the reunion medallion, the dates and city, the four days, the QR code with "Scan to register your household", the fees by age, the hotel with group code 501, the family quote and the committee address.
- With the family code it also prints the code and "For Lewis family only. Please do not post publicly."
- To text it: open the share page on a computer, choose **Print or save as PDF**, or take a screenshot of the flyer; on a phone, take a screenshot of the flyer on the page.
- Dark version on paper: turn on **Background graphics** in the print window, or use the light version to save ink.

## Suggested order for opening day

1. Send the welcome email (Updates tab, Template `Welcome from the committee (HTML)`, Audience `test` first, then `everyone`). See [EMAIL.md](EMAIL.md).
2. Text the **Plain** message to the family group chats, with the dark flyer attached.
3. Ask each branch captain to forward both to their own branch.
4. A week later, send the **Short** message as a reminder.

## How it is built

`share/index.html` (the page and the flyer), `share/share.js` (the link, the messages, the QR code) and `share/qrcode.js` (the QR Code Generator by Kazuhiko Arase, MIT license, unchanged). Fees come from the backend's public `info` answer, the same one the site uses; if the backend cannot be reached, the fee lines are left out. The four age groups in `share.js` (`BANDS`) must match `FEE_BANDS` in `app.js` and `Code.gs`.
