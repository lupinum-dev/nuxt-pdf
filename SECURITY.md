# Security policy

## Supported versions

Security fixes are provided for the latest published minor release. Before
1.0, fixes may include hard cutovers when keeping an unsafe compatibility path
would weaken the resource or server-only boundary.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a
public issue containing an exploit, customer document content, private URLs, or
filesystem paths. Include the affected version, runtime, minimal reproduction,
and expected impact. Maintainers will acknowledge a complete report within five
business days and coordinate disclosure after a fix is available.

Nuxt PDF treats preview-data leakage, server/client boundary violations,
cross-render contamination, resource-policy bypasses, and silent document
content loss as security-sensitive defects.
