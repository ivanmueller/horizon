#!/usr/bin/env bash
# Horizon — synthetic attribution test (no purchase, no Stripe, no Bokun hold).
#
# Drives the REAL worker endpoints with fabricated-but-valid data to exercise
# the full attribution path: funnel capture -> attr: KV -> resolveCredit ->
# booking_touchpoints -> credited flag -> audit columns -> dashboard.
#
# It does NOT touch the payment integration (unchanged by this work).
# It DOES write one row into Supabase `bookings` (+ touchpoints), clearly
# marked with a TEST- confirmation code and cleaned up by one SQL line.
#
# Usage:
#   scripts/horizon/test-attribution.sh -H <hotel-slug> [-e <employee-code>] [-b <api-base>]
#
#   -H  hotel slug, must exist in hotels.code            (required)
#   -e  an ACTIVE hotel_staff.tracking_code at that hotel (optional —
#       omit to test the hotel-pool path instead of employee crediting)
#   -b  worker API base (default: production worker)
#
# Example:
#   scripts/horizon/test-attribution.sh -H fairmont-ll -e htl-7q4k9-e001

set -euo pipefail

API_BASE="https://horizon-bokun.ivan-mueller02.workers.dev"
HOTEL=""
EMP=""

while getopts "H:e:b:h" opt; do
  case "$opt" in
    H) HOTEL="$OPTARG" ;;
    e) EMP="$OPTARG" ;;
    b) API_BASE="$OPTARG" ;;
    h) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "see -h for usage" >&2; exit 2 ;;
  esac
done

if [[ -z "$HOTEL" ]]; then
  echo "error: -H <hotel-slug> is required (see -h)" >&2
  exit 2
fi

CONF="TEST-$(date +%s)"
T0=$(( ( $(date +%s) - 86400 ) * 1000 ))   # "scanned" 1 day ago
T1=$(( $(date +%s) * 1000 ))               # "employee link" now

# Build the funnel: hotel card scanned first, then (optionally) an
# employee link clicked — exactly the override scenario.
if [[ -n "$EMP" ]]; then
  TOUCHPOINTS="[
    {\"code\":\"$HOTEL\",\"stream\":\"hotel-slug\",\"ts\":$T0,\"page\":\"/tours/test/\"},
    {\"code\":\"$EMP\",\"stream\":\"employee\",\"ts\":$T1,\"page\":\"/tours/test/\",\"kind\":\"ref\"}
  ]"
  REF="$EMP"
  EXPECT="employee \"$EMP\" credited (is_credited at position 1), first_touch_code=$HOTEL"
else
  TOUCHPOINTS="[
    {\"code\":\"$HOTEL\",\"stream\":\"hotel-slug\",\"ts\":$T0,\"page\":\"/tours/test/\"}
  ]"
  REF="null"
  EXPECT="hotel-pool attribution (staff_id NULL), first_touch_code=$HOTEL"
fi
[[ "$REF" != "null" ]] && REF="\"$REF\""

echo "→ Step 1: /api/booking/initiate (no payment — just the state pouch)"
INIT=$(curl -fsS -X POST "$API_BASE/api/booking/initiate" \
  -H 'Content-Type: application/json' \
  -d "{
    \"tour_id\": 12345, \"date\": \"2026-07-01\", \"adults\": 2,
    \"hotel\": \"$HOTEL\", \"ref\": $REF,
    \"funnel\": { \"first_ts\": $T0, \"last_ts\": $T1, \"touchpoints\": $TOUCHPOINTS }
  }")
BID=$(printf '%s' "$INIT" | grep -o '"booking_id":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$BID" ]]; then
  echo "  ✗ no booking_id returned: $INIT" >&2
  exit 1
fi
echo "  booking_id = $BID"

echo "→ Step 2: /api/dashboard/record (simulates the post-confirmation ledger write)"
REC=$(curl -fsS -X POST "$API_BASE/api/dashboard/record" \
  -H 'Content-Type: application/json' \
  -d "{
    \"booking_id\": \"$BID\", \"confirmation_code\": \"$CONF\", \"hotel\": \"$HOTEL\",
    \"tour_id\": 12345, \"tour_title\": \"TEST tour\", \"date\": \"2026-07-01\",
    \"adults\": 2, \"amount\": 199.0, \"currency\": \"CAD\",
    \"lead_name\": \"Test Guest\", \"lead_email\": \"test@example.com\"
  }")
echo "  response = $REC"

cat <<EOF

✓ Injected. Confirmation code: $CONF
  Expected: $EXPECT

Verify (Supabase SQL editor):

  select confirmation_code, staff_id, attribution_policy_used,
         first_touch_code, credited_position
    from bookings where confirmation_code = '$CONF';

  select position, stream_type, code, is_credited
    from booking_touchpoints where confirmation_code = '$CONF'
    order by position;

…and check the hotel dashboard "Source" column for '$HOTEL' — the
booking should show the expandable funnel timeline.

Clean up when done (FK cascades the touchpoints):

  delete from bookings where confirmation_code = '$CONF';
EOF
