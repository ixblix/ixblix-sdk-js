import { describe, it, expect } from "vitest";
import {
  generateOperatorKeyPair,
  encryptToRecipient,
  decryptEnvelope,
  encryptMediaToRecipient,
  decryptMediaEnvelope,
} from "./crypto.js";

describe("crypto", () => {
  it("round-trips a text message between two parties", () => {
    const operator = generateOperatorKeyPair();
    const customer = generateOperatorKeyPair();

    const envelope = encryptToRecipient(
      "Hello, secure world!",
      customer.publicKeySpki,
      operator.keyId,
      operator.publicKeySpki,
    );

    // The customer can decrypt with its private key (recipient key).
    const customerPlain = decryptEnvelope(envelope, customer.privateKey);
    expect(customerPlain).toBe("Hello, secure world!");

    // The operator can read back its own sent message (self key).
    const operatorPlain = decryptEnvelope(envelope, operator.privateKey);
    expect(operatorPlain).toBe("Hello, secure world!");
  });

  it("returns null when decryption fails (wrong key)", () => {
    const operator = generateOperatorKeyPair();
    const customer = generateOperatorKeyPair();
    const eavesdropper = generateOperatorKeyPair();

    const envelope = encryptToRecipient(
      "secret",
      customer.publicKeySpki,
      operator.keyId,
      operator.publicKeySpki,
    );

    const result = decryptEnvelope(envelope, eavesdropper.privateKey);
    expect(result).toBeNull();
  });

  it("round-trips a media file", () => {
    const operator = generateOperatorKeyPair();
    const customer = generateOperatorKeyPair();
    const fileBytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252]);

    const envelope = encryptMediaToRecipient(
      fileBytes,
      customer.publicKeySpki,
      operator.keyId,
      operator.publicKeySpki,
    );

    const customerPlain = decryptMediaEnvelope(envelope, customer.privateKey);
    expect(customerPlain).not.toBeNull();
    expect(Array.from(customerPlain as Uint8Array)).toEqual(
      Array.from(fileBytes),
    );

    const operatorPlain = decryptMediaEnvelope(envelope, operator.privateKey);
    expect(operatorPlain).not.toBeNull();
    expect(Array.from(operatorPlain as Uint8Array)).toEqual(
      Array.from(fileBytes),
    );
  });

  it("produces distinct ciphertexts for the same plaintext (fresh AES key)", () => {
    const operator = generateOperatorKeyPair();
    const customer = generateOperatorKeyPair();

    const a = encryptToRecipient(
      "same",
      customer.publicKeySpki,
      operator.keyId,
      operator.publicKeySpki,
    );
    const b = encryptToRecipient(
      "same",
      customer.publicKeySpki,
      operator.keyId,
      operator.publicKeySpki,
    );

    expect(a.content).not.toBe(b.content);
    expect(a.iv).not.toBe(b.iv);
  });
});
