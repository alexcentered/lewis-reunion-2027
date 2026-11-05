/* Paste the Apps Script web-app URL (ends in /exec) between the quotes. Nothing else here is secret. */
window.LR = {
  apiUrl: "https://script.google.com/macros/s/AKfycbxWbuV2mx6wxx8uVqMmty6O1FfD86oX_Qe5o99j3ZjN97NHSLrTrm6HVSdnAdXIaYWOQQ/exec",
  photosEnabled: false,  // Set to true when ready to enable photo uploads
  // Committee back office (admin.html): the OAuth client ID from Google Cloud, ending in .apps.googleusercontent.com.
  // Public by design. Put the same value on the Sheet's Config tab (key: googleClientId). See docs/back-office.md.
  googleClientId: ""
};
