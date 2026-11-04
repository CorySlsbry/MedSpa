#!/usr/bin/env bash
# Jarvis dedup endpoint acceptance suite. Runs all 18 documented tests
# against the dev server. Cleans up nothing — assumes a sandbox tenant
# or you don't mind a few `acc-<epoch>-*@example.com` leads sticking
# around for verification.

set -u
T="${T:-}"
BASE="${BASE:-http://localhost:3465}"
PASS=0
FAIL=0

if [ -z "$T" ]; then
  echo "Set T=<jarvis bearer> first." >&2
  exit 1
fi

# JSON parser: prints the field's JSON value with surrounding quotes
# stripped from strings. null prints as "null", missing as "__missing__".
NJQ() {
  node -e "
    let s='';
    process.stdin.on('data',c=>s+=c);
    process.stdin.on('end',()=>{
      try {
        const d=JSON.parse(s);
        const v=eval('d.'+process.argv[1]);
        console.log(v===undefined ? '__missing__' : JSON.stringify(v).replace(/^\"|\"\$/g,''));
      } catch(e) { console.log('__err__'); }
    });
  " "$1"
}

report() {
  local n="$1" desc="$2" ok="$3"
  if [ "$ok" = "1" ]; then
    PASS=$((PASS+1))
    echo "PASS  $n. $desc"
  else
    FAIL=$((FAIL+1))
    echo "FAIL  $n. $desc"
  fi
}

RUN=$(date +%s)
PHONE_BASE=801555
PHONE_TAIL=$(printf '%04d' $((RUN % 10000)))
PHONE="${PHONE_BASE}${PHONE_TAIL}"

# ── 1. First insert ──
T1=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"contact\":{\"email\":\"acc-$RUN-1@example.com\",\"full_name\":\"Acc Run $RUN\"},\"company\":{\"name\":\"Acc Run $RUN Med Spa\",\"type\":\"med_spa\"},\"lead\":{\"source\":\"cold\"}}" \
  "$BASE/api/integrations/jarvis/leads")
T1_FRESH=$(echo "$T1" | NJQ is_fresh_insert)
T1_SIG=$(echo "$T1" | NJQ match_signal)
T1_QEMAIL=$(echo "$T1" | NJQ "dedup_qualifiers.email_normalized")
LEAD1=$(echo "$T1" | NJQ lead_id)
if [ "$T1_FRESH" = "true" ] && [ "$T1_SIG" = "null" ] && [ "$T1_QEMAIL" = "acc-$RUN-1@example.com" ]; then
  report 1 "First insert: fresh=true, signal=null, qualifiers populated" 1
else
  report 1 "First insert" 0
  echo "  T1_FRESH=$T1_FRESH T1_SIG=$T1_SIG T1_QEMAIL=$T1_QEMAIL"
fi

# ── 2. Same email → merge ──
T2=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"contact\":{\"email\":\"acc-$RUN-1@example.com\",\"full_name\":\"Acc Run $RUN\"},\"company\":{\"name\":\"Acc Run $RUN Med Spa\",\"type\":\"med_spa\"},\"lead\":{\"source\":\"cold\"}}" \
  "$BASE/api/integrations/jarvis/leads")
T2_LEAD=$(echo "$T2" | NJQ lead_id)
T2_SIG=$(echo "$T2" | NJQ match_signal)
T2_FRESH=$(echo "$T2" | NJQ is_fresh_insert)
if [ "$T2_LEAD" = "$LEAD1" ] && [ "$T2_SIG" = "email_normalized" ] && [ "$T2_FRESH" = "false" ]; then
  report 2 "Same email -> merge" 1
else
  report 2 "Same email" 0
  echo "  raw=$T2"
fi

# ── 3. Apollo dedup ──
APOLLO_ID="apollo-$RUN"
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"contact\":{\"email\":\"acc-$RUN-3a@example.com\",\"full_name\":\"AccApollo $RUN\",\"apollo_person_id\":\"$APOLLO_ID\"},\"company\":{\"name\":\"AccApollo $RUN Co\",\"type\":\"med_spa\"},\"lead\":{\"source\":\"cold\"}}" \
  "$BASE/api/integrations/jarvis/leads" > /tmp/t3a.json
