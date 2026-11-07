#!/usr/bin/env bash
# build-list.sh — بيعمل mido.m3u (اللينك اللي في كل الأجهزة) من:
#   1) my-list.m3u   الأفلام والقنوات اللي بتضيفها من «لوحة MIDO»
#   2) lists/*.m3u   ملفات M3U اللي بترفعها
#   3) sources.txt   لينكات قوايم أونلاين بتتنزل من جديد كل مرة (زي القنوات المجانية من Free-TV)
# وبيشيل: التكرار، لينكات يوتيوب (المشغّل مايفتحهاش)، علامات Free-TV (Ⓢ Ⓖ Ⓨ)،
# وأي لينك اشتراك فيه يوزر وباسورد (الـ repo عام، ومينفعش يتنشر فيه بيانات اشتراك).
# بيشتغل لوحده على GitHub كل يوم الساعة ٥ الصبح بتوقيت مصر، وكل ما حاجة من دول تتغيّر.
set -euo pipefail
cd "$(dirname "$0")"
shopt -s nullglob

OUT="${OUT:-mido.m3u}"
INFO="${INFO:-build-info.json}"
CACHE="${CACHE:-.cache}"
FT="https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists"
# لو sources.txt مش موجود بنستخدم دول
DEFAULT_SOURCES=(
  "$FT/playlist_egypt.m3u8"
  "$FT/playlist_zz_news_ar.m3u8"
  "$FT/playlist_zz_documentaries_ar.m3u8"
  "$FT/playlist_saudi_arabia.m3u8"
  "$FT/playlist_united_arab_emirates.m3u8"
)

# لينك اشتراك؟ (يوزر وباسورد جوه اللينك، زي لوحات Xtream)
CRED_ERE='^https?://[^/?#]+/[^/?#]+/[^/?#]+/[0-9]+(\.[a-z0-9]+)?([?#]|$)|/(live|movie|movies|series)/[^/?#]+/[^/?#]+/[0-9]+(\.[a-z0-9]+)?([?#]|$)|/timeshift/[^/?#]+/[^/?#]+/'
is_cred() {
  local u="${1,,}"
  if grep -Eq '[?&](username|user)=[^&#]+' <<<"$u" && grep -Eq '[?&](password|pass)=[^&#]+' <<<"$u"; then return 0; fi
  grep -Eq "$CRED_ERE" <<<"$u"
}
jesc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\037'; }
count() { local n; n="$(grep -c '^#EXTINF' "$1" 2>/dev/null || true)"; echo "${n:-0}"; }

RAW="$(mktemp)"; NEW="$(mktemp)"; TMP="$(mktemp)"; STATS="$(mktemp)"
trap 'rm -f "$RAW" "$NEW" "$TMP" "$STATS"' EXIT
# يضيف ملف للتجميعة (ويشيل BOM من أوله لو موجود)
add() { sed $'1s/^\xef\xbb\xbf//' "$1" >> "$RAW"; echo >> "$RAW"; }

# 1) قايمتك الأول عشان تظهر فوق ولو فيه تكرار تكسب هي
MINE=0
if [ -f my-list.m3u ]; then add my-list.m3u; MINE="$(count my-list.m3u)"; fi

# 2) الملفات المرفوعة
FILES_JSON=""
for f in lists/*.m3u lists/*.m3u8; do
  add "$f"
  FILES_JSON="$FILES_JSON${FILES_JSON:+,}{\"name\":\"$(jesc "${f#lists/}")\",\"count\":$(count "$f")}"
done

# 3) القوايم الأونلاين
SRC=()
if [ -f sources.txt ]; then
  while IFS= read -r l || [ -n "$l" ]; do
    l="$(printf '%s' "$l" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    case "$l" in ''|'#'*) continue ;; esac
    SRC+=("$l")
  done < sources.txt
else
  SRC=("${DEFAULT_SOURCES[@]}")
fi

SELF="${GITHUB_REPOSITORY:-}"; SELF="${SELF#*/}"; SELF="${SELF,,}"
mkdir -p "$CACHE"
KEEP=" "; SRC_JSON=""
for u in "${SRC[@]}"; do
  case "$u" in http://*|https://*) ;; *) echo "لينك مش مقبول (لازم يبدأ بـ http): $u"; continue ;; esac
  if is_cred "$u"; then echo "اتشال لينك اشتراك من sources.txt (فيه يوزر وباسورد)، مش هيتنزل"; continue; fi
  # لينك القايمة نفسها (mido.m3u) مايتضافش جواها
  if [ -n "$SELF" ] && [[ "${u,,}" == */"$SELF"/* ]] && [[ "${u,,}" == */mido.m3u* ]]; then continue; fi
  key="$(printf '%s' "$u" | md5sum | cut -c1-12)"; c="$CACHE/$key.m3u"; KEEP="$KEEP$c "
  st=ok
  if curl -fsSL --proto '=http,https' --proto-redir '=http,https' --max-time 40 --max-filesize 30000000 \
       -A 'mido-lists' -o "$TMP" "$u" && grep -q '^#EXTINF' "$TMP"; then
    cp "$TMP" "$c"
  elif [ -f "$c" ]; then
    st=cached; echo "تعذّر تنزيل $u، استخدمنا آخر نسخة محفوظة منه"
  else
    st=failed; echo "تعذّر تنزيل $u ومفيش نسخة محفوظة منه (اتخطّيناه المرة دي)"
  fi
  n=0
  if [ -f "$c" ]; then add "$c"; n="$(count "$c")"; fi
  SRC_JSON="$SRC_JSON${SRC_JSON:+,}{\"url\":\"$(jesc "$u")\",\"count\":$n,\"status\":\"$st\"}"
