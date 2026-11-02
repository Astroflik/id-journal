# Free hosting with GitHub Pages and Firebase

GitHub Pages hosts the static journal, Firebase Authentication handles
email/password accounts, and Cloud Firestore stores each user's journal state.
The browser can sync up to 5 MB of local-storage data per account in small
Firestore documents. Firebase browser media (intro video and custom video
background) remains local to each device.

The Firebase Spark plan has free monthly quotas, not unlimited service. Keep
Firestore rules restricted to the signed-in user's UID and check the Firebase
usage dashboard. Do not enable billing unless you intend to pay for usage beyond
the free quota.

## 1. Create a Firebase project

1. In the [Firebase Console](https://console.firebase.google.com/), create a
   project. Analytics is not required.
2. Open **Authentication → Sign-in method**, enable **Email/Password**, and save.
3. Open **Firestore Database**, create a database in production mode, and choose
   a location.
4. Open **Firestore → Rules**, replace the starter rules with the contents of
   [`../firestore.rules`](../firestore.rules), and publish. These rules prevent
   users from reading or changing another user's journal.
5. In **Project settings → General → Your apps**, confirm the registered Web
   app uses the configuration already saved in
   [`../public/firebase-config.js`](../public/firebase-config.js). If you
   created a different Firebase project, replace the config with that
   project's web app values. The web API key is a public client identifier,
   not a server password; access control comes from Authentication and
   Firestore rules.
6. In **Authentication → Settings → Authorized domains**, add
   `YOUR_GITHUB_USERNAME.github.io`.

Do not enable billing for this free setup. Firebase has free quotas and blocks
some operations when they are exceeded; inspect its current quota page before
launching if your usage grows.

## 2. Create a GitHub Pages site

Create a **public** GitHub repository for this project. The project `.gitignore`
excludes `.data/`, which contains local account credentials and must never be
uploaded. Do not upload backups containing your trades.

From the project directory, after replacing `YOUR_GITHUB_USERNAME` and
`YOUR_REPOSITORY` with your own values:

```sh
git init -b main
git add .
git commit -m "Prepare free journal hosting"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

In the repository, open **Settings → Pages**, choose **GitHub Actions** as the
build and deployment source, and save. The included workflow deploys the page
after each push to `main`. Open the URL shown in the Pages settings.

## 3. Move the existing journal into your account

1. Open the current local journal and click **Резервная копия (JSON)**.
2. Open the GitHub Pages URL, create an account, and use **Импорт** to select
   the backup. Confirm that the journal's trades, plans, and settings appear.
3. Sign in on another device to confirm they sync. Make private backups
   regularly.

Existing legacy Ruby accounts in `.data/accounts.pstore` are not automatically
converted. Export the journal from the browser where those records are
available, then import that JSON backup after creating the Firebase account.
Passwords are never included in the backup; create a new account password.
