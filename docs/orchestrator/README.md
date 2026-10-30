# Orchestrator working files

Backup of files the orchestrator chat ("Master BOOQ development") made outside the product code, so nothing lives only in a temporary session.

- `copy-editor/`: source of the Copy Editor artifact (https://claude.ai/artifact/2y8NHXXmZXB2vSUjGz7z9V): `template.html`, the built `page.html`, the `en.json`/`th.json` it was built from, and `check.js`.
- `slides-deck/`: source of the Slides deck artifact (https://claude.ai/artifact/QkbRoJzjVDxdefyUQLk2h5).
- `canvas-backup/`: a downloaded copy of the design canvas artifact (https://claude.ai/artifact/3Jo8snhzdEXEhVhrRqi3ea), the digest of it (`design-digest.md`) and the canvas notes extract (`notes.txt`). The live canvas is the source; this is only a backup.
- `tools/`: helper scripts. `jsonmerge.py` resolves merge conflicts in `locales/pending/*.json` by a deep union of both sides; `ex.py` extracted text from the canvas.
