---
"@uwbench/securelend-adapter": patch
---

Pass the SecureLend platform draft through as submitted. Memo cells come from draft_memo_from_file. Null keys are dropped and evidence factId is copied to sourceId only when sourceId is missing. Set SECURELEND_ADAPTER_MODE=shaped to restore case-package shaping.
