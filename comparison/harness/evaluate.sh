#!/bin/bash
# Same objective gauntlet for every model's submission:
# install → test → build → start → /health → served client → screenshot → soak
RESULTS=/Users/jackychou/splash-critters-llm-comparison/results
EVAL=/private/tmp/claude-501/-Users-jackychou-dondi/4ba8524d-7c29-4114-90a8-dab39e377ab3/scratchpad/eval
mkdir -p "$EVAL"

run_one() {
  local name=$1 port=$2
  local dir="$RESULTS/$name"
  local log="$EVAL/$name.log"
  echo "##### EVAL $name #####" > "$log"
  cd "$dir" || return

  echo "--- STEP install" >> "$log"
  if perl -e 'alarm shift; exec @ARGV' 360 npm install --no-audit --no-fund >> "$log" 2>&1; then
    echo "RESULT install=PASS" >> "$log"
  else
    echo "RESULT install=FAIL" >> "$log"; return
  fi

  echo "--- STEP test" >> "$log"
  if perl -e 'alarm shift; exec @ARGV' 240 npm test >> "$log" 2>&1; then
    echo "RESULT test=PASS" >> "$log"
  else
    echo "RESULT test=FAIL" >> "$log"
  fi

  echo "--- STEP build" >> "$log"
  if perl -e 'alarm shift; exec @ARGV' 240 npm run build >> "$log" 2>&1; then
    echo "RESULT build=PASS" >> "$log"
  else
    echo "RESULT build=FAIL" >> "$log"; return
  fi

  echo "--- STEP start+health" >> "$log"
  mkdir -p /tmp/splash-eval-$name
  PORT=$port DATA_DIR=/tmp/splash-eval-$name npm start >> "$log" 2>&1 &
  local pid=$!
  sleep 4
  local health=$(curl -s -m 3 "http://localhost:$port/health")
  echo "health: $health" >> "$log"
  if echo "$health" | grep -q "ok"; then echo "RESULT health=PASS" >> "$log"; else echo "RESULT health=FAIL" >> "$log"; fi
  local index=$(curl -s -m 3 "http://localhost:$port/")
  if echo "$index" | grep -qi "<canvas\|<div id=\|<script"; then echo "RESULT serves_client=PASS" >> "$log"; else echo "RESULT serves_client=FAIL" >> "$log"; fi

  echo "--- STEP screenshot" >> "$log"
  node /private/tmp/claude-501/-Users-jackychou-dondi/4ba8524d-7c29-4114-90a8-dab39e377ab3/scratchpad/snap.mjs "$port" "$EVAL/$name-title.png" "$EVAL/$name-action.png" >> "$log" 2>&1 \
    && echo "RESULT screenshot=PASS" >> "$log" || echo "RESULT screenshot=FAIL" >> "$log"

  kill $pid 2>/dev/null; pkill -f "PORT=$port" 2>/dev/null; sleep 1
  # kill any node the start script spawned on that port
  lsof -ti :$port | xargs kill 2>/dev/null

  echo "--- STEP soak" >> "$log"
  if node -e "process.exit(require('./package.json').scripts.soak ? 0 : 1)"; then
    if perl -e 'alarm shift; exec @ARGV' 300 npm run soak >> "$log" 2>&1; then echo "RESULT soak=PASS" >> "$log"; else echo "RESULT soak=FAIL" >> "$log"; fi
  else
    echo "RESULT soak=ABSENT" >> "$log"
  fi
  echo "##### DONE $name #####" >> "$log"
}

run_one glm-5.2 4001
run_one kimi-k2.7 4002
run_one kimi-k2.6-agent-swarm 4003
run_one fable-5 4004
echo "ALL EVALS DONE"
grep -H "RESULT" "$EVAL"/*.log
