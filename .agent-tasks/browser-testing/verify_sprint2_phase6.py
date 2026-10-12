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
proof_screenshot = artifact_dir / "sprint2-phase6-verified.png"

# Setup sandbox directory
sandbox_dir = (repo_dir / ".agent-tasks" / "sandbox").resolve()
sandbox_dir.mkdir(parents=True, exist_ok=True)
(sandbox_dir / "AGENTS.md").write_text("# Sandbox AGENTS.md\nAgent guidance for sandbox.\n", encoding="utf-8")

# Clean up stale test conversations so test starts with a clean slate
conversations_dir = repo_dir / ".agent-tasks" / "conversations"
if conversations_dir.exists():
    for f in conversations_dir.glob("*.json"):
        try:
            f.unlink()
        except Exception:
            pass

PORT = "4359"
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

        # Step a: Register a project with alias sandbox
        print("\n=== STEP 1: Register project 'sandbox' ===", flush=True)
        page.goto(launch_url, wait_until="networkidle")
        page.wait_for_timeout(1000)

        catalog_items = [t.strip().lower() for t in page.locator(".project-row span:first-child").all_text_contents()]
        print(f"Current catalog items: {catalog_items}", flush=True)
        if "sandbox" not in catalog_items:
            print("Registering sandbox project via catalog form...", flush=True)
            details_summary = page.locator(".registration-details summary")
            if not page.locator("input[aria-label='Project alias']").is_visible():
                details_summary.click()
            page.wait_for_selector("input[aria-label='Project alias']", state="visible", timeout=5000)
            page.fill("input[aria-label='Project alias']", "sandbox")
            page.fill("input[aria-label='Project root']", str(sandbox_dir))
            add_button = page.locator("button:has-text('Add to catalog')")
            add_button.click()
            page.wait_for_timeout(1000)

        if page.locator(".catalog-toggle-button").is_visible():
            page.locator(".catalog-toggle-button").click()
            page.wait_for_timeout(500)

        catalog_items_after = [t.strip().lower() for t in page.locator(".project-row span:first-child").all_text_contents()]
        print(f"Catalog items after registration: {catalog_items_after}", flush=True)
        assert "sandbox" in catalog_items_after, f"Expected 'sandbox' in catalog: {catalog_items_after}"
        print("Project 'sandbox' successfully verified in catalog.", flush=True)

        # Step b: In an active thread, submit exact prompt: "My sandbox project needs a new AGENTS.md so can we set up the brief for that?"
        print("\n=== STEP 2: Submit user failure prompt ===", flush=True)
        test_prompt = "My sandbox project needs a new AGENTS.md so can we set up the brief for that?"
        deliverable_input = page.locator("#deliverable")
        assert deliverable_input.is_visible(), "Deliverable textarea should be visible"
        deliverable_input.fill(test_prompt)

        submit_btn = page.locator(".composer button[type='submit']")
        assert not submit_btn.is_disabled(), "Submit button should be enabled"
        submit_btn.click()
        print("Prompt submitted. Waiting for resolution...", flush=True)

        # Step c: Assert it resolves to sandbox and DOES NOT ask to register 'needs'
        page.wait_for_timeout(2000)

        # 1. Assert DOES NOT ask to register 'needs'
        unregistered_cards = page.locator(".inference-card[aria-label='Unregistered project registration']").all()
        for c in unregistered_cards:
            card_text = c.text_content().lower()
            assert "needs" not in card_text, f"Unregistered card incorrectly asked to register 'needs': {card_text}"
        print("Confirmed: System did NOT ask to register 'needs'. Stop word filter active!", flush=True)

        # 2. Assert resolves to 'sandbox' (either confirm card for sandbox or brief for sandbox)
        confirm_card = page.locator(".inference-card[aria-label='Project confirmation']")
        brief_card = page.locator(".response-card[aria-label='Draft continuation brief']")

        if confirm_card.is_visible():
            print("Project confirmation card visible. Verifying it references 'sandbox'...", flush=True)
            assert "sandbox" in confirm_card.text_content().lower(), f"Confirm card must mention sandbox: {confirm_card.text_content()}"
            confirm_btn = confirm_card.locator("button:has-text('Confirm project')")
            assert confirm_btn.is_visible(), "Confirm project button should be visible"
            confirm_btn.click()
            print("Clicked 'Confirm project'. Waiting for brief synthesis...", flush=True)
            page.wait_for_selector(".response-card[aria-label='Draft continuation brief']", timeout=60000)
        else:
            print("Brief drafted directly for sandbox. Waiting for synthesis...", flush=True)
            page.wait_for_selector(".response-card[aria-label='Draft continuation brief']", timeout=60000)

        print("Sandbox project successfully resolved and brief generated!", flush=True)

        # Step d: Test fallback dropdown: Submit prompt with unregistered project name
        print("\n=== STEP 3: Test fallback dropdown with unregistered project prompt ===", flush=True)
        # Create a new thread so no effective project is locked
        print("Opening a new thread for fallback dropdown test...", flush=True)
        page.locator(".new-thread").click()
        page.wait_for_timeout(1000)

        unregistered_prompt = "work on mysterious-app"
        print(f"Submitting unregistered prompt: '{unregistered_prompt}'...", flush=True)
        deliverable_input = page.locator("#deliverable")
        deliverable_input.fill(unregistered_prompt)
        page.locator(".composer button[type='submit']").click()
        page.wait_for_timeout(1000)

        # Step e: Verify selection card or register-candidate card renders the dropdown
        fallback_select = page.locator("select[aria-label='Select registered project']")
        page.wait_for_selector("select[aria-label='Select registered project']", timeout=10000)
        assert fallback_select.is_visible(), "Fallback project dropdown should be visible on card"

        options = [opt.text_content().strip() for opt in fallback_select.locator("option").all()]
        print(f"Fallback select options: {options}", flush=True)
        assert any("Select from registered projects" in opt for opt in options), "Missing default placeholder option"
        assert any("sandbox" in opt.lower() for opt in options), f"Expected 'sandbox' among options: {options}"
        print("Fallback dropdown verified with registered project options!", flush=True)

        # Step f: Select 'sandbox' from dropdown. Verify card is dismissed and brief generation for 'sandbox' initiated
        print("Selecting 'sandbox' from the fallback dropdown...", flush=True)
        fallback_select.select_option(value="sandbox")

        print("Waiting for fallback card to dismiss and brief generation to initiate...", flush=True)
        page.wait_for_selector(".response-card[aria-label='Draft continuation brief']", timeout=60000)
        page.wait_for_timeout(1000)

        # Verify card dismissed
        assert fallback_select.count() == 0, "Fallback dropdown card should be dismissed after selection"
        print("Card dismissed and draft continuation brief rendered for 'sandbox'!", flush=True)

        # Capture proof screenshot
        print(f"\n=== STEP 4: Capturing proof screenshot at {proof_screenshot} ===", flush=True)
        page.screenshot(path=str(proof_screenshot))
        assert proof_screenshot.exists(), f"Proof screenshot not created at {proof_screenshot}"
        print(f"Proof screenshot successfully saved ({proof_screenshot.stat().st_size} bytes).", flush=True)

        print("\nALL SPRINT 2 PHASE 6 VERIFICATIONS PASSED SUCCESSFULLY!", flush=True)

finally:
    if server_proc.poll() is None:
        print("Stopping test server...", flush=True)
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(server_proc.pid)], capture_output=True)