LEAD3=$(cat /tmp/t3a.json | NJQ lead_id)
T3B=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"contact\":{\"email\":\"acc-$RUN-3b@example.com\",\"full_name\":\"AccApollo $RUN\",\"apollo_person_id\":\"$APOLLO_ID\"},\"company\":{\"name\":\"AccApollo $RUN Co\",\"type\":\"med_spa\"},\"lead\":{\"source\":\"cold\"}}" \
  "$BASE/api/integrations/jarvis/leads")
T3B_LEAD=$(echo "$T3B" | NJQ lead_id)
T3B_SIG=$(echo "$T3B" | NJQ match_signal)
if [ "$T3B_LEAD" = "$LEAD3" ] && [ "$T3B_SIG" = "apollo_person_id" ]; then
  report 3 "Apollo dedup across emails" 1
else
  report 3 "Apollo dedup" 0
  echo "  raw=$T3B"
fi

# ── 4. name_company_key with LLC suffix difference ──
COMP_BASE="Acme Spa $RUN"
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"contact\":{\"email\":\"acc-$RUN-4a@example.com\",\"first_name\":\"Run$RUN\",\"last_name\":\"Suffix\"},\"company\":{\"name\":\"$COMP_BASE\",\"type\":\"med_spa\"},\"lead\":{\"source\":\"cold\"}}" \
  "$BASE/api/integrations/jarvis/leads" > /tmp/t4a.json
LEAD4=$(cat /tmp/t4a.json | NJQ lead_id)
T4B=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"contact\":{\"email\":\"acc-$RUN-4b@example.com\",\"first_name\":\"Run$RUN\",\"last_name\":\"Suffix\"},\"company\":{\"name\":\"$COMP_BASE, LLC\",\"type\":\"med_spa\"},\"lead\":{\"source\":\"cold\"}}" \
  "$BASE/api/integrations/jarvis/leads")
T4B_LEAD=$(echo "$T4B" | NJQ lead_id)
T4B_SIG=$(echo "$T4B" | NJQ match_signal)
if [ "$T4B_LEAD" = "$LEAD4" ] && [ "$T4B_SIG" = "name_company_key" ]; then
  report 4 "name_company_key tolerates LLC suffix" 1
else
  report 4 "name_company_key" 0
  echo "  raw=$T4B"
fi

# ── 5. Workflow idempotency (same lead, two calls, same enroll list) ──
T5A=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"contact\":{\"email\":\"acc-$RUN-5@example.com\",\"full_name\":\"Wf Idem $RUN\"},\"company\":{\"name\":\"Wf $RUN Co\",\"type\":\"med_spa\"},\"lead\":{\"source\":\"cold\"}}" \
  "$BASE/api/integrations/jarvis/leads")
T5B=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"contact\":{\"email\":\"acc-$RUN-5@example.com\",\"full_name\":\"Wf Idem $RUN\"},\"company\":{\"name\":\"Wf $RUN Co\",\"type\":\"med_spa\"},\"lead\":{\"source\":\"cold\"}}" \
  "$BASE/api/integrations/jarvis/leads")
T5A_LEAD=$(echo "$T5A" | NJQ lead_id)
T5B_LEAD=$(echo "$T5B" | NJQ lead_id)
T5B_FRESH=$(echo "$T5B" | NJQ is_fresh_insert)
if [ "$T5A_LEAD" = "$T5B_LEAD" ] && [ "$T5B_FRESH" = "false" ]; then
  report 5 "Workflow idempotency: same lead_id, second call merge" 1
else
  report 5 "Workflow idempotency" 0
  echo "  T5A=$T5A_LEAD T5B=$T5B_LEAD T5B_FRESH=$T5B_FRESH"
fi

# ── 6. /match by known email ──
M6=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"email\":\"acc-$RUN-1@example.com\"}" "$BASE/api/integrations/jarvis/leads/match")
M6_MATCHED=$(echo "$M6" | NJQ matched)
M6_SIG=$(echo "$M6" | NJQ signal)
if [ "$M6_MATCHED" = "true" ] && [ "$M6_SIG" = "email_normalized" ]; then
  report 6 "/match by email" 1
else
  report 6 "/match by email" 0
  echo "  M6=$M6"
fi

# ── 7. /match unknown email ──
M7=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"email":"person1@example.com"}' "$BASE/api/integrations/jarvis/leads/match")
if [ "$(echo "$M7" | NJQ matched)" = "false" ]; then
  report 7 "/match unknown -> false" 1
else
  report 7 "/match unknown" 0
  echo "  M7=$M7"
fi

