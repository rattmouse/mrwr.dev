#!/usr/bin/env bash
set -euo pipefail

APP_NAME="mrwr.dev"
MAIN_CLASS="Main"

BIN_DIR="bin"
LIB_DIR="lib"
DIST_DIR="dist"
BUILD_DIR="build"
WORK_DIR="$BUILD_DIR/work"
MANIFEST="$BUILD_DIR/MANIFEST.MF"

#GSON_JAR="$(ls -1 "$LIB_DIR"/gson-*.jar 2>/dev/null | head -n 1 || true)"

die(){ echo "ERROR: $*" >&2; exit 1; }

rm -rf "$BUILD_DIR" "$DIST_DIR"
mkdir -p "$WORK_DIR" "$DIST_DIR" "$BUILD_DIR"

[[ -d "$BIN_DIR" ]] || die "Missing $BIN_DIR/"
#[[ -n "$GSON_JAR" && -f "$GSON_JAR" ]] || die "Missing gson jar under $LIB_DIR/"

# 1) Unzip gson classes into work dir
#(cd "$WORK_DIR" && jar xf "../../$GSON_JAR")

# 2) Copy your classes over (these should win)
cp -a "$BIN_DIR"/. "$WORK_DIR/"

# 3) Write manifest (no Class-Path needed now)
cat > "$MANIFEST" <<EOF
Manifest-Version: 1.0
Main-Class: dev.mrwr.$MAIN_CLASS

EOF

# 4) Create the fat jar
rm -f "$DIST_DIR/$APP_NAME.jar"
(cd "$WORK_DIR" && jar cfm "../../$DIST_DIR/$APP_NAME.jar" "../../$MANIFEST" .)

echo "Created fat jar: $DIST_DIR/$APP_NAME.jar"
echo "Run with: java -jar $DIST_DIR/$APP_NAME.jar"
