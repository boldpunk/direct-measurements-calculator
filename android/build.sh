#!/usr/bin/env bash
# Builds the MebelFlow Android app (Trusted Web Activity) into
# android/mebelflow.apk. Needs: JDK 17, Android SDK, @bubblewrap/cli —
# see android/README.md. The signing keystore is NOT in git; pass it in:
#
#   KEYSTORE=/path/to/mebelflow-release.keystore KEYSTORE_PASSWORD=... ./build.sh
#
# Bump appVersionCode (and appVersion) in twa-manifest.json for every
# release, or phones refuse the update.
set -euo pipefail
cd "$(dirname "$0")"
BUBBLEWRAP="${BUBBLEWRAP:-bubblewrap}"
: "${KEYSTORE:?Set KEYSTORE to the release keystore path}"
: "${KEYSTORE_PASSWORD:?Set KEYSTORE_PASSWORD}"
cp "$KEYSTORE" ./mebelflow-release.keystore

# Icons are read from ../public through a throwaway local server.
python3 -m http.server 8099 --bind 127.0.0.1 --directory ../public >/dev/null 2>&1 &
ICON_SERVER=$!
trap 'kill $ICON_SERVER 2>/dev/null; rm -f ./mebelflow-release.keystore' EXIT
sleep 1

NO_PROXY="127.0.0.1,localhost,${NO_PROXY:-}" "$BUBBLEWRAP" update --skipVersionUpgrade < /dev/null

# The generated template still lists jcenter(), which is gone; use Maven
# Central through Google's mirror (the main host rate-limits Gradle).
sed -i "s#^\(\s*\)jcenter()#\1maven { url 'https://maven-central.storage-download.googleapis.com/maven2/' }\n\1mavenCentral()#" build.gradle

BUBBLEWRAP_KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD" BUBBLEWRAP_KEY_PASSWORD="$KEYSTORE_PASSWORD" \
  "$BUBBLEWRAP" build --skipPwaValidation < /dev/null

cp app-release-signed.apk mebelflow.apk
echo "==> android/mebelflow.apk ($(du -h mebelflow.apk | cut -f1))"
