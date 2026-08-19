# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT open a public GitHub issue** for security vulnerabilities.
2. Email the maintainers at: `security@example.com` _(replace with actual contact)_
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact assessment
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment** within 48 hours
- **Update** on investigation progress every 7 days
- **Resolution** timeline based on severity
- **Credit** in release notes (unless you prefer anonymity)

### Severity Levels

| Level    | Description                        | Response Time |
| -------- | ---------------------------------- | ------------- |
| Critical | Remote code execution, data breach | 24 hours      |
| High     | Authentication bypass, XSS         | 72 hours      |
| Medium   | CSRF, information disclosure       | 1 week        |
| Low      | Minor config issues                | 2 weeks       |

## Security Best Practices for Contributors

- Never commit secrets, API keys, or credentials
- Use environment variables for any configuration values
- Keep dependencies updated (`npm audit` and Dependabot)
- Review dependency supply chain (use `npm audit --json`)
- Follow the principle of least privilege for any external access

## Dependencies

This project uses only well-established, widely-used dependencies:

| Package    | Purpose             | Supply Chain Risk       |
| ---------- | ------------------- | ----------------------- |
| three      | 3D rendering engine | Low (major library)     |
| vite       | Build tool          | Low (major tool)        |
| playwright | E2E testing         | Low (Microsoft project) |
| vitest     | Unit testing        | Low (Vitest team)       |

All dependencies are listed in `package.json` and audited by Dependabot.
