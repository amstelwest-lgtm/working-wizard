# Milōn desktop (pilot)

Unsigned Windows tray app. It watches one folder and uploads new files into the same source-document intake the website uses (`source-docs` bucket, then `register_source_document`). It does not post to Xero, QuickBooks, Sage, or SARS, and it never deletes or moves files in the folder.

This folder has its own `package.json`. It is not part of the web app install or the web CI jobs.

## Install the Windows build

The website shows **Download for Windows** only when `VITE_WINDOWS_PILOT_INSTALLER_URL` is an https URL. Pushes to `main` overwrite `desktop/Milon-Setup.exe` at that host when the `BLOB_READ_WRITE_TOKEN` Actions secret is set. Until then, use the workflow artifact:

1. Open the pull request's **Desktop Windows** workflow run (or run that workflow with "Run workflow").
2. Download the **milon-windows-exe** artifact. Inside it is `Milon-Setup.exe`.
3. Run the installer.
4. Windows SmartScreen says the app is unrecognized because the installer is unsigned. Choose **More info**, then **Run anyway**.
5. Open Milōn from the desktop shortcut or the system tray.
6. Sign in with your Milōn email and password. The password is not stored. The session is encrypted on this PC with Windows DPAPI (`safeStorage`). **Sign out** deletes it.
7. Choose the folder to watch, choose a client, and leave the books period on the month you are filing.
8. Drop a PDF into that folder (not a subfolder). The status list moves through queued, uploading, and uploaded. If the assistant is unsure, it asks one question first.
9. In the Milōn website, open that client and look at source documents. The file is there.

Photos (PNG, JPEG, HEIC) use the same intake. CSV and Excel are watched, but today's intake allow-list rejects them, so those rows fail with the website's file-type message. The assistant's doc type, period, and flags stay in this window. The intake row has no field for them.

## What the assistant does

For each new file it guesses invoice, bill, receipt, bank statement, or other, and a client and period, from the file name and a short read of the first page (PDF text, CSV text, or Excel shared strings). It flags:

- unreadable files
- duplicates (SHA-256 against files this PC already sent, and against source documents already in intake)
- a period that is not the books period you picked

Low confidence asks one short question. Nothing is posted to a ledger.

## Dev

```bash
cd desktop
npm install
npm test
npm start
```

`npm run dist` on Windows builds the unsigned NSIS installer into `desktop/release/`.

## Window

The installer, desktop shortcut, taskbar, and tray use the Milōn mark from `public/icons/icon-512.png` (the same artwork as the site favicon). `desktop/assets/icon.ico` is that file at 16, 24, 32, 48, 64, 128, and 256. The tray uses `desktop/assets/tray.png`, a 32-pixel copy. The gold wordmark on the sign-in card is cropped from `public/milon-wordmark.png`. The full-bleed background is `desktop/src/assets/signin-bg.webp`.

Forgot password opens `https://www.milonfinance.com/reset-password` in the browser. That is the existing `/reset-password` page. The app checks the address is exactly that https URL before opening it.

Sign-in shows the upload screen as soon as the password grant succeeds. Loading clients and arming the folder watcher happen after that. The password grant itself gives up after about 15 seconds.
