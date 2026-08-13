# Security policy

## Supported versions

Lupinum OG provides security fixes for the latest published minor release.
Before version 1.0, a security fix can include a hard cut when a compatibility
path would keep an unsafe behavior.

## Report a vulnerability

Use GitHub private vulnerability reporting for this repository. If that
channel is not available, send the report to [info@lupinum.com](mailto:info@lupinum.com).

Do not put an exploit, customer document, private URL, credential, or local
filesystem path in a public issue.

Include:

- The affected version.
- The Node and Nuxt versions.
- A minimal reproduction.
- The expected security impact.
- Any known mitigation.

Lupinum OG will acknowledge a complete report within five business days. We
will coordinate disclosure after a fix is available.

Treat these defects as security-sensitive:

- Preview data enters a production artifact.
- Server-only code enters a client bundle.
- One render can read data from another render.
- A resource bypasses its path, type, size, or remote-host policy.
- A render silently loses document content.
- A release artifact differs from the artifact that maintainers approved.

## Publication security

The release workflow uses npm trusted publishing with publish permission. It
does not use a long-lived npm publication token. A maintainer must inspect the
certified artifact and approve the protected `npm` environment deployment.

Agents and normal CI jobs must not publish packages, approve protected
deployments, move dist-tags, or create release tags.
