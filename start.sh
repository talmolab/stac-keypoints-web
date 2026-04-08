#!/usr/bin/env bash
# Start STAC Retarget UI (backend + frontend) in a tmux session.
# Usage: ./start.sh [--no-tmux]

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# --- Configuration (override via env vars if your paths differ) ---
# VENV: path to a virtualenv 'activate' script. If unset, uses current Python env.
VENV="${VENV:-}"
# MONSEES_RETARGET: optional path to monsees-retarget checkout (enables ACM features).
MONSEES_RETARGET="${MONSEES_RETARGET:-}"
BACKEND_PORT=8000
FRONTEND_PORT=5173
# -------------------------------------------------------

# Check dependencies
if ! command -v node &>/dev/null; then
    echo "Error: Node.js not found. Install via: https://nodejs.org/ or nvm"
    exit 1
fi
if [ -n "$VENV" ] && [ ! -f "$VENV" ]; then
    echo "Error: Python venv not found at $VENV"
    echo "Unset VENV to use the current Python environment, or point it at a valid activate script."
    exit 1
fi
export MONSEES_RETARGET

# Install frontend deps if needed
if [ ! -d frontend/node_modules ]; then
    echo "Installing frontend dependencies..."
    cd frontend && npm install && cd ..
fi

# Install backend in dev mode if needed
[ -n "$VENV" ] && source "$VENV"
pip show stac-keypoints-web &>/dev/null 2>&1 || pip install -e ".[dev]"

# Auto-fallback to --no-tmux if tmux is not installed
if [ "$1" != "--no-tmux" ] && ! command -v tmux &>/dev/null; then
    echo "Note: tmux not found, running without tmux. (Install tmux for split-pane mode.)"
    set -- --no-tmux
fi

if [ "$1" = "--no-tmux" ]; then
    # Run without tmux (two background processes)
    echo "Starting backend on :$BACKEND_PORT and frontend on :$FRONTEND_PORT ..."
    PYTHONPATH="$MONSEES_RETARGET:$PYTHONPATH" uvicorn backend.app:app --reload --host 0.0.0.0 --port $BACKEND_PORT &
    BACKEND_PID=$!
    cd frontend && npx vite --host 0.0.0.0 --port $FRONTEND_PORT &
    FRONTEND_PID=$!
    echo ""
    echo "  Backend:  http://localhost:$BACKEND_PORT"
    echo "  Frontend: http://localhost:$FRONTEND_PORT"
    echo ""
    echo "Press Ctrl+C to stop."
    trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
    wait
else
    SESSION="stac-retarget-ui"

    # Kill existing session if any
    tmux kill-session -t "$SESSION" 2>/dev/null || true

    # Create tmux session with backend in pane 0
    tmux new-session -d -s "$SESSION" -n "servers" \
        "source $VENV && PYTHONPATH=$MONSEES_RETARGET:\$PYTHONPATH uvicorn backend.app:app --reload --host 0.0.0.0 --port $BACKEND_PORT; read"

    # Split and run frontend in pane 1
    tmux split-window -t "$SESSION" -h \
        "cd $SCRIPT_DIR/frontend && export NVM_DIR=\$HOME/.nvm && [ -s \$NVM_DIR/nvm.sh ] && . \$NVM_DIR/nvm.sh; npx vite --host 0.0.0.0 --port $FRONTEND_PORT; read"

    echo ""
    echo "  STAC Retarget UI started in tmux session '$SESSION'"
    echo ""
    echo "  Backend:  http://localhost:$BACKEND_PORT"
    echo "  Frontend: http://localhost:$FRONTEND_PORT"
    echo ""
    echo "  Attach: tmux attach -t $SESSION"
    echo "  Stop:   tmux kill-session -t $SESSION"
    echo ""

    # Attach to the session
    tmux attach -t "$SESSION"
fi
