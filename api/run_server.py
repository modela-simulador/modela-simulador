"""
Resilient server runner for BatucoTerra API.
Automatically restarts uvicorn if it crashes, with configurable retry logic.
Usage: python3 run_server.py
"""
import subprocess
import sys
import time
import signal
import os

# ── Configuration ──────────────────────────────────────────────
HOST = "0.0.0.0"
PORT = 8000
MAX_RAPID_RESTARTS = 5       # max crashes within the window before cooldown
RAPID_WINDOW_SECONDS = 30    # time window to count rapid restarts
COOLDOWN_SECONDS = 10        # pause before retrying after rapid crashes
# ───────────────────────────────────────────────────────────────

_stop = False


def _handle_signal(signum, frame):
    global _stop
    print(f"\n[runner] Received signal {signum}, shutting down gracefully...")
    _stop = True


signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


def run():
    restart_times: list[float] = []

    while not _stop:
        now = time.time()
        # Track restart frequency
        restart_times = [t for t in restart_times if now - t < RAPID_WINDOW_SECONDS]
        restart_times.append(now)

        if len(restart_times) > MAX_RAPID_RESTARTS:
            print(f"[runner] Server crashed {MAX_RAPID_RESTARTS} times in "
                  f"{RAPID_WINDOW_SECONDS}s. Cooling down {COOLDOWN_SECONDS}s...")
            print("[runner] Fix the error above, then the server will auto-restart.")
            time.sleep(COOLDOWN_SECONDS)
            restart_times.clear()
            continue

        print(f"[runner] Starting uvicorn on {HOST}:{PORT} (with --reload)...")
        try:
            proc = subprocess.Popen(
                [
                    sys.executable, "-m", "uvicorn",
                    "main:app",
                    "--host", HOST,
                    "--port", str(PORT),
                    "--reload",
                    "--reload-delay", "1.0",     # wait 1s before reloading (debounce)
                    "--timeout-keep-alive", "120" # longer keep-alive for big requests
                ],
                cwd=os.path.dirname(os.path.abspath(__file__)) or ".",
            )
            proc.wait()
            exit_code = proc.returncode
        except Exception as e:
            print(f"[runner] Failed to start uvicorn: {e}")
            exit_code = 1

        if _stop:
            break

        if exit_code == 0:
            print("[runner] Server exited cleanly (code 0).")
            break
        else:
            print(f"[runner] Server exited with code {exit_code}. Restarting in 2s...")
            time.sleep(2)

    print("[runner] Runner stopped.")


if __name__ == "__main__":
    run()
