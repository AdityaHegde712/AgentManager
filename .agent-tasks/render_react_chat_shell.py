from pathlib import Path

from playwright.sync_api import sync_playwright


artifact_dir = Path(__file__).parent


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    desktop = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    desktop.goto("http://127.0.0.1:5173/?token=prototype", wait_until="networkidle")
    desktop.screenshot(path=str(artifact_dir / "chat-shell-live.png"), full_page=True)
    print(f"desktop_title={desktop.title()}")
    print(f"desktop_horizontal_overflow={desktop.evaluate('document.documentElement.scrollWidth > window.innerWidth')}")

    narrow = browser.new_page(viewport={"width": 640, "height": 960}, device_scale_factor=1)
    narrow.goto("http://127.0.0.1:5173/?token=prototype", wait_until="networkidle")
    narrow.screenshot(path=str(artifact_dir / "chat-shell-live-narrow.png"), full_page=True)
    print(f"narrow_horizontal_overflow={narrow.evaluate('document.documentElement.scrollWidth > window.innerWidth')}")
    browser.close()
