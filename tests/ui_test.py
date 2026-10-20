"""Barcode Generator - browser tests.

Runs its own server, so it needs nothing else running:
    python3 tests/ui_test.py

Checks the page loads with no errors, draws, switches symbology, handles a
mixed batch, changes language and theme, downloads the three files, and builds
a print sheet.
"""
from __future__ import annotations

import http.server
import socket
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CHECKS = 0
FAILED = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global CHECKS, FAILED
    CHECKS += 1
    if not condition:
        FAILED += 1
        print(f"FAIL: {name} {detail}")


def free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def serve(port: int) -> socketserver.TCPServer:
    handler = lambda *args, **kwargs: http.server.SimpleHTTPRequestHandler(
        *args, directory=str(ROOT), **kwargs
    )
    server = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main() -> int:
    port = free_port()
    serve(port)
    base = f"http://127.0.0.1:{port}/"

    with sync_playwright() as play:
        browser = play.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        page = context.new_page()

        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        foreign: list[str] = []
        page.on("request", lambda request: foreign.append(request.url) if not request.url.startswith(base) else None)

        page.goto(base, wait_until="load")
        page.wait_for_timeout(600)

        check("loads with no page or console errors", not errors, str(errors))
        check("no request leaves the page", not foreign, str(foreign))
        check("one svg is drawn", page.locator("#svgbox svg").count() == 1)
        check("caption names the symbology", "EAN-13" in page.inner_text("#caption"))
        check("caption gives the printed size", "mm" in page.inner_text("#caption"))
        check("status counts one code", "1" in page.inner_text("#status"))

        # symbology switch
        page.click('.chip[data-type="code128"]')
        page.fill("#codes", "SHIP-2026-0042")
        page.wait_for_timeout(200)
        check("code 128 draws", "Code 128" in page.inner_text("#caption"))
        check("code 128 keeps the typed text", "SHIP-2026-0042" in page.inner_text("#caption"))

        # a mixed batch: two good lines, one broken
        page.click('.chip[data-type="ean13"]')
        page.fill("#codes", "4006381333931\n5901234123457\n123")
        page.wait_for_timeout(250)
        status = page.inner_text("#status")
        check("batch counts the valid codes", "2" in status, status)
        check("batch names the broken line", "3" in status, status)
        check("batch disables nothing that still works", page.is_enabled("#btn-print"))

        # every symbology draws
        for kind in ("ean13", "ean8", "upca", "code128", "code39", "itf14"):
            page.click(f'.chip[data-type="{kind}"]')
            page.fill("#codes", page.evaluate("(k) => window.Barcode.TYPES[k].sample", kind))
            page.wait_for_timeout(120)
            check(f"{kind} draws", page.locator("#svgbox svg").count() == 1)

        # a wrong check digit is corrected on screen
        page.click('.chip[data-type="ean13"]')
        page.fill("#codes", "4006381333930")
        page.wait_for_timeout(200)
        check("wrong check digit corrected", "4006381333931" in page.inner_text("#caption"))
        check("correction is explained", "1" in page.inner_text("#status"))

        # language
        page.select_option("#lang", "ro")
        page.wait_for_timeout(200)
        check("romanian heading", "Coduri de bare" in page.inner_text("h1"), page.inner_text("h1"))
        check("romanian lang attribute", page.get_attribute("html", "lang") == "ro")
        page.select_option("#lang", "sr-cyrl")
        page.wait_for_timeout(200)
        heading = page.inner_text("h1")
        check("cyrillic heading is cyrillic", any("\u0400" <= char <= "\u04ff" for char in heading), heading)
        check("cyrillic keeps the format names latin", "SVG" in page.inner_text("body"))
        page.select_option("#lang", "en")
        page.wait_for_timeout(200)

        # theme, and it survives a reload
        page.click("#theme")
        page.wait_for_timeout(150)
        check("dark theme applied", page.get_attribute("html", "data-theme") == "dark")
        page.reload(wait_until="load")
        page.wait_for_timeout(500)
        check("dark theme survives a reload", page.get_attribute("html", "data-theme") == "dark")
        page.click("#theme")
        page.wait_for_timeout(150)

        # downloads
        page.click('.chip[data-type="ean13"]')
        page.fill("#codes", "4006381333931\n5901234123457")
        page.wait_for_timeout(250)
        for button, extension in (("#btn-svg", ".svg"), ("#btn-png", ".png"), ("#btn-zip", ".zip")):
            with page.expect_download() as caught:
                page.click(button)
            download = caught.value
            target = Path(download.path())
            check(f"{extension} downloads", target.exists() and target.stat().st_size > 200,
                  f"{download.suggested_filename} {target.stat().st_size if target.exists() else 0} bytes")
            check(f"{extension} has the right extension", download.suggested_filename.endswith(extension),
                  download.suggested_filename)

        # print sheet
        page.fill("#codes", "4006381333931\n5901234123457\n9780306406157")
        page.wait_for_timeout(200)
        page.evaluate("document.getElementById('btn-print').click()")
        page.wait_for_timeout(300)
        labels = page.locator("#sheet .label").count()
        check("print sheet gets one label per code", labels == 3, str(labels))
        page.wait_for_timeout(700)
        check("the sheet is shown on screen before printing", page.locator("#sheetview").is_visible())
        page.emulate_media(media="print")
        check("the sheet survives into the print stylesheet", page.locator("#sheet").is_visible())
        check("the app chrome steps aside when printing", not page.locator(".panel").is_visible())
        page.emulate_media(media="screen")

        # offline shell
        page.wait_for_timeout(800)
        registered = page.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)")
        check("service worker registered", registered >= 1, str(registered))

        browser.close()

    print(("PASS: " if not FAILED else "FAIL: ") + f"{CHECKS - FAILED} of {CHECKS} browser checks")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
