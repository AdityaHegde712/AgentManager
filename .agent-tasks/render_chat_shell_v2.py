from pathlib import Path

from playwright.sync_api import sync_playwright


artifact_dir = Path(__file__).parent
prototype_path = artifact_dir / "chat-shell-prototype-v2.html"

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    desktop = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    desktop.goto(prototype_path.as_uri(), wait_until="load")
    desktop.screenshot(path=str(artifact_dir / "chat-shell-prototype-v2.png"), full_page=True)
    print(f"desktop_title={desktop.title()}")
    print(f"desktop_horizontal_overflow={desktop.evaluate('document.documentElement.scrollWidth > window.innerWidth')}")
    print(f"desktop_rail_scrollable={desktop.evaluate('getComputedStyle(document.querySelector(\".thread-list\")).overflowY')}")
    print(f"desktop_controls_scrollable={desktop.evaluate('getComputedStyle(document.querySelector(\".controls\")).overflowY')}")
    print(f"desktop_feed_scrollable={desktop.evaluate('getComputedStyle(document.querySelector(\".feed-wrap\")).overflowY')}")

    narrow = browser.new_page(viewport={"width": 640, "height": 960}, device_scale_factor=1)
    narrow.goto(prototype_path.as_uri(), wait_until="load")
    narrow.screenshot(path=str(artifact_dir / "chat-shell-prototype-v2-narrow.png"), full_page=True)
    print(f"narrow_horizontal_overflow={narrow.evaluate('document.documentElement.scrollWidth > window.innerWidth')}")
    browser.close()
