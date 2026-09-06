# Orion Cloud repository credentials

Desktop repository access uses a durable device token independently of the
short-lived Orion account session. The implementation landed on `main` in
`2090af7692e82ee6b0595ed3ca3fe7ff6fed3ec3`; this document records its release
behavior and verification.

## Authorization and storage

An existing valid account session provisions the device token automatically
when repository access is needed. If the old account session has already
expired and no device token exists, sign in once to authorize this device.
Later account-session expiry does not invalidate the saved repository token.

Tokens are bound to the account and Cloud origin. Packaged Desktop encrypts
them with OS-backed safe storage in a separate, atomically replaced file with
owner-only permissions. When secure storage is unavailable, packaged Desktop
does not persist the token. Development builds follow the existing unencrypted
development-session behavior.

Concurrent requests share one provisioning operation. Sign-out clears local
authorization immediately and attempts remote revocation. Generation and
storage guards prevent an in-flight request from restoring credentials after
sign-out. If offline revocation fails, revoke the token in Cloud Settings.

Cloud enforces repository and Cloud API scopes independently. Token scopes do
not grant repository membership. Revocation is authoritative: Desktop does not
silently replace a rejected token with a fresh one.

## Git behavior and recovery

Authenticated Git commands isolate their credentials from inherited Git
helpers and authorization headers, reject redirects, and validate effective
push destinations. Background pushes use the same repository credential path.

Authentication failures request sign-in, permission failures identify missing
write access, and temporary authentication-service failures ask for a retry.
An older Cloud server without the device-token endpoint can temporarily use a
valid account session; a rejected saved device token never uses that fallback.

## Validation

```sh
node --no-warnings --test scripts/test-repository-credentials.mjs scripts/test-repository-signout-race.mjs scripts/test-git-credential-precedence.mjs
node --no-warnings scripts/test-source-control.mjs
```

Coverage includes concurrent provisioning, restart/session expiry, account and
origin changes, sign-out during issuance and persistence, credential precedence,
revocation/error handling, and legacy-server behavior. Cloud integration testing
also exercised Git push/read, REST scope enforcement, expiry, membership and
revocation. A production smoke check issued a temporary device token, read and
performed a no-op push, then revoked it and verified Git rejected it.

Run the signed macOS release workflow from updated local `main` as documented
in [macOS signing and notarization](macos-signing-release.md). Publishing source
does not update an installed Desktop binary; users must install the new release.
