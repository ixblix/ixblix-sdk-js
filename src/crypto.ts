/**
 * Operator-side end-to-end encryption helpers for ixblix.
 *
 * The operator (desk/CRM) holds a persistent RSA-OAEP keypair. The private key
 * never leaves the operator process; only the public key is registered with the
 * ixblix backend at conversation creation so the customer can encrypt messages to
 * the operator.
 *
 * Outgoing messages are encrypted to the customer's public key; incoming
 * messages are decrypted with the operator's private key.
 *
 * The scheme is hybrid: each message is encrypted with a fresh AES-256-GCM key,
 * and that AES key is wrapped (RSA-OAEP/SHA-256) both to the recipient
 * (`encryptedKey`) and to the sender's own public key (`selfEncryptedKey`) so
 * the sender can read back its own sent messages.
 */
import {
  generateKeyPairSync,
  createPublicKey,
  createPrivateKey,
  publicEncrypt,
  privateDecrypt,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  constants,
  type KeyObject,
} from "node:crypto";
import type {
  MessagePayload,
  MessageAttachments,
} from "./types.js";

/** Encode a Buffer as a URL-safe base64 string (no padding). */
function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Decode a base64 string (URL-safe or standard) into a Buffer. */
function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/** Generate a random identifier for a public key. */
function generateKeyId(): string {
  return randomBytes(16).toString("base64url");
}

/** An RSA keypair plus its identifier, as used by the operator. */
export interface OperatorKeyPair {
  /** Identifier of the public key, sent in the message envelope. */
  keyId: string;
  /** Base64 SPKI DER of the public key, registered with ixblix. */
  publicKeySpki: string;
  /** The private key object. Never send this to ixblix. */
  privateKey: KeyObject;
}

/** Options for generating an operator keypair. */
export interface GenerateKeyPairOptions {
  /** RSA modulus length in bits. Defaults to 2048. */
  modulusLength?: number;
}

/**
 * Generate a fresh RSA keypair for the operator. The private key stays on the
 * operator's side; only `publicKeySpki` should be registered with ixblix.
 */
export function generateOperatorKeyPair(
  options: GenerateKeyPairOptions = {},
): OperatorKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: options.modulusLength ?? 2048,
    publicExponent: 0x10001,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const publicSpki = createPublicKey(publicKey)
    .export({ type: "spki", format: "der" })
    .toString("base64");
  const keyId = generateKeyId();

  return {
    keyId,
    publicKeySpki: publicSpki,
    privateKey: createPrivateKey(privateKey),
  };
}

/** Import a base64 SPKI DER RSA public key (e.g. the customer's key). */
export function importPublicKey(spkiBase64: string): KeyObject {
  const der = Buffer.from(spkiBase64, "base64");
  return createPublicKey({ key: der, type: "spki", format: "der" });
}

/**
 * Encrypt a plaintext message to the recipient's RSA public key.
 *
 * Returns the envelope fields expected by the ixblix backend. The AES key is
 * wrapped both to the recipient (`encryptedKey`) and to the sender's own public
 * key (`selfEncryptedKey`) so the sender can read back its own sent message.
 */
