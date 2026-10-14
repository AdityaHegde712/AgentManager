import json
import os
import subprocess
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

artifact_dir = Path(__file__).resolve().parent
repo_dir = artifact_dir.parent.parent
proof_screenshot = artifact_dir / "composer-selector-verified.png"

# Clean up stale test conversations so test starts with a clean slate
conversations_dir = repo_dir / ".agent-tasks" / "conversations"
if conversations_dir.exists():
    for f in conversations_dir.glob("*.json"):
        try:
            f.unlink()
        except Exception:
            pass

PORT = "4366"
print(f"Starting AgentRunner test server on port {PORT}...", flush=True)
env = os.environ.copy()
env["AGENT_RUNNER_PORT"] = PORT

server_proc = subprocess.Popen(
    ["npx", "tsx", "src/server/main.ts"],
    cwd=str(repo_dir),
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    shell=True,
)

launch_url = None
start_time = time.time()
while time.time() - start_time < 30:
    line = server_proc.stdout.readline()
    if line:
        print(f"[Server] {line.strip()}", flush=True)
        if "OPEN THIS URL:" in line:
            launch_url = line.split("OPEN THIS URL:")[1].strip()
            break
    if server_proc.poll() is not None:
        print("Server exited unexpectedly!", flush=True)
        break

if not launch_url:
    print("Failed to get launch URL!", flush=True)
    if server_proc.poll() is None:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(server_proc.pid)], capture_output=True)
    sys.exit(1)

print(f"Server ready at: {launch_url}", flush=True)

console_logs = []
page_errors = []

try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()

        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: page_errors.append(f"[pageerror] {str(err)}"))
        page.on("dialog", lambda dialog: dialog.accept())

        print("\n=== STEP 1: Load web interface ===", flush=True)
        page.goto(launch_url, wait_until="networkidle")
        page.wait_for_timeout(1000)

        # Step 2: Verify composer workspace selector exists
        print("\n=== STEP 2: Verify and select workspace from composer dropdown ===", flush=True)
        composer_select = page.locator("#composer-project-select")
        page.wait_for_selector("#composer-project-select", timeout=10000)
        assert composer_select.is_visible(), "Composer workspace selector dropdown should be visible"

        # Wait for options to load
        page.wait_for_selector("#composer-project-select option[value='agent-runner']", state="attached", timeout=15000)
        composer_select.select_option("agent-runner")
        page.wait_for_timeout(500)
        selected_value = composer_select.input_value()
        print(f"Selected workspace in composer: '{selected_value}'", flush=True)
        assert selected_value == "agent-runner", f"Expected selected workspace 'agent-runner', got '{selected_value}'"

        # Step 3: Enter the deliverable
        print("\n=== STEP 3: Enter deliverable in composer ===", flush=True)
        deliverable_text = (
            "I wanna continue work on the agent runner project. "
            "The next step is beginning to lay the foundations of context management "
            "for long running interactions between the agent runner and the coding agent"
        )
        deliverable_input = page.locator("#deliverable")
        deliverable_input.fill(deliverable_text)

        submit_btn = page.locator(".composer button[type='submit']")
        assert not submit_btn.is_disabled(), "Submit button should be enabled"
        print(f"Submit button text: '{submit_btn.text_content().strip()}'", flush=True)
        assert "Draft continuation brief" in submit_btn.text_content(), "Submit button should offer to draft continuation brief"
        submit_btn.click()
        print("Deliverable submitted. Waiting for brief preparation...", flush=True)

        # Step 4: Assertions
        print("\n=== STEP 4: Assert absence of false-positive candidate cards ===", flush=True)
        # Give page a moment to process submission
        page.wait_for_timeout(2000)

        # a) Assert no false-positive candidate cards for 'work' or 'needs'
        inference_cards = page.locator(".inference-card").all()
        for card in inference_cards:
            card_text = card.text_content().lower()
            print(f"Checking card text: {card_text}", flush=True)
            assert "work" not in card_text or "agent runner" in card_text, (
                f"Unexpected false-positive candidate card for 'work': {card_text}"
            )
            assert "needs" not in card_text, f"Unexpected candidate card for 'needs': {card_text}"

        unregistered_cards = page.locator(".inference-card[aria-label='Unregistered project registration']").all()
        assert len(unregistered_cards) == 0, f"Expected 0 unregistered candidate cards, found {len(unregistered_cards)}"
        print("Confirmed: No false-positive candidate cards generated.", flush=True)

        # b) Direct preparation of continuation brief for the selected workspace
        print("\n=== STEP 5: Assert direct preparation of continuation brief ===", flush=True)
        page.wait_for_selector(".response-card[aria-label='Draft continuation brief']", timeout=60000)
        brief_textarea = page.locator("textarea[aria-label='Draft continuation brief']")
        page.wait_for_selector("textarea[aria-label='Draft continuation brief']", timeout=15000)

        # Wait a short moment for content to be completely filled / streamed
        page.wait_for_timeout(2000)
        brief_content = brief_textarea.input_value()
        print(f"Brief content length: {len(brief_content)} chars", flush=True)
        print(f"Full brief content:\n{repr(brief_content)}", flush=True)
        assert len(brief_content.strip()) > 0, "Continuation brief should not be empty"

        # c) Content contains no <dots_function_call> tags
        print("\n=== STEP 6: Assert content contains no toolcall XML tags ===", flush=True)
        assert "<dots_function_call>" not in brief_content, "Brief contains forbidden <dots_function_call> tag"
        assert "</dots_function_call>" not in brief_content, "Brief contains forbidden </dots_function_call> tag"
        assert "<invoke" not in brief_content, "Brief contains forbidden <invoke> tag"
        assert "<function_calls>" not in brief_content, "Brief contains forbidden <function_calls> tag"
        print("Confirmed: Brief is clean Markdown without toolcall tags.", flush=True)

        # Step 7: Capture proof screenshot
        print(f"\n=== STEP 7: Capture proof screenshot at {proof_screenshot} ===", flush=True)
        page.screenshot(path=str(proof_screenshot))
        assert proof_screenshot.exists(), f"Proof screenshot was not created at {proof_screenshot}"
        print(f"Proof screenshot successfully saved ({proof_screenshot.stat().st_size} bytes).", flush=True)

        print("\nALL VERIFICATIONS PASSED SUCCESSFULLY!", flush=True)

finally:
    if server_proc.poll() is None:
        print("Stopping test server...", flush=True)
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(server_proc.pid)], capture_output=True)
