/**
 * Persistence helpers for the operator RSA keypair.
 *
 * The operator's private key must be stored securely and never sent to ixblix.
 * These helpers load-or-create a keypair on disk (private key written with mode
 * `0600`). Integrations that use a secret manager or KMS should instead manage
 * the keypair themselves and pass the resulting `OperatorKeyPair` to the SDK.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { createPrivateKey } from "node:crypto";
import {
  generateOperatorKeyPair,
  type OperatorKeyPair,
} from "./crypto.js";

/**
 * Load the operator keypair from disk, generating and persisting it if absent.
 *
 * @param directory Directory where the keypair files are stored.
 * @returns The loaded (or freshly generated) keypair.
 */
export function loadOrCreateOperatorKey(directory: string): OperatorKeyPair {
  const privateKeyFile = path.join(directory, "operator-private.pem");
  const publicKeyFile = path.join(directory, "operator-public.spki");
  const keyIdFile = path.join(directory, "operator-key-id");

  if (
    existsSync(privateKeyFile) &&
    existsSync(publicKeyFile) &&
    existsSync(keyIdFile)
  ) {
    const privatePem = readFileSync(privateKeyFile, "utf8");
    const publicSpki = readFileSync(publicKeyFile, "utf8");
    const keyId = readFileSync(keyIdFile, "utf8");
    return {
      keyId,
      publicKeySpki: publicSpki,
      privateKey: createPrivateKey(privatePem),
    };
  }

  const keypair = generateOperatorKeyPair();

  mkdirSync(directory, { recursive: true });
  writeFileSync(privateKeyFile, keypair.privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
  });
  writeFileSync(publicKeyFile, keypair.publicKeySpki);
  writeFileSync(keyIdFile, keypair.keyId);

  return keypair;
}
