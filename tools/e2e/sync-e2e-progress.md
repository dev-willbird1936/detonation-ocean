# sync-e2e progress

GOAL: every synced item in `docs/desktop-parity/SYNC-AUDIT.md` round-trips through real UI clicks in both directions
(Windows → macOS → Windows and macOS → Windows → macOS), checked in the other shell's DOM, with zero non-loopback
requests and no page errors. macOS is the standard for look and behaviour.

DONE WHEN: every synced item has a passing round trip in both directions or an open request with a repro in
`docs/desktop-parity/requests/`; `node --test tests/*.test.mjs`, `node tools/e2e/desktops-e2e.mjs` and
`node tools/e2e/sync-e2e.mjs` are green; `docs/desktop-parity/screens/final-sync-*.png` inspected; the coverage
matrix in `tools/e2e/README.md` is current.

## Log

- `SYNC-AUDIT.md` not written yet when this suite started: cases follow the already-synced list in the task brief.
