import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

artifact_dir = Path(__file__).resolve().parent
repo_dir = artifact_dir.parent.parent
proof_screenshot = artifact_dir / "sprint2-phase3-verified.png"

PORT = "4357"
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
        page.on("request", lambda req: print(f"-> {req.method} {req.url}", flush=True))
        page.on("response", lambda res: print(f"<- {res.status} {res.url}", flush=True))

        # Step 1: Navigate to launch URL with capstone project
        print("\n=== STEP 1: Navigating to launch URL with project 'capstone' ===", flush=True)
        parsed = urlparse(launch_url)
        target_url = f"{parsed.scheme}://{parsed.netloc}/?project=capstone#{parsed.fragment}"
        print(f"Target URL: {target_url}", flush=True)
        page.goto(target_url, wait_until="networkidle")
        page.wait_for_timeout(1000)

        # Step 2: Submit a deliverable to draft a brief
        print("\n=== STEP 2: Submitting deliverable prompt ===", flush=True)
        test_prompt = "Implement Sprint 2 Phase 3 interactive Codex launch configuration modal"
        deliverable_input = page.locator("#deliverable")
        assert deliverable_input.is_visible(), "Deliverable textarea should be visible"
        deliverable_input.fill(test_prompt)

        submit_btn = page.locator(".composer button[type='submit']")
        assert not submit_btn.is_disabled(), "Submit button should be enabled"
        submit_btn.click()

        print("Waiting for brief synthesis (waiting for Draft continuation brief card)...", flush=True)
        try:
            page.wait_for_selector(".response-card[aria-label='Draft continuation brief']", timeout=60000)
            page.wait_for_timeout(1000)
        except Exception as e:
            print(f"Waiting for brief card failed: {e}", flush=True)
            dom_text = page.evaluate("() => document.body.innerText")
            print("PAGE TEXT:\n", dom_text, flush=True)
            print("CONSOLE LOGS:\n", console_logs, flush=True)
            print("PAGE ERRORS:\n", page_errors, flush=True)
            page.screenshot(path=str(artifact_dir / "debug-brief-failure.png"))
            raise

        # Step 3: Approve the brief
        print("\n=== STEP 3: Approving brief ===", flush=True)
        approve_button = page.locator("button:has-text('Approve brief')").last
        assert approve_button.is_visible(), "Approve brief button should be visible"
        approve_button.click()
        page.wait_for_timeout(500)

        # Step 4: Verify 'Launch Codex picker' button is enabled and click it
        print("\n=== STEP 4: Clicking 'Launch Codex picker' ===", flush=True)
        launch_picker_button = page.locator("button:has-text('Launch Codex picker')").last
        assert launch_picker_button.is_visible(), "Launch Codex picker button should be visible"
        assert not launch_picker_button.is_disabled(), "Launch Codex picker button should be enabled after brief approval"
        launch_picker_button.click()
        page.wait_for_timeout(500)

        # Step 5: Verify modal opens with correct defaults
        print("\n=== STEP 5: Verifying modal defaults ===", flush=True)
        modal = page.locator(".modal-overlay")
        assert modal.is_visible(), "Modal overlay should be visible"

        modal_title = page.locator("#codex-modal-title")
        assert modal_title.is_visible(), "Modal title should be visible"
        assert modal_title.text_content().strip() == "Launch Codex Terminal", (
            f"Expected 'Launch Codex Terminal', got '{modal_title.text_content()}'"
        )

        target_info = page.locator(".modal-target-info")
        assert target_info.is_visible(), "Target workspace info should be visible"
        assert "capstone" in target_info.text_content(), f"Target info should mention 'capstone', got: '{target_info.text_content()}'"

        # Mode selector radio buttons
        resume_radio = page.locator("input[name='launch-mode'][value='resume']")
        new_radio = page.locator("input[name='launch-mode'][value='new']")
        assert resume_radio.is_checked(), "Resume existing session should be selected by default"
        assert not new_radio.is_checked(), "Start new session should not be checked by default"

        # Verify radio descriptions
        modal_text = modal.text_content()
        assert "Opens native Codex session picker in terminal; press Esc to exit/start new" in modal_text
        assert "Starts a fresh Codex session in project root" in modal_text

        # Model input
        model_input = page.locator("#launch-model-input")
        assert model_input.is_visible(), "Model input should be visible"
        assert model_input.input_value() == "gpt-5.6-terra", (
            f"Expected default model 'gpt-5.6-terra', got '{model_input.input_value()}'"
        )

        # Reasoning effort select
        reasoning_select = page.locator("#launch-reasoning-select")
        assert reasoning_select.is_visible(), "Reasoning select should be visible"
        assert reasoning_select.input_value() == "medium", (
            f"Expected default reasoning 'medium', got '{reasoning_select.input_value()}'"
        )
        print("Verified modal defaults: Resume mode, gpt-5.6-terra, medium reasoning effort.", flush=True)
        modal_screenshot = artifact_dir / "sprint2-phase3-modal.png"
        page.screenshot(path=str(modal_screenshot))
        print(f"Modal screenshot saved at {modal_screenshot}", flush=True)

        # Step 6: Test mode selection
        print("\n=== STEP 6: Testing mode selection interaction ===", flush=True)
        new_mode_label = page.locator(".modal-radio-option:has(input[value='new'])")
        new_mode_label.click()
        page.wait_for_timeout(300)
        assert new_radio.is_checked(), "Start new session radio should now be checked"
        assert not resume_radio.is_checked(), "Resume session radio should no longer be checked"

        # Switch back to resume mode to test native session picker in terminal
        resume_mode_label = page.locator(".modal-radio-option:has(input[value='resume'])")
        resume_mode_label.click()
        page.wait_for_timeout(300)
        assert resume_radio.is_checked(), "Resume session radio should be checked again"

        # Step 7: Click 'Launch terminal'
        print("\n=== STEP 7: Confirming launch ===", flush=True)
        confirm_launch_btn = page.locator(".modal-actions button.primary:has-text('Launch terminal')")
        assert confirm_launch_btn.is_visible(), "Launch terminal primary button should be visible"
        confirm_launch_btn.click()

        # Step 8: Verify modal closes and terminal canvas mounts
        print("\n=== STEP 8: Verifying modal closes and terminal canvas mounts ===", flush=True)
        page.wait_for_selector(".modal-overlay", state="detached", timeout=5000)
        print("Modal successfully closed.", flush=True)

        page.wait_for_selector(".work-surface .terminal-canvas", state="visible", timeout=15000)
        terminal_canvas = page.locator(".work-surface .terminal-canvas")
        assert terminal_canvas.is_visible(), "Terminal canvas should be mounted in work surface"
        assert terminal_canvas.get_attribute("aria-label") == "Codex terminal"

        # Wait for terminal PTY output to populate xterm
        page.wait_for_timeout(3000)

        # Scroll work surface into view so terminal canvas is clearly visible in proof screenshot
        page.locator(".work-surface").scroll_into_view_if_needed()
        page.wait_for_timeout(1000)

        # Step 9: Capture proof screenshot
        print(f"\n=== STEP 9: Capturing proof screenshot at {proof_screenshot} ===", flush=True)
        page.screenshot(path=str(proof_screenshot))
        assert proof_screenshot.exists(), f"Proof screenshot was not created at {proof_screenshot}"
        print(f"Proof screenshot successfully saved ({proof_screenshot.stat().st_size} bytes).", flush=True)

        print("\nALL SPRINT 2 PHASE 3 VERIFICATIONS PASSED!", flush=True)

finally:
    if server_proc.poll() is None:
        print("Terminating server process...", flush=True)
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(server_proc.pid)], capture_output=True)
