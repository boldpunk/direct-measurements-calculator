# MebelFlow for Android

One app for every company: a Trusted Web Activity (the site in Chrome's engine,
without the address bar) built with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap).

- **Opens** `https://mebelflow.uz/app.html`, which asks once which company to
  open (Molly Home, Sobirov Mebel, SPS) and then goes straight there.
  «Сменить компанию» in the profile menu comes back to that screen.
- **Trusted origins**: mebelflow.uz, sobirov.mebelflow.uz, sps.mebelflow.uz.
  Each serves `/.well-known/assetlinks.json` (from `public/`) with the signing
  key's SHA-256; without it the app still works but shows an address bar.
- **Package** `uz.mebelflow.app`, Android 7.0+ (minSdk 24).
- A new company: add it to `COMPANIES` in `public/app.html` and to
  `additionalTrustedOrigins` here, then rebuild.

## Build

Requirements (no Android Studio needed): JDK 17, Android SDK command-line
tools with `platforms;android-35` and `build-tools;35.0.0`, and
`npm i -g @bubblewrap/cli` with `~/.bubblewrap/config.json` pointing at both
(`{"jdkPath": "...", "androidSdkPath": "..."}`; the SDK dir must contain
`tools/bin/sdkmanager` — a `tools` symlink to `cmdline-tools/latest` works).

```
KEYSTORE=/path/to/mebelflow-release.keystore KEYSTORE_PASSWORD=... ./build.sh
```

Output: `android/mebelflow.apk` (send it to staff; on the phone allow
«Установка из неизвестных источников» for Telegram/Files once). Also produces
`app-release-bundle.aab` if the app ever goes to Google Play.

For every release bump `appVersionCode` (+1) and `appVersion` in
`twa-manifest.json`, or phones refuse the update.

## Signing key

`mebelflow-release.keystore` (alias `mebelflow`) is kept outside git by the
owner. **Keep it and its password safe:** an installed app can only be updated
by an APK signed with the same key, and `assetlinks.json` is tied to it.
SHA-256: `D0:9C:0D:A7:C4:1F:9E:72:47:19:8E:1D:16:E3:B3:D0:57:CC:07:E4:99:90:69:5B:D7:FA:15:46:83:67:E4:2A`