# ── 8. /match by name + company alone ──
M8=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"first_name\":\"Run$RUN\",\"last_name\":\"Suffix\",\"company_name\":\"$COMP_BASE\"}" \
  "$BASE/api/integrations/jarvis/leads/match")
if [ "$(echo "$M8" | NJQ signal)" = "name_company_key" ]; then
  report 8 "/match by name+company" 1
else
  report 8 "/match by name+company" 0
  echo "  M8=$M8"
fi

# ── 9. /match by phone, format-tolerant ──
PHONE_FMT="+1 (${PHONE:0:3}) ${PHONE:3:3}-${PHONE:6:4}"
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"contact\":{\"email\":\"acc-$RUN-9@example.com\",\"full_name\":\"Phone Run $RUN\",\"phone\":\"$PHONE_FMT\"},\"company\":{\"name\":\"Phone $RUN Co\",\"type\":\"med_spa\"},\"lead\":{\"source\":\"cold\"}}" \
  "$BASE/api/integrations/jarvis/leads" > /dev/null
M9=$(curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"phone\":\"$PHONE\"}" "$BASE/api/integrations/jarvis/leads/match")
if [ "$(echo "$M9" | NJQ signal)" = "phone_digits" ]; then
  report 9 "/match by phone format-tolerant" 1
else
  report 9 "/match by phone" 0
  echo "  M9=$M9"
fi

# ── 10. GET Mode A by email ──
G10=$(curl -s -H "Authorization: Bearer $T" "$BASE/api/integrations/jarvis/leads?email=acc-$RUN-1@example.com")
G10_FOUND=$(echo "$G10" | NJQ found)
G10_QEMAIL=$(echo "$G10" | NJQ "lead.dedup_qualifiers.email_normalized")
if [ "$G10_FOUND" = "true" ] && [ "$G10_QEMAIL" = "acc-$RUN-1@example.com" ]; then
  report 10 "GET Mode A by email returns full lead + qualifiers" 1
else
  report 10 "GET Mode A" 0
  echo "  G10=$G10"
fi

# ── 11. GET Mode A unknown email ──
G11=$(curl -s -H "Authorization: Bearer $T" "$BASE/api/integrations/jarvis/leads?email=nobody-$person2@example.com")
if [ "$(echo "$G11" | NJQ found)" = "false" ]; then
  report 11 "GET Mode A unknown -> found:false" 1
else
  report 11 "GET unknown" 0
  echo "  G11=$G11"
fi

# ── 12. GET Mode C since-cursor pagination ──
G12=$(curl -s -H "Authorization: Bearer $T" "$BASE/api/integrations/jarvis/leads?since=2026-05-01T00:00:00Z&limit=2")
G12_COUNT=$(echo "$G12" | NJQ count)
G12_MORE=$(echo "$G12" | NJQ has_more)
G12_CURSOR=$(echo "$G12" | NJQ next_cursor)
if [ "$G12_COUNT" = "2" ] && [ "$G12_MORE" = "true" ] && [ -n "$G12_CURSOR" ] && [ "$G12_CURSOR" != "null" ] && [ "$G12_CURSOR" != "__missing__" ]; then
  report 12 "GET Mode C since-cursor" 1
else
  report 12 "GET Mode C" 0
  echo "  count=$G12_COUNT more=$G12_MORE cursor=$G12_CURSOR"
fi

# ── 13. GET Mode C without since -> 400 ──
G13=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $T" "$BASE/api/integrations/jarvis/leads")
if [ "$G13" = "400" ]; then
  report 13 "GET without since -> 400" 1
else
  report 13 "GET no since" 0
  echo "  code=$G13"
fi

# ── 14. Missing Bearer -> 401 on all three ──
A14_POST=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{}' "$BASE/api/integrations/jarvis/leads")
A14_MATCH=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{}' "$BASE/api/integrations/jarvis/leads/match")
A14_GET=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/integrations/jarvis/leads?email=person3@example.com")
if [ "$A14_POST" = "401" ] && [ "$A14_MATCH" = "401" ] && [ "$A14_GET" = "401" ]; then
  report 14 "Missing Bearer -> 401 on all three" 1
else
  report 14 "Bearer 401" 0
  echo "  POST=$A14_POST /match=$A14_MATCH GET=$A14_GET"
fi

echo
echo "TOTAL: PASS=$PASS  FAIL=$FAIL"
[ "$FAIL" = "0" ]
