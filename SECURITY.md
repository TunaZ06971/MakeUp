# Security and privacy

MakeUp is an experimental capture and virtual makeup application, not an identity verification or biometric authentication system.

## Reporting a problem

Do not put live credentials, face images, capture archives, private database exports or unredacted logs in public issues. Report a minimal redacted reproduction. If this repository offers GitHub's private vulnerability reporting, use that channel for sensitive details; otherwise open an issue asking for a private reporting channel without disclosing the exploit or personal data.

If a credential was exposed, revoke/rotate it at its provider first. Removing a file or adding `.gitignore` does not revoke credentials, erase Git history or remove existing downloads and caches.

## Data boundaries

- Camera access requires a user action. Audio is not recorded by the continuous Web capture flow.
- Face media, landmarks, depth and reconstructed appearance stay in browser/device storage by default. Exports remain sensitive even if their filename has no person's name.
- Firebase can contain account/profile and recipe data. Local emulator exports are private data too.
- `VITE_*` values become part of client code: never put model-service secrets or service-account credentials there.
- The research clients under `scripts/model-eval` are separate, opt-in network tools. Do not connect them to automatic personal-data uploads.
- Public source code does not mean that the prototype is ready for production security or biometric use.

See [the public data policy](docs/PUBLIC_DATA_POLICY.md) and [the contribution checks](CONTRIBUTING.md). Automated scanning reduces accidental disclosure; it is not a guarantee that all sensitive content has been detected.

## Dependency audit snapshot

On 2026-09-09 the public release upgraded the root development tools to Firebase CLI 15.30.0 and Firebase Admin 14.3.0, removing the high/critical findings in the previous lockfile. `npm audit` still reports 13 moderate findings in the root development-tool dependency graph; the Web dependency graph reports none at this check. These counts can change as advisories are updated.

Do not expose emulator/development endpoints to untrusted networks. Remaining transitive major-version upgrades have not been forced merely to clear the audit count. CI rejects high/critical root findings and moderate-or-higher Web findings; this threshold is not a claim that the remaining findings are harmless or that production deployment is approved.