export function encryptToRecipient(
  plaintext: string,
  recipientPublicKeySpki: string,
  senderKeyId: string,
  senderPublicKeySpki: string,
): {
  content: string;
  iv: string;
  authTag: string;
  encryptedKey: string;
  selfEncryptedKey: string;
  keyId: string;
} {
  const recipientKey = importPublicKey(recipientPublicKeySpki);
  const senderKey = importPublicKey(senderPublicKeySpki);

  // Fresh AES-256-GCM key per message.
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);

  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Wrap the AES key with the recipient's RSA public key.
  // `RSA_PKCS1_OAEP_PADDING` + `oaepHash: "sha256"` matches the Web Crypto
  // RSA-OAEP/SHA-256 used by the customer browser. (Note: padding value 1 is
  // PKCS#1 v1.5, NOT OAEP, and is incompatible with Web Crypto.)
  const encryptedKey = publicEncrypt(
    {
      key: recipientKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey,
  );
  // Also wrap the AES key with the sender's own public key, so the sender can
  // read back its own sent message.
  const selfEncryptedKey = publicEncrypt(
    {
      key: senderKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey,
  );

  return {
    content: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(new Uint8Array(iv)),
    authTag: bytesToBase64(new Uint8Array(authTag)),
    encryptedKey: bytesToBase64(new Uint8Array(encryptedKey)),
    selfEncryptedKey: bytesToBase64(new Uint8Array(selfEncryptedKey)),
    keyId: senderKeyId,
  };
}

/**
 * Decrypt a message envelope using the operator's private key. Tries the
 * recipient-wrapped key (`encryptedKey`) first, then the sender-wrapped key
 * (`selfEncryptedKey`), so the operator can read back its own sent messages
 * too. Returns null when decryption fails.
 */
export function decryptEnvelope(
  envelope: {
    content: string;
    iv?: string;
    authTag?: string;
    encryptedKey?: string;
    selfEncryptedKey?: string;
  },
  privateKey: KeyObject,
): string | null {
  const wrappedKeys = [envelope.encryptedKey, envelope.selfEncryptedKey].filter(
    (key): key is string => Boolean(key),
  );
  for (const wrappedKey of wrappedKeys) {
    try {
      if (!envelope.iv || !envelope.authTag) {
        return null;
      }
      const aesKey = privateDecrypt(
        {
          key: privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256", // match Web Crypto RSA-OAEP/SHA-256
        },
        Buffer.from(base64ToBytes(wrappedKey)),
      );
      const decipher = createDecipheriv(
        "aes-256-gcm",
        aesKey,
        Buffer.from(base64ToBytes(envelope.iv)),
      );
      decipher.setAuthTag(Buffer.from(base64ToBytes(envelope.authTag)));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(base64ToBytes(envelope.content))),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch {
      // Try the next wrapped key.
    }
  }
  return null;
}

/**
 * Decrypt the attachments blob of a rich message.
 *
 * The attachments blob is `base64(iv || authTag || ciphertext)`. The AES key
 * is unwrapped from the message envelope using the operator's private key.
 */
export function decryptAttachments(
  attachmentsBlob: string,
  envelope: {
    encryptedKey?: string;
    selfEncryptedKey?: string;
  },
  privateKey: KeyObject,
): string | null {
  const wrappedKeys = [envelope.encryptedKey, envelope.selfEncryptedKey].filter(
    (key): key is string => Boolean(key),
  );

  const bytes = Buffer.from(base64ToBytes(attachmentsBlob));
  if (bytes.length < 28) {
    return null;
  }
  const iv = bytes.subarray(0, 12);
  const authTag = bytes.subarray(12, 28);
  const ciphertext = bytes.subarray(28);

  for (const wrappedKey of wrappedKeys) {
    try {
      const aesKey = privateDecrypt(
        {
          key: privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        Buffer.from(base64ToBytes(wrappedKey)),
      );
      const decipher = createDecipheriv("aes-256-gcm", aesKey, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch {
      // Try the next wrapped key.
    }
  }
  return null;
}

/**
 * Encrypt a full message payload (content + optional media + optional
 * attachments) with a single AES-256-GCM key.
 *
 * Each encrypted part uses a distinct IV so the nonce is never reused, but all
 * share the same AES key. The key is wrapped (RSA-OAEP/SHA-256) both to the
 * recipient and to the sender so either party can decrypt.
 *
 * This is the unified encryption entry point used by `sendEncryptedMessage`.
 * Pass only the parts you need:
 * - Text only: `content` → `mediaContent`/`mediaIv`/`mediaAuthTag` are omitted.
 * - Media only: `fileBytes` → `content` is empty string, `contentIv`/`contentAuthTag` omitted.
 * - Media + caption: both `content` and `fileBytes` → all fields populated.
 * - Any combination + `attachments` → attachments blob always present when supplied.
 */
export function encryptMessagePayload(
  input: {
    /** Plaintext content (caption for media messages). */
    content?: string;
    /** Plaintext media file bytes. */
    fileBytes?: Uint8Array;
    /** Rich message attachments (buttons, vcard, location, operator identity). */
    attachments?: MessageAttachments | null;
  },
  recipientPublicKeySpki: string,
  senderKeyId: string,
  senderPublicKeySpki: string,
): MessagePayload {
  const recipientKey = importPublicKey(recipientPublicKeySpki);
  const senderKey = importPublicKey(senderPublicKeySpki);

  // Single AES key for all parts.
  const aesKey = randomBytes(32);

  // Encrypt content (caption) if provided.
  let contentCiphertext = Buffer.alloc(0);
  const contentIv = randomBytes(12);
  let contentAuthTag = Buffer.alloc(0);
  if (input.content) {
    const contentCipher = createCipheriv("aes-256-gcm", aesKey, contentIv);
    contentCiphertext = Buffer.concat([
      contentCipher.update(input.content, "utf8"),
      contentCipher.final(),
    ]);
    contentAuthTag = contentCipher.getAuthTag();
  }

  // Encrypt media file if provided.
  let mediaCiphertext: Buffer | undefined;
  let mediaIv: Buffer | undefined;
  let mediaAuthTag: Buffer | undefined;
  if (input.fileBytes) {
    mediaIv = randomBytes(12);
    const mediaCipher = createCipheriv("aes-256-gcm", aesKey, mediaIv);
    mediaCiphertext = Buffer.concat([
      mediaCipher.update(input.fileBytes),
      mediaCipher.final(),
    ]);
    mediaAuthTag = mediaCipher.getAuthTag();
  }

  // Encrypt attachments if provided.
  let encryptedAttachments: string | undefined;
  if (input.attachments) {
    const attachmentsJson = JSON.stringify(input.attachments);
    const attachmentsIv = randomBytes(12);
    const attachmentsCipher = createCipheriv(
      "aes-256-gcm",
      aesKey,
      attachmentsIv,
    );
    const attachmentsCiphertext = Buffer.concat([
      attachmentsCipher.update(attachmentsJson, "utf8"),
      attachmentsCipher.final(),
    ]);
    const attachmentsAuthTag = attachmentsCipher.getAuthTag();
    const combined = Buffer.concat([
      attachmentsIv,
      attachmentsAuthTag,
      attachmentsCiphertext,
    ]);
    encryptedAttachments = bytesToBase64(new Uint8Array(combined));
  }

  // Wrap the AES key to both recipient and sender.
  const encryptedKey = publicEncrypt(
    {
      key: recipientKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey,
  );
  const selfEncryptedKey = publicEncrypt(
    {
      key: senderKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey,
  );

  return {
    content: bytesToBase64(new Uint8Array(contentCiphertext)),
    contentIv: bytesToBase64(new Uint8Array(contentIv)),
    contentAuthTag: bytesToBase64(new Uint8Array(contentAuthTag)),
    mediaContent: mediaCiphertext
      ? bytesToBase64(new Uint8Array(mediaCiphertext))
      : undefined,
    mediaIv: mediaIv ? bytesToBase64(new Uint8Array(mediaIv)) : undefined,
    mediaAuthTag: mediaAuthTag
      ? bytesToBase64(new Uint8Array(mediaAuthTag))
      : undefined,
    attachments: encryptedAttachments,
    encryptedKey: bytesToBase64(new Uint8Array(encryptedKey)),
    selfEncryptedKey: bytesToBase64(new Uint8Array(selfEncryptedKey)),
    keyId: senderKeyId,
  };
}

/**
 * Decrypt a media envelope using the operator's private key. Tries the wrapped key first, then the sender-wrapped key. Returns the
 * recipient-wrapped key first, then the sender-wrapped key. Returns the
 * plaintext file bytes, or null when decryption fails.
 */
export function decryptMediaEnvelope(
  envelope: {
    content: string;
    iv?: string;
    authTag?: string;
    encryptedKey?: string;
    selfEncryptedKey?: string;
  },
  privateKey: KeyObject,
): Uint8Array | null {
  const wrappedKeys = [envelope.encryptedKey, envelope.selfEncryptedKey].filter(
    (key): key is string => Boolean(key),
  );
  for (const wrappedKey of wrappedKeys) {
    try {
      if (!envelope.iv || !envelope.authTag) {
        return null;
      }
      const aesKey = privateDecrypt(
        {
          key: privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        Buffer.from(base64ToBytes(wrappedKey)),
      );
      const decipher = createDecipheriv(
        "aes-256-gcm",
        aesKey,
        Buffer.from(base64ToBytes(envelope.iv)),
      );
      decipher.setAuthTag(Buffer.from(base64ToBytes(envelope.authTag)));
      return Buffer.concat([
        decipher.update(Buffer.from(base64ToBytes(envelope.content))),
        decipher.final(),
      ]);
    } catch {
      // Try the next wrapped key.
    }
  }
  return null;
}
