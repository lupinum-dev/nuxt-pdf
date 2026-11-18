---
"@lupinum/nuxt-pdf": patch
---

Fix the time limit error so that it always names `pdf.limits.timeoutMs`. In a rare timing case the message left the option out.
