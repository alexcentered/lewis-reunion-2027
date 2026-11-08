/* Paste the Apps Script web-app URL (ends in /exec) between the quotes. Nothing else here is secret. */
window.LR = {
  apiUrl: "https://script.google.com/macros/s/AKfycbxWbuV2mx6wxx8uVqMmty6O1FfD86oX_Qe5o99j3ZjN97NHSLrTrm6HVSdnAdXIaYWOQQ/exec",
  photosEnabled: false,  // Set to true when ready to enable photo uploads
  /* Which tabs are live. Home is always on. Add 'family', 'photos' or 'market' here to turn that tab on;
     remove it to hide the tab, its section and its Home tile again. Remove the whole line to show everything. */
  sections: ['home', 'reunion', 'register', 'me']
};
