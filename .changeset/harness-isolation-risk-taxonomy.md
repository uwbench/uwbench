---
"@uwbench/harness-adapter": patch
"@uwbench/runner": patch
"@uwbench/case-schema": patch
---

Isolate live harness agents from the checkout and gold files, and send every case the full public risk-id taxonomy. Gold risk ids use that taxonomy and matching stays exact.