done
# النسخ المحفوظة لقوايم اتشالت من sources.txt مالهاش لزمة
for c in "$CACHE"/*.m3u; do case "$KEEP" in *" $c "*) ;; *) rm -f "$c" ;; esac; done

# الدمج
awk -v stats="$STATS" '
  function cred(u) {
    u = tolower(u)
    if (u ~ /[?&](username|user)=[^&#]+/ && u ~ /[?&](password|pass)=[^&#]+/) return 1
    if (u ~ /\/(live|movie|movies|series)\/[^\/?#]+\/[^\/?#]+\/[0-9]+(\.[a-z0-9]+)?([?#]|$)/) return 1
    if (u ~ /^https?:\/\/[^\/?#]+\/[^\/?#]+\/[^\/?#]+\/[0-9]+(\.[a-z0-9]+)?([?#]|$)/) return 1
    if (u ~ /\/timeshift\/[^\/?#]+\/[^\/?#]+\//) return 1
    return 0
  }
  # نفس تقسيم تطبيق MIDO: مسلسلات، بعدين أفلام، والباقي لايف
  function kind(inf, u,   g, n) {
    g = ""; if (match(inf, /group-title="[^"]*"/)) g = substr(inf, RSTART + 13, RLENGTH - 14)
    n = inf; sub(/^.*,/, "", n)
    if (tolower(g " " n) ~ /series|مسلسل|season|s[0-9]+e[0-9]+/) return "series"
    if (tolower(g) ~ /vod|movie|film|فيلم|افلام|أفلام|إفلام|آفلام/ || tolower(u) ~ /\.(mp4|mkv|avi)(\?|$)/) return "movie"
    return "live"
  }
  BEGIN { print "#EXTM3U"; dropped = 0; k["live"] = 0; k["movie"] = 0; k["series"] = 0 }
  { sub(/\r$/, ""); sub(/^[ \t]+/, ""); sub(/[ \t]+$/, "") }
  /^#EXTM3U/ { next }
  /^#EXTINF/ { gsub(/ ?(Ⓢ|Ⓖ|Ⓨ)/, ""); infl = $0; buf = $0 "\n"; inf = 1; next }
  /^#/       { if (inf) buf = buf $0 "\n"; next }
  NF {
    if (inf) {
      if (cred($0)) dropped++
      else if ($0 !~ /^https?:\/\/([a-z0-9-]+\.)?(youtube\.com|youtu\.be)\// && !seen[$0]++) { printf "%s%s\n", buf, $0; k[kind(infl, $0)]++ }
    }
    buf = ""; inf = 0
  }
  END { print dropped, k["live"], k["movie"], k["series"] > stats }
' "$RAW" > "$NEW"

read -r DROPPED LIVE MOVIE SERIES < "$STATS"
if [ "$DROPPED" -gt 0 ]; then echo "اتشال $DROPPED لينك اشتراك (فيهم يوزر وباسورد)"; fi
TOTAL="$(count "$NEW")"
cp "$NEW" "$OUT"
printf '{"total":%d,"live":%d,"movie":%d,"series":%d,"mine":%d,"removed":%d,"files":[%s],"sources":[%s]}\n' \
  "$TOTAL" "$LIVE" "$MOVIE" "$SERIES" "$MINE" "$DROPPED" "$FILES_JSON" "$SRC_JSON" > "$INFO"
echo "تم: $TOTAL قناة/فيلم في $OUT"
