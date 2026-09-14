# Paymatch

[Open Paymatch](https://pariraipro.github.io/payment-reconciliation-tool/)

A standalone INR payment reconciliation app. Open the published site or run `node server.cjs` and visit the printed local address. No dependency install or build is required. Run calculation checks with `node --test tests/engine.test.mjs`.

## Workflow

1. Explore the included synthetic demo, or download its two sample CSV files.
2. Import an orders report and a payments report from the same reporting period. Map columns to the fields in the import dialog.
3. Run reconciliation, filter exceptions, open payment trails, and annotate reviewed records.
4. Export the complete reconciliation as CSV.

The first real import clears both demo input datasets. Until both real reports are loaded and reconciliation runs, previous results are visibly marked stale and cannot be exported or reviewed. Invalid imports are rejected atomically. All merchant data and review notes exist only in browser memory; refreshing the page restores the demo. No banking connection or account registration is required.

## Report contract

UTF-8 comma-delimited CSV, up to 5 MB and 20,000 data records per file. Quoted delimiters, newlines, escaped quotes and a BOM are supported. Export identifiers as text in your source system to preserve leading zeros.

Orders require `order_id` and `amount`. Optional fields: `customer`, `date`, `refund_amount` (expected refund), `currency`.

Payments require `transaction_id`, `order_id`, `amount` (original gross amount) and `status`. Optional fields: `fee`, `refund_amount` (cumulative actual refund), `date`, `currency`. Every payment row is one current transaction snapshot, not a separate refund event or historical status update. Fees are supplied totals, including any taxes or charges you want deducted.

Map fees and refunds wherever possible. A blank or unmapped fee or actual refund means unknown, flags incomplete data, and prevents a complete net estimate. A blank expected refund requires refund review. Use explicit zero when none apply. Mapped currencies must contain INR. Amounts must be non-negative with at most two decimal places. Refunds cannot exceed the associated original gross amount. Reports with duplicate order or payment IDs fail with both record numbers.

Recognized successful statuses: captured, paid, success, successful, succeeded, completed, settled, refunded, partially_refunded. Refunded transactions must retain their original capture amount. Pending statuses: pending, authorized, authorised, processing, created. Failed statuses: failed, cancelled, canceled, declined. Other statuses are flagged as unknown. Status names are case-insensitive with spaces and hyphens normalized to underscores.

## Calculation rules

- Trim IDs, then match exactly and case-sensitively. Never fuzzy match by amount or date.
- Add distinct successful payments per order using integer paise. No tolerance or floating point money arithmetic.
- Compare captured gross with order amount. Compare expected and actual refunds separately. Retain multiple simultaneous issues.
- Exclude pending, failed and unknown statuses from captured gross. Unknown statuses make net estimates incomplete. An additional pending payment remains a review item even if successful payments match the order.
- Net proceeds estimate = captured gross − known captured-payment refunds − all reported fees, including any fees on failed or pending attempts. Missing fees or refunds make the estimate unavailable. This does not verify bank settlement.
- Orphan payments have no expected order amount and remain in payment totals. Missing and failed-only orders require review.
- Marking reviewed adds an annotation only. It never changes exception counts, amounts, or matching status. Rerunning clears annotations.
- CSV output guards spreadsheet formula injection in text cells.

## Validation

Pure calculation and CSV tests cover split payments, exact one-paisa differences, status handling, refunds, missing data, duplicate IDs, invalid money, CSV quoting, formula-safe output, and summary consistency. Static entrypoints, module syntax, references, and local HTTP response are checked. Browser interaction/visual QA was not requested. WebMCP tools are feature-detected; live browser WebMCP contract verification was unavailable in this run.

Three page-scoped WebMCP tools reuse visible actions: `read_reconciliation_summary`, `run_reconciliation`, and `open_reconciliation_record`. Monetary tool results use integer INR paise.

## Publishing

The public website is served by GitHub Pages. Pushes to `main` run `.github/workflows/pages.yml`, which publishes the static `dist` directory. Assets and JavaScript imports use relative paths so they work beneath the repository URL. No account or sign-in is required to use the demo.
