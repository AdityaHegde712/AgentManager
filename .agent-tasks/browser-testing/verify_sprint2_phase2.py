import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright

artifact_dir = Path(__file__).resolve().parent
repo_dir = artifact_dir.parent.parent
conversations_dir = repo_dir / ".agent-tasks" / "conversations"

PORT = "4352"
print(f"Starting AgentRunner server on dedicated port {PORT}...")
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
        print(f"[Server] {line.strip()}")
        if "OPEN THIS URL:" in line:
            launch_url = line.split("OPEN THIS URL:")[1].strip()
            break
    if server_proc.poll() is not None:
        print("Server exited unexpectedly!")
        break

if not launch_url:
    print("Failed to get launch URL!")
    if server_proc.poll() is None:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(server_proc.pid)], capture_output=True)
    sys.exit(1)

print(f"Server ready at: {launch_url}")

console_logs = []
page_errors = []

try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page = context.new_page()

        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: page_errors.append(f"[pageerror] {str(err)}"))

        # Navigate to launch URL
        print("\n=== STEP 0: Navigating to launch URL ===")
        page.goto(launch_url, wait_until="networkidle")
        page.wait_for_timeout(1000)

        # 1. Verify Clicking '+ New orchestration thread' creates a new thread in the left rail
        print("\n=== STEP 1: Verifying '+ New orchestration thread' creates a new thread ===")
        initial_thread_count = page.locator(".history .thread").count()
        print(f"Initial thread count in left rail: {initial_thread_count}")
        assert initial_thread_count >= 1, "Expected at least 1 initial/default thread in the left rail"

        new_thread_button = page.locator(".new-thread")
        assert new_thread_button.is_visible(), "'+ New orchestration thread' button should be visible"
        new_thread_button.click()
        page.wait_for_timeout(1000)

        new_thread_count = page.locator(".history .thread").count()
        print(f"New thread count after click: {new_thread_count}")
        assert new_thread_count == initial_thread_count + 1, (
            f"Expected {initial_thread_count + 1} threads, but got {new_thread_count}"
        )

        active_thread_elem = page.locator(".history .thread.active")
        assert active_thread_elem.is_visible(), "Newly created thread should have active styling"
        print(f"Active thread text: '{active_thread_elem.text_content().strip()}'")

        # Extract active thread id from current URL
        current_url = page.url
        parsed_url = urlparse(current_url)
        query_params = parse_qs(parsed_url.query)
        assert "thread" in query_params, f"Expected 'thread' query parameter in URL, got {current_url}"
        active_thread_id = query_params["thread"][0]
        print(f"Active thread ID from URL: {active_thread_id}")
        assert active_thread_id, "Active thread ID must not be empty"

        # 2. Verify Sending a prompt persists messages to disk
        print("\n=== STEP 2: Verifying sending a prompt persists messages to disk ===")
        test_prompt = "Implement Sprint 2 Phase 2 verification deliverable"
        deliverable_input = page.locator("#deliverable")
        assert deliverable_input.is_visible(), "Deliverable textarea should be visible"
        deliverable_input.fill(test_prompt)

        submit_btn = page.locator(".composer button[type='submit']")
        assert not submit_btn.is_disabled(), "Submit button should be enabled after entering prompt"
        submit_btn.click()
        page.wait_for_timeout(1500)

        # Check message appears in UI feed
        user_message = page.locator(f".user-message:has-text('{test_prompt}')")
        assert user_message.is_visible(), f"User message '{test_prompt}' should be visible in chat feed"
        print("User message confirmed visible in chat feed.")

        # Check disk persistence
        thread_file = conversations_dir / f"{active_thread_id}.json"
        print(f"Checking disk persistence at: {thread_file}")
        assert thread_file.exists(), f"Thread JSON file does not exist on disk at {thread_file}"

        with open(thread_file, "r", encoding="utf-8") as f:
            disk_data = json.load(f)

        assert disk_data.get("id") == active_thread_id, f"Thread ID mismatch on disk: {disk_data.get('id')}"
        messages_on_disk = disk_data.get("messages", [])
        print(f"Found {len(messages_on_disk)} message(s) persisted on disk.")
        persisted_user_texts = [m.get("text") for m in messages_on_disk if m.get("role") == "user"]
        assert test_prompt in persisted_user_texts, (
            f"Expected prompt '{test_prompt}' in persisted messages, found: {persisted_user_texts}"
        )
        print("Verification 2 PASSED: Messages successfully persisted to disk with UTF-8 encoding.")

        # 3. Verify Reloading the browser restores the exact thread and conversation history
        print("\n=== STEP 3: Verifying reload restores thread and history ===")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1500)

        reloaded_url = page.url
        reloaded_query = parse_qs(urlparse(reloaded_url).query)
        assert reloaded_query.get("thread", [None])[0] == active_thread_id, (
            f"Expected thread query param '{active_thread_id}' after reload, got {reloaded_url}"
        )

        reloaded_active_thread = page.locator(".history .thread.active")
        assert reloaded_active_thread.is_visible(), "Active thread in left rail should remain active after reload"

        reloaded_user_message = page.locator(f".user-message:has-text('{test_prompt}')")
        assert reloaded_user_message.is_visible(), (
            f"Persisted user message '{test_prompt}' must be restored in chat feed after reload"
        )
        print("Verification 3 PASSED: Reload restored the exact active thread and conversation history.")

        # 4. Verify Clicking 'Export conversation (.md)' exports valid markdown with level 1 and level 2 headers
        print("\n=== STEP 4: Verifying 'Export conversation (.md)' exports valid markdown ===")
        export_btn = page.locator("button:has-text('Export conversation (.md)')")
        assert export_btn.is_visible(), "'Export conversation (.md)' button should be visible in chat header"

        with page.expect_download() as download_info:
            export_btn.click()

        download = download_info.value
        suggested_name = download.suggested_filename
        print(f"Download triggered with filename: {suggested_name}")
        assert suggested_name.startswith(f"AgentRunner-Conversation-{active_thread_id}-"), (
            f"Suggested filename should start with 'AgentRunner-Conversation-{active_thread_id}-', got '{suggested_name}'"
        )
        assert suggested_name.endswith(".md"), f"Filename should have .md extension, got '{suggested_name}'"

        exported_file_path = artifact_dir / suggested_name
        download.save_as(str(exported_file_path))
        assert exported_file_path.exists(), f"Downloaded file not saved to {exported_file_path}"

        with open(exported_file_path, "r", encoding="utf-8") as f:
            md_content = f.read()

        print("\nExported markdown preview:\n" + "=" * 40)
        print(md_content[:400])
        print("=" * 40)

        # Validate Level 1 header
        assert md_content.startswith("# AgentRunner Conversation - "), (
            "Export markdown must start with '# AgentRunner Conversation - {ISO_TIMESTAMP}'"
        )

        # Validate Metadata block
        assert f"- Thread ID: {active_thread_id}" in md_content, "Metadata block must contain '- Thread ID: {id}'"
        assert "- Project Alias:" in md_content, "Metadata block must contain '- Project Alias:'"
        assert "- Root:" in md_content, "Metadata block must contain '- Root:'"
        assert "- Timestamp:" in md_content, "Metadata block must contain '- Timestamp:'"

        # Validate Level 2 headers
        assert "## User" in md_content, "Export markdown must contain '## User' Level 2 header"
        assert test_prompt in md_content, f"Export markdown must contain user prompt text '{test_prompt}'"
        assert "## Agent" in md_content, "Export markdown must contain '## Agent' Level 2 header"
        print("Verification 4 PASSED: Valid markdown with Level 1, Metadata block, and Level 2 headers exported.")

        # 5. Capture Screenshot
        print("\n=== STEP 5: Capturing screenshot ===")
        screenshot_path = artifact_dir / "sprint2-phase2-verified.png"
        page.screenshot(path=str(screenshot_path), full_page=False)
        print(f"Screenshot saved to: {screenshot_path}")
        assert screenshot_path.exists(), f"Screenshot file not found at {screenshot_path}"

        browser.close()

finally:
    print("\nStopping server process...")
    if server_proc.poll() is None:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(server_proc.pid)], capture_output=True)

print(f"\nTotal page errors encountered: {len(page_errors)}")
for err in page_errors:
    print("  ERROR:", err)
assert len(page_errors) == 0, f"Encountered page errors during browser verification: {page_errors}"

print("\n>>> ALL SPRINT 2 PHASE 2 E2E PLAYWRIGHT VERIFICATIONS PASSED SUCCESSFULLY! <<<")
