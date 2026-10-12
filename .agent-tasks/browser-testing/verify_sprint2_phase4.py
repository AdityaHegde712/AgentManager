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
proof_screenshot = artifact_dir / "sprint2-phase4-verified.png"

# Clean up stale test conversations so test starts with a clean slate
conversations_dir = repo_dir / ".agent-tasks" / "conversations"
if conversations_dir.exists():
    for f in conversations_dir.glob("*.json"):
        try:
            f.unlink()
        except Exception:
            pass

PORT = "4358"
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

        # Step 1: Dynamic Project Re-scoping
        print("\n=== STEP 1: Dynamic Project Re-scoping (capstone -> randoms) ===", flush=True)
        parsed = urlparse(launch_url)
        target_url = f"{parsed.scheme}://{parsed.netloc}/?project=capstone#{parsed.fragment}"
        print(f"Navigating to: {target_url}", flush=True)
        page.goto(target_url, wait_until="networkidle")
        page.wait_for_timeout(1000)

        # Check initial scope in composer
        scope_text = page.locator(".compose-actions .scope").text_content()
        print(f"Initial composer scope: {scope_text}", flush=True)
        assert "capstone" in scope_text, f"Expected capstone in scope, got: {scope_text}"

        # Submit prompt asking for different project: 'randoms'
        print("Submitting prompt asking for 'randoms' project...", flush=True)
        deliverable_input = page.locator("#deliverable")
        assert deliverable_input.is_visible(), "Deliverable textarea should be visible"
        deliverable_input.fill("Implement data caching module in randoms repository")

        submit_btn = page.locator(".composer button[type='submit']")
        assert not submit_btn.is_disabled(), "Submit button should be enabled"
        submit_btn.click()

        print("Waiting for Project confirmation card for 'randoms'...", flush=True)
        page.wait_for_selector(".inference-card[aria-label='Project confirmation']", timeout=15000)
        confirm_card = page.locator(".inference-card[aria-label='Project confirmation']")
        assert confirm_card.is_visible(), "Project confirmation card should be visible"
        assert "randoms" in confirm_card.text_content(), "Confirmation card must mention 'randoms'"
        print("Confirmed: Project confirmation card rendered for 'randoms'.", flush=True)

        # Confirm the project switch
        print("Clicking 'Confirm project' to switch thread scope to 'randoms'...", flush=True)
        confirm_btn = confirm_card.locator("button:has-text('Confirm project')")
        assert confirm_btn.is_visible(), "Confirm project button should be visible"
        confirm_btn.click()

        print("Waiting for brief synthesis for 'randoms'...", flush=True)
        page.wait_for_selector(".response-card[aria-label='Draft continuation brief']", timeout=60000)
        page.wait_for_timeout(1000)

        # Verify scope updated to randoms in composer and rules card
        updated_scope_text = page.locator(".compose-actions .scope").text_content()
        print(f"Updated composer scope: {updated_scope_text}", flush=True)
        assert "randoms" in updated_scope_text, f"Expected randoms in composer scope, got: {updated_scope_text}"

        rules_scope = page.locator(".response-card[aria-label='Continuation preparation rules']").text_content()
        assert "randoms" in rules_scope, f"Expected randoms in rules card, got: {rules_scope}"
        print("Dynamic project re-scoping verified!", flush=True)

        # Step 2: Unused Thread Guard
        print("\n=== STEP 2: Unused Thread Guard ===", flush=True)
        thread_items = page.locator(".history .thread-item-wrap")
        initial_thread_count = thread_items.count()
        print(f"Thread count before creating new thread: {initial_thread_count}", flush=True)

        # First click: current thread has user message, so a new empty thread should be created
        print("Clicking '+ New orchestration thread' to spawn first unused thread...", flush=True)
        page.locator(".new-thread").click()
        page.wait_for_timeout(1000)

        count_after_first_new = page.locator(".history .thread-item-wrap").count()
        print(f"Thread count after first new thread: {count_after_first_new}", flush=True)
        assert count_after_first_new == initial_thread_count + 1, "Expected one new thread to be added"

        # Now click '+ New orchestration thread' repeatedly on the empty thread
        print("Clicking '+ New orchestration thread' 3 times on the unused thread...", flush=True)
        for i in range(3):
            page.locator(".new-thread").click()
            page.wait_for_timeout(400)

        count_after_repeated = page.locator(".history .thread-item-wrap").count()
        print(f"Thread count after repeated clicks: {count_after_repeated}", flush=True)
        assert count_after_repeated == count_after_first_new, (
            f"Expected thread count to remain {count_after_first_new}, but was {count_after_repeated} (duplicate unused threads created!)"
        )
        print("Unused thread guard verified: no duplicate empty threads created!", flush=True)

        # Step 3: Thread Renaming in Sidebar
        print("\n=== STEP 3: Thread Renaming in Sidebar ===", flush=True)
        active_thread = page.locator(".history .thread-item-wrap.active")
        assert active_thread.is_visible(), "Active thread item should be visible"

        # Hover to reveal actions
        active_thread.hover()
        page.wait_for_timeout(300)

        rename_btn = active_thread.locator(".thread-action-btn[title='Rename thread']")
        assert rename_btn.is_visible(), "Rename pencil button should be visible on hover"
        rename_btn.click()
        page.wait_for_timeout(300)

        # Rename form input
        rename_input = active_thread.locator(".thread-rename-input")
        assert rename_input.is_visible(), "Rename inline input should be visible"
        new_title = "Sprint 2 Phase 4 Workspace"
        rename_input.fill(new_title)
        rename_input.press("Enter")
        page.wait_for_timeout(800)

        # Verify title in sidebar and header
        sidebar_title = active_thread.locator(".thread-title").text_content()
        print(f"Sidebar thread title after rename: {sidebar_title}", flush=True)
        assert new_title in sidebar_title, f"Expected '{new_title}' in sidebar, got '{sidebar_title}'"

        header_title = page.locator(".chat-header h1").text_content()
        print(f"Chat header title after rename: {header_title}", flush=True)
        assert new_title in header_title, f"Expected '{new_title}' in header, got '{header_title}'"
        print("Thread renaming verified!", flush=True)

        # Step 4: Thread Deletion in Sidebar
        print("\n=== STEP 4: Thread Deletion in Sidebar ===", flush=True)
        count_before_delete = page.locator(".history .thread-item-wrap").count()
        print(f"Thread count before delete: {count_before_delete}", flush=True)

        # Hover over the renamed active thread and delete it
        active_thread.hover()
        page.wait_for_timeout(300)

        delete_btn = active_thread.locator(".thread-action-btn.delete-btn")
        assert delete_btn.is_visible(), "Delete button should be visible on hover"
        delete_btn.click()
        page.wait_for_timeout(1000)

        count_after_delete = page.locator(".history .thread-item-wrap").count()
        print(f"Thread count after delete: {count_after_delete}", flush=True)
        assert count_after_delete == count_before_delete - 1, "Expected thread count to decrease by 1"

        all_titles = [t.text_content() for t in page.locator(".history .thread-title").all()]
        assert new_title not in all_titles, f"Deleted thread title '{new_title}' still in sidebar: {all_titles}"
        print("Thread deletion verified!", flush=True)

        # Step 5: Capture Proof Screenshot
        print(f"\n=== STEP 5: Capturing proof screenshot at {proof_screenshot} ===", flush=True)
        page.screenshot(path=str(proof_screenshot))
        assert proof_screenshot.exists(), f"Proof screenshot was not created at {proof_screenshot}"
        print(f"Proof screenshot successfully saved ({proof_screenshot.stat().st_size} bytes).", flush=True)

        print("\nALL SPRINT 2 PHASE 4 VERIFICATIONS PASSED SUCCESSFULLY!", flush=True)

finally:
    if server_proc.poll() is None:
        print("Stopping test server...", flush=True)
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(server_proc.pid)], capture_output=True)
