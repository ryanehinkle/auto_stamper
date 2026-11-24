# Auto Stamper

Standalone Topgolf BEO stamping site, styled to match ARMatic. It runs entirely in the browser.

## Daily workflow

1. Upload the **Manager BEOs** PDF and the **Internal BEOs** PDF.
2. Auto Stamper groups pages by BEO number, identifies corresponding events, and analyzes only the Manager copy.
3. Review the five suggested stamps. Change any selection if necessary.
4. Review an event's Internal match; manually select it when automatic matching is uncertain.
5. Preview the stamp impressions over both copies.
6. Export either PDF separately, or download a ZIP containing both stamped PDFs.

Stamps are placed on the first page of each matched event in each original packet. The original PDF text, images, page order and page dimensions are preserved.

## Detection rules

| Stamp | Rule |
| --- | --- |
| Balance Due | Explicit positive outstanding balance in the Manager BEO payment summary |
| Tax Exempt | Explicit tax-exempt indication in the Manager BEO |
| Leaderboard | "Live Leaderboard" in the Manager BEO |
| Tentative | Event status/stage other than "Definite" |
| Retail | A Retail section or Retail TOTAL heading |

If payment or tax information is missing or ambiguous, detection is left **unverified**, rather than assuming the event is paid or tax exempt. Check and mark the event as reviewed before exporting. Missing Internal matches never receive stamps automatically.

**PDF text:** Automatic detection relies on selectable text in exported BEOs. Image-only Xerox scans do not contain that text. Those can still be previewed and stamped manually, but cannot be analyzed reliably without OCR.

## Stamp impressions

The five transparent, colored RGBA impressions in the stamps/ folder were extracted from the supplied blank stamp sheet. On load, Auto Stamper deskews the measured scan tilt (0.65° Tax Exempt, -0.35° Balance Due, 0.25° Leaderboard, 0.85° Retail); the already-level Tentative impression is kept intact. The generated straightened PNGs are used identically in previews and both PDF exports. The original lettering, print colors, and natural ink texture are retained, while placement is mathematically centered, level, and kept above the event information box.

The **Retail** stamp uses the lower white band just above the first product section when the main header area is too full.

All PDF changes are overlays on the original pages: **no rasterized PDF export**, no uploaded BEO documents, and no server database.

## Hosting

This is a static site. In GitHub, go to **Settings → Pages → Build and deployment → Deploy from a branch** and select **main** / **/(root)**, then Save. The resulting Pages URL should be:

https://ryanehinkle.github.io/auto_stamper/

Do not simply open index.html using file://; the browser must be able to fetch the local stamp assets. For development, use a local HTTP server (for example python -m http.server 8000).

The third-party PDF libraries are downloaded from cdnjs. Once loaded, the application processes BEO content entirely on-device.

## Notes

- This first version is designed for Topgolf's standard portrait BEO templates and ordinary text-based PDF exports.
- Verify a real printed test page against the physical stamps at **Actual Size / 100%**, not "Fit to page", before relying on exact dimensions for a production batch.
- The supplied samples were scans rather than unmarked, text-selectable Manager/Internal PDF exports, so real daily packet structure and detection patterns still need an end-to-end test with original BEOs.
