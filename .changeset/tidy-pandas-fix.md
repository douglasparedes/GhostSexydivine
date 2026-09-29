---
"@tryghost/koenig-lexical": patch
"@tryghost/kg-unsplash-selector": patch
---

Fixed library builds on Windows. The Rollup `external` check and the svgr `include` pattern assumed POSIX path separators, so Windows builds either externalized in-repo modules or left raw `?react` imports in the output.
