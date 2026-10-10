# Data safety draft

Match Play Console → App content → Data safety. The public notice is https://www.milonfinance.com/privacy. This form is the short version of that notice for the Android shell. The shell adds no extra collection of its own: it is a WebView onto the site.

## Data collected

| Data | Collected | Shared | Why |
| --- | --- | --- | --- |
| Name | Yes | No | Account |
| Email address | Yes | No | Account, sign-in |
| User IDs | Yes | No | The account id the product already stores |
| Financial info | Yes | No | Figures from linked accounting software (QuickBooks, Xero, or Sage) and from files the account uploads. Not a bank login and not a live bank feed. |
| App interactions / app activity | Yes | No | Product events such as “report sent”. Those events are not the financial amounts. |
| Crash and diagnostics | Only if you later add a crash reporter | No | The shell does not ship one today. Leave this off until that exists. |

Not collected by the shell: precise location, contacts, photos (unless the site’s own file picker is used for a statement upload, in which case the file is the financial upload above), SMS, microphone, web browsing history outside the app.

Payments: card numbers are not stored by Milōn. Stripe Checkout, when used, runs in a Custom Tab on Stripe’s host.

## Security

- Encrypted in transit. The shell loads HTTPS only (`usesCleartextTraffic` is false) and the site is HTTPS.
- Users can ask for deletion. The path is inside the signed-in product: Settings → Delete account (`https://www.milonfinance.com/settings`). Deletion runs there; it is not a Play Console toggle.

## Data handling flags

- Data is not sold.
- Data is not used for advertising or tracking across other companies’ apps. Do not tick “advertising” or “data shared with third parties for ads”.
- Account data is required for the service. Financial data is provided when the account connects accounting software or uploads a file.
- Ephemeral processing: no. Figures are stored for the life of the account, as the privacy notice says.

## Privacy policy URL

https://www.milonfinance.com/privacy

Use the same URL on the store listing and on the Data safety form.
