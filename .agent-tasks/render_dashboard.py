from pathlib import Path

from playwright.sync_api import sync_playwright


output_path = Path(__file__).parent / "dashboard.png"

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    page.goto("http://127.0.0.1:5173/?token=prototype", wait_until="networkidle")
    page.screenshot(path=str(output_path), full_page=True)
    print(f"screenshot={output_path}")
    print(f"title={page.title()}")
    print(f"buttons={page.locator('button').count()}")
    browser.close()
