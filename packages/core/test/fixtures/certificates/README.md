Test-only certificates, self-signed, made with OpenSSL. **Never use them for real documents**:
their private keys are public in this repository.

| File | Subject | Password | Notes |
|---|---|---|---|
| ana.p12 | Ana Prueba | `clave-ana` | RSA-2048, modern PKCS#12 (AES-256) |
| ana-legacy.pfx | Ana Prueba | `clave-ana` | Same key, legacy PKCS#12 (3DES/RC2), as older Windows exports |
| luis.p12 | Luis Prueba | `clave-luis` | RSA-2048, second signer |
| ec.p12 | Firma EC Prueba | `clave-ec` | ECDSA P-256 |
| *.crt | | | The certificates alone, to trust them when validating |

They are valid for 100 years; expiry is tested by passing a signing date (`now`).
