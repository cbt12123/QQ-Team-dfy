#!/usr/bin/env bash
set -euo pipefail
export GODOT_SILENCE_ROOT_WARNING=1
PET_ROOT=$(cd "$(dirname "$0")/.." && pwd)
PET_TOOLS="$PET_ROOT/.cache/pet-godot"
PET_GODOT="$PET_TOOLS/Godot_v4.7.2-stable_linux.x86_64"
PET_SDK="${PET_ANDROID_SDK:-/opt/qqbot-android/sdk}"
PET_JAVA="${PET_JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
mkdir -p "$PET_TOOLS/editor_data/export_templates/4.7.2.stable" "$PET_ROOT/artifacts"
for item in android_debug.apk android_release.apk version.txt; do
  if [ ! -f "$PET_TOOLS/editor_data/export_templates/4.7.2.stable/$item" ]; then
    cp "$PET_TOOLS/templates/$item" "$PET_TOOLS/editor_data/export_templates/4.7.2.stable/$item"
  fi
done
chmod +x "$PET_GODOT"
touch "$PET_TOOLS/_sc_"
if [ ! -f "$PET_TOOLS/debug.keystore" ]; then
  "$PET_JAVA/bin/keytool" -genkeypair -keystore "$PET_TOOLS/debug.keystore" -alias androiddebugkey -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Dafeyu Development,O=Noncommercial,C=CN'
fi
cat > "$PET_TOOLS/editor_data/editor_settings-4.7.tres" <<EOF
[gd_resource type="EditorSettings" format=3]

[resource]
export/android/android_sdk_path = "$PET_SDK"
export/android/java_sdk_path = "$PET_JAVA"
export/android/debug_keystore = "$PET_TOOLS/debug.keystore"
export/android/debug_keystore_user = "androiddebugkey"
export/android/debug_keystore_pass = "android"
EOF
"$PET_GODOT" --headless --path "$PET_ROOT/pet-native" --editor --import > "$PET_ROOT/.cache/pet-native-linux-import.log" 2>&1
"$PET_GODOT" --headless --path "$PET_ROOT/pet-native" --script res://update_tests.gd
"$PET_GODOT" --headless --path "$PET_ROOT/pet-native" --script res://tests.gd
"$PET_GODOT" --headless --path "$PET_ROOT/pet-native" --script res://interaction_tests.gd
"$PET_GODOT" --headless --path "$PET_ROOT/pet-native" --script res://form_input_tests.gd
"$PET_GODOT" --headless --path "$PET_ROOT/pet-native" --export-debug 'Android ARM64' "$PET_ROOT/artifacts/dafeyu-native-arm64-debug.apk" > "$PET_ROOT/.cache/pet-native-arm64-export.log" 2>&1
"$PET_GODOT" --headless --path "$PET_ROOT/pet-native" --export-debug 'Android Emulator' "$PET_ROOT/artifacts/dafeyu-native-x86_64-debug.apk" > "$PET_ROOT/.cache/pet-native-emulator-export.log" 2>&1
"$PET_SDK/build-tools/35.0.0/apksigner" verify --verbose "$PET_ROOT/artifacts/dafeyu-native-arm64-debug.apk"
"$PET_SDK/build-tools/35.0.0/zipalign" -c -P 16 4 "$PET_ROOT/artifacts/dafeyu-native-arm64-debug.apk"
sha256sum "$PET_ROOT/artifacts/dafeyu-native-arm64-debug.apk"

"$PET_SDK/build-tools/35.0.0/aapt" dump permissions "$PET_ROOT/artifacts/dafeyu-native-arm64-debug.apk" | grep -F "android.permission.REQUEST_INSTALL_PACKAGES"
