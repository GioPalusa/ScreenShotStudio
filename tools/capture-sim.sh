#!/usr/bin/env bash
# Guided screenshot capture from the iOS Simulator straight into the Studio's captures folder.
#
#   tools/capture-sim.sh --device iphone    --screens timeline,trips,memories
#   tools/capture-sim.sh --device duo-outer --screens timeline --locale sv
#   tools/capture-sim.sh --device duo-inner --screens timeline,trips --yes
#
# Options
#   --device   iphone | ipad | duo-inner | duo-outer     which Studio device these captures are for (required)
#   --screens  comma-separated screen names, saved as <name>.png
#              default: timeline,trips,memories,progress,worldmap,trip-memory
#   --locale   e.g. sv, de-DE, ja: relaunch the app in that language and save under captures/<locale>/
#              (omit it for the shared captures that every language uses)
#   --udid     simulator UDID (default: the booted simulator whose screen matches --device)
#   --yes      capture immediately instead of waiting for Return after each screen
#   --out      captures folder (default: ../project/captures next to this script)
#   --no-status-bar   leave the status bar alone (default: 9:41, full battery, full signal)
#
# Needs Xcode's command line tools. Nothing here touches your app data.

set -euo pipefail

BUNDLE_ID="se.palusa.wherehaveibeen"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../project/captures"
DEVICE=""; SCREENS="timeline,trips,memories,progress,worldmap,trip-memory"; LOCALE=""; UDID=""; YES=0; STATUS_BAR=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) DEVICE="$2"; shift 2 ;;
    --screens) SCREENS="$2"; shift 2 ;;
    --locale) LOCALE="$2"; shift 2 ;;
    --udid) UDID="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    --no-status-bar) STATUS_BAR=0; shift ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

# Pixel sizes App Store Connect accepts for each device (and the simulators produce).
case "$DEVICE" in
  iphone)    SIZES=("1206x2622" "1320x2868" "1179x2556" "1290x2796") ;;
  ipad)      SIZES=("1640x2360" "1668x2420" "2064x2752" "2048x2732" "1668x2388") ;;
  duo-inner) SIZES=("2007x2853" "2853x2007") ;;
  duo-outer) SIZES=("1398x2034" "2034x1398") ;;
  *) echo "Please pass --device iphone|ipad|duo-inner|duo-outer" >&2; exit 2 ;;
esac

apple_locale() {
  case "$1" in
    en-US) echo "en_US" ;; en-GB) echo "en_GB" ;; sv) echo "sv_SE" ;; de-DE) echo "de_DE" ;; fr-FR) echo "fr_FR" ;;
    es-ES) echo "es_ES" ;; it) echo "it_IT" ;; pt-PT) echo "pt_PT" ;; pt-BR) echo "pt_BR" ;; ru) echo "ru_RU" ;;
    ja) echo "ja_JP" ;; ko) echo "ko_KR" ;; zh-Hans) echo "zh_CN" ;; hi) echo "hi_IN" ;; he) echo "he_IL" ;; ar-SA) echo "ar_SA" ;;
    *) echo "${1//-/_}" ;;
  esac
}

# simctl occasionally hangs on a display that doesn't exist, so every call gets a timeout.
shot() { # <udid> <display|""> <file>
  perl -e 'my $pid = fork(); if (!$pid) { exec @ARGV } $SIG{ALRM} = sub { kill 9, $pid; exit 124 }; alarm 10; waitpid($pid, 0); exit($? >> 8)' \
    xcrun simctl io "$1" screenshot --type=png ${2:+--display="$2"} "$3" >/dev/null 2>&1
}
dims() { sips -g pixelWidth -g pixelHeight "$1" 2>/dev/null | awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w "x" h}'; }
matches() { local d="$1"; for s in "${SIZES[@]}"; do [[ "$d" == "$s" ]] && return 0; done; return 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# --- find the simulator and display that match the chosen device ---------------------------------
DISPLAY_ID=""
if [[ -n "$UDID" ]]; then
  CANDIDATES="$UDID"
else
  # only look at booted simulators of the right kind, so we never wait on an unrelated device
  case "$DEVICE" in
    iphone) booted="$(xcrun simctl list devices booted | grep -E '^ *iPhone' | grep -v 'Duo' || true)" ;;
    ipad) booted="$(xcrun simctl list devices booted | grep -E '^ *iPad' || true)" ;;
    *) booted="$(xcrun simctl list devices booted | grep -E '^ *iPhone Duo' || true)" ;;
  esac
  CANDIDATES="$(grep -Eo '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}' <<< "$booted" || true)"
fi
[[ -n "$CANDIDATES" ]] || { echo "No booted simulator for $DEVICE. Boot one in Xcode or Simulator.app first (or pass --udid)." >&2; exit 1; }
for candidate in $CANDIDATES; do
  for display in internal 1 3 ""; do
    probe="$TMP/probe.png"; rm -f "$probe"
    if shot "$candidate" "$display" "$probe" && matches "$(dims "$probe")"; then UDID="$candidate"; DISPLAY_ID="$display"; break 2; fi
  done
done
[[ -n "$UDID" ]] || { echo "No booted simulator has a ${DEVICE} screen (expected one of: ${SIZES[*]})." >&2; exit 1; }
echo "Using simulator $UDID${DISPLAY_ID:+ (display $DISPLAY_ID)} for $DEVICE"

# --- language + status bar -----------------------------------------------------------------------
if [[ -n "$LOCALE" ]]; then
  base="${LOCALE%%-*}"; lang="$LOCALE"; [[ "$LOCALE" == "zh-Hans" || "$LOCALE" == pt-* || "$LOCALE" == en-* ]] || lang="$base"
  echo "Relaunching the app in $LOCALE"
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl launch "$UDID" "$BUNDLE_ID" -AppleLanguages "($lang)" -AppleLocale "$(apple_locale "$LOCALE")" >/dev/null
  sleep 2
fi
if [[ "$STATUS_BAR" == 1 ]]; then
  xcrun simctl status_bar "$UDID" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 >/dev/null 2>&1 || true
  trap 'xcrun simctl status_bar "$UDID" clear >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
fi

# --- capture -------------------------------------------------------------------------------------
SCOPE="${LOCALE:-default}"
DEST="$OUT/$SCOPE/$DEVICE"
mkdir -p "$DEST"
IFS=',' read -r -a NAMES <<< "$SCREENS"
for name in "${NAMES[@]}"; do
  if [[ "$YES" != 1 ]]; then
    read -r -p "-> Open the '$name' screen in the simulator, then press Return to capture (s = skip, q = quit): " answer
    [[ "$answer" == "q" ]] && break
    [[ "$answer" == "s" ]] && continue
  fi
  file="$TMP/$name.png"
  if ! shot "$UDID" "$DISPLAY_ID" "$file"; then echo "   could not capture $name" >&2; continue; fi
  d="$(dims "$file")"
  matches "$d" || echo "   note: $name is $d, which is not a standard $DEVICE size (the Studio will crop it to fit)"
  cp "$file" "$DEST/$name.png"
  echo "   saved ${DEST#"$HERE/../"}/$name.png ($d)"
done
echo "Done. Refresh the Studio (or just look: it reloads automatically)."
