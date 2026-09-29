# Khana Alert

PG food-refill alerts. A resident taps the item that ran out at the buffet; kitchen phones ring until someone
brings it. Built by [Ferrowright Engineering](https://ferrowright.com).

- `public/` — web app (no build step): resident page `index.html`, kitchen screen `kitchen.html`, owner setup `setup.html`
- `functions/` — Cloud Functions (codebase `khana`): alarm push to kitchen phones, 30-minute kitchen-phone check-up
- `kitchen-app/` — Capacitor Android app for kitchen staff (alarm-style ringing while the phone sleeps)
- `firestore-khana.rules` — Firestore rules for this app

## Config not in git

| File | Where it comes from |
|---|---|
| `public/firebase-config.js` | copy `public/firebase-config.example.js`, fill from Firebase console (Web app) |
| `kitchen-app/google-services.json`, `kitchen-app/android/app/google-services.json` | `firebase apps:sdkconfig ANDROID <app-id> -o google-services.json` |
| `kitchen-app/keystore/` | APK signing key + `keystore.properties`. Keep a backup: updates must use the same key |

## Deploy

The Firebase project is shared with another app, so Firestore rules live in that app's rules file:

```sh
python3 update-rules.py                      # swaps the Khana section into ~/Documents/ramdhun-scheduler/firestore.rules
(cd ~/Documents/ramdhun-scheduler && firebase deploy --only firestore:rules)
firebase deploy --only functions:khana,hosting
```

Kitchen APK (Node 22): `cd kitchen-app && npm install && npm run apk` — writes `public/khana-kitchen.apk`, then deploy hosting.
