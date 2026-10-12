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
proof_screenshot = artifact_dir / "git-bash-verified.png"

PORT = "4362"
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

        # Step 1: Navigate to launch URL with capstone project
        print("\n=== STEP 1: Navigating to launch URL with project 'capstone' ===", flush=True)
        parsed = urlparse(launch_url)
        target_url = f"{parsed.scheme}://{parsed.netloc}/?project=capstone#{parsed.fragment}"
        print(f"Target URL: {target_url}", flush=True)
        page.goto(target_url, wait_until="networkidle")
        page.wait_for_timeout(1000)

        # Step 2: Submit a deliverable to draft a brief
        print("\n=== STEP 2: Submitting deliverable prompt ===", flush=True)
        test_prompt = "Verify Git Bash PTY wrapper and interactive shell selector in launch modal"
        deliverable_input = page.locator("#deliverable")
        assert deliverable_input.is_visible(), "Deliverable textarea should be visible"
        deliverable_input.fill(test_prompt)

        submit_btn = page.locator(".composer button[type='submit']")
        assert not submit_btn.is_disabled(), "Submit button should be enabled"
        submit_btn.click()

        print("Waiting for brief synthesis...", flush=True)
        page.wait_for_selector(".response-card[aria-label='Draft continuation brief']", timeout=60000)
        page.wait_for_timeout(1000)

        # Step 3: Approve the brief
        print("\n=== STEP 3: Approving brief ===", flush=True)
        approve_button = page.locator("button:has-text('Approve brief')").last
        assert approve_button.is_visible(), "Approve brief button should be visible"
        approve_button.click()
        page.wait_for_timeout(500)

        # Step 4: Click 'Launch Codex picker'
        print("\n=== STEP 4: Clicking 'Launch Codex picker' ===", flush=True)
        launch_picker_button = page.locator("button:has-text('Launch Codex picker')").last
        assert launch_picker_button.is_visible(), "Launch Codex picker button should be visible"
        assert not launch_picker_button.is_disabled(), "Launch Codex picker button should be enabled after brief approval"
        launch_picker_button.click()
        page.wait_for_timeout(500)

        # Step 5: Verify modal opens with Shell environment selector
        print("\n=== STEP 5: Verifying modal Shell environment selector ===", flush=True)
        modal = page.locator(".modal-overlay")
        assert modal.is_visible(), "Modal overlay should be visible"

        modal_title = page.locator("#codex-modal-title")
        assert modal_title.is_visible(), "Modal title should be visible"
        assert modal_title.text_content().strip() == "Launch Codex Terminal"

        # Verify Shell environment legend and radio options
        shell_legend = page.locator(".modal-legend:has-text('Shell environment')")
        assert shell_legend.is_visible(), "Shell environment legend should be visible"

        bash_radio = page.locator("input[name='launch-shell'][value='bash']")
        native_radio = page.locator("input[name='launch-shell'][value='native']")
        assert bash_radio.is_visible(), "Git Bash radio option should be visible"
        assert native_radio.is_visible(), "Native Windows radio option should be visible"

        assert bash_radio.is_checked(), "Git Bash should be selected by default"
        assert not native_radio.is_checked(), "Native Windows should not be selected by default"

        # Verify descriptions
        modal_text = modal.text_content()
        assert "Git Bash (recommended)" in modal_text, "Modal should include 'Git Bash (recommended)' option"
        assert "Runs inside Git Bash with POSIX commands (ls, git, grep); drops into an interactive bash prompt if Codex exits" in modal_text
        assert "Native Windows" in modal_text, "Modal should include 'Native Windows' option"
        assert "Direct codex.exe execution in Windows ConPTY" in modal_text

        print("Verified Shell environment defaults to 'Git Bash (recommended)'.", flush=True)
        modal_screenshot = artifact_dir / "git-bash-modal.png"
        page.screenshot(path=str(modal_screenshot))
        print(f"Modal screenshot saved at {modal_screenshot}", flush=True)

        # Step 6: Test radio button toggling
        print("\n=== STEP 6: Testing shell selection interaction ===", flush=True)
        native_label = page.locator(".modal-radio-option:has(input[value='native'])")
        native_label.click()
        page.wait_for_timeout(300)
        assert native_radio.is_checked(), "Native Windows radio should now be checked"
        assert not bash_radio.is_checked(), "Git Bash radio should be unchecked"

        bash_label = page.locator(".modal-radio-option:has(input[value='bash'])")
        bash_label.click()
        page.wait_for_timeout(300)
        assert bash_radio.is_checked(), "Git Bash radio should be checked again"
        assert not native_radio.is_checked(), "Native Windows radio should be unchecked"

        # Step 7: Click 'Launch terminal'
        print("\n=== STEP 7: Launching terminal with Git Bash wrapper ===", flush=True)
        confirm_launch_btn = page.locator(".modal-actions button.primary:has-text('Launch terminal')")
        assert confirm_launch_btn.is_visible(), "Launch terminal button should be visible"
        confirm_launch_btn.click()

        # Step 8: Verify modal closes and terminal canvas mounts
        print("\n=== STEP 8: Verifying modal closes and terminal canvas mounts ===", flush=True)
        page.wait_for_selector(".modal-overlay", state="detached", timeout=5000)
        print("Modal successfully closed.", flush=True)

        page.wait_for_selector(".work-surface .terminal-canvas", state="visible", timeout=15000)
        terminal_canvas = page.locator(".work-surface .terminal-canvas")
        assert terminal_canvas.is_visible(), "Terminal canvas should be mounted in work surface"
        assert terminal_canvas.get_attribute("aria-label") == "Codex terminal"

        # Wait for terminal PTY output
        page.wait_for_timeout(4000)

        # Scroll work surface into view
        page.locator(".work-surface").scroll_into_view_if_needed()
        page.wait_for_timeout(1000)

        # Step 9: Capture proof screenshot
        print(f"\n=== STEP 9: Capturing proof screenshot at {proof_screenshot} ===", flush=True)
        page.screenshot(path=str(proof_screenshot))
        assert proof_screenshot.exists(), f"Proof screenshot was not created at {proof_screenshot}"
        print(f"Proof screenshot successfully saved ({proof_screenshot.stat().st_size} bytes).", flush=True)

        print("\nALL GIT BASH TERMINAL INTEGRATION VERIFICATIONS PASSED!", flush=True)

finally:
    if server_proc.poll() is None:
        print("Terminating server process...", flush=True)
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(server_proc.pid)], capture_output=True)
