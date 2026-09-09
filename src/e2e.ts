/**
 * End-to-end integration test for the ixblix SDK.
 *
 * This test exercises the full operator flow against a running ixblix backend:
 * company onboarding → create conversation → customer joins → encrypted
 * messages both directions → media round-trip.
 *
 * Prerequisites:
 * - A running ixblix backend (default http://localhost:3000).
 * - The backend must have at least one public plan seeded.
 *
 * Run with: `npx tsx src/e2e.test.ts` (or `npm run test:e2e`).
 */
import {
  IxblixClient,
  generateOperatorKeyPair,
  encryptToRecipient,
  decryptEnvelope,
  encryptMediaToRecipient,
  decryptMediaEnvelope,
  type Message,
} from "./index.js";

const BASE_URL = process.env.IXBLIX_API_URL || "http://localhost:3000";

/** Minimal customer-side helpers (the SDK is operator-focused). */
async function customerRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string>),
    },
  });
  const data = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(
      `customer ${path} failed: ${response.status} ${JSON.stringify(data)}`,
    );
  }
  return data;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function main(): Promise<void> {
  // 1. Company onboarding via the SDK.
  const bootstrap = new IxblixClient({ baseUrl: BASE_URL });
  const handle = `sdk-e2e-${Date.now()}`;
  const register = await bootstrap.registerCompany({
    name: "SDK E2E Test",
    handle,
    paymentProvider: "dummy",
  });
  const activate = await bootstrap.activateCompany(
    register.company.id,
    register.payment.transactionId,
  );
  assert(activate.status === "ACTIVE", "company should be active");
  assert(activate.apiKey.startsWith("ixblix_"), "should return an API key");

  // 2. Operator client with the fresh API key.
  const ixblix = new IxblixClient({
    baseUrl: BASE_URL,
    apiKey: activate.apiKey,
  });

  // 3. Operator keypair.
  const operatorKey = generateOperatorKeyPair();

  // 4. Register the operator key as the company encryption key.
  await ixblix.registerEncryptionKey({
    keyId: operatorKey.keyId,
    publicKey: operatorKey.publicKeySpki,
  });

  // 5. Create a conversation.
  const created = await ixblix.createConversation({
    contact: {
      externalId: `sdk-e2e-${Date.now()}`,
      name: "E2E Customer",
      metadata: { source: "sdk-e2e" },
    },
    channel: "whatsapp",
  });
  assert(
    created.conversation.keyStatus === "AWAITING_CUSTOMER",
    "starts awaiting customer",
  );
  assert(created.deeplink.length > 0, "returns a deeplink");

  // 6. Customer joins: generate a keypair and register its public key.
  const customerKey = generateOperatorKeyPair();
  await customerRequest(
    `/api/conversations/${created.conversation.token}/key`,
    {
      method: "POST",
      body: JSON.stringify({ publicKey: customerKey.publicKeySpki }),
    },
  );

  // 7. Operator polls until the customer has joined.
  let keys = await ixblix.getConversationKeys(created.conversation.id);
  let attempts = 0;
  while (keys.keyStatus !== "ACTIVE" || !keys.customerPublicKey) {
    if (attempts++ > 20) throw new Error("customer never joined");
    await new Promise((r) => setTimeout(r, 200));
    keys = await ixblix.getConversationKeys(created.conversation.id);
  }
  assert(
    keys.customerPublicKey === customerKey.publicKeySpki,
    "operator sees customer key",
  );
  const customerPublicKey = keys.customerPublicKey as string;

  // 8. Operator sends an encrypted message.
  const outbound = encryptToRecipient(
    "Hello from the operator!",
    customerPublicKey,
    operatorKey.keyId,
    operatorKey.publicKeySpki,
  );
  const sent = await ixblix.sendCompanyMessage(
    created.conversation.id,
    outbound,
  );
  assert(sent.senderType === "COMPANY", "message sent by company");
  assert(sent.contentEncrypted === true, "message is encrypted");

  // 9. Customer decrypts the operator's message.
  const customerPlain = decryptEnvelope(sent, customerKey.privateKey);
  assert(
    customerPlain === "Hello from the operator!",
    "customer can decrypt operator message",
  );

  // 10. Operator reads back its own sent message (self-read).
  const operatorSelfRead = decryptEnvelope(sent, operatorKey.privateKey);
  assert(
    operatorSelfRead === "Hello from the operator!",
    "operator can self-read its message",
  );

  // 11. Customer sends an encrypted reply (via the contact endpoint).
  const replyEnvelope = encryptToRecipient(
    "Hello from the customer!",
    keys.operatorPublicKey as string,
    customerKey.keyId,
    customerKey.publicKeySpki,
  );
  const reply = await customerRequest<{ id: string }>(`/api/messages/contact`, {
    method: "POST",
    body: JSON.stringify({
      token: created.conversation.token,
      content: replyEnvelope.content,
      contentType: "text",
      iv: replyEnvelope.iv,
      authTag: replyEnvelope.authTag,
      encryptedKey: replyEnvelope.encryptedKey,
      selfEncryptedKey: replyEnvelope.selfEncryptedKey,
      keyId: replyEnvelope.keyId,
    }),
  });

  // 12. Operator lists and decrypts the customer's reply.
  const messages = await ixblix.listMessages(created.conversation.id);
  const replyFromList = messages.find((m) => m.id === reply.id);
  assert(Boolean(replyFromList), "reply appears in the message list");
  const operatorPlain = decryptEnvelope(
    replyFromList as Message,
    operatorKey.privateKey,
  );
  assert(
    operatorPlain === "Hello from the customer!",
    "operator can decrypt customer reply",
  );

  // 12. Media round-trip: operator uploads an encrypted image.
  const imageBytes = new Uint8Array([
    137, 80, 78, 71, 1, 2, 3, 4, 5, 250, 251, 252,
  ]);
  const mediaEnvelope = encryptMediaToRecipient(
    imageBytes,
    customerPublicKey,
    operatorKey.keyId,
    operatorKey.publicKeySpki,
  );
  const mediaMessage = await ixblix.sendCompanyMedia(
    created.conversation.id,
    {
      data: Buffer.from(mediaEnvelope.content, "base64"),
      fileName: "test.png",
      mimeType: "image/png",
    },
    mediaEnvelope,
  );
  assert(Boolean(mediaMessage.mediaId), "media message has a mediaId");

  // 13. Operator downloads and decrypts its own media (self-read).
  const download = await ixblix.downloadCompanyMedia(
    mediaMessage.mediaId as string,
  );
  const decryptedMedia = decryptMediaEnvelope(
    {
      content: Buffer.from(download.data).toString("base64"),
      iv: download.media.iv,
      authTag: download.media.authTag,
      encryptedKey: download.media.encryptedKey,
      selfEncryptedKey: download.media.selfEncryptedKey,
    },
    operatorKey.privateKey,
  );
  assert(decryptedMedia !== null, "media decrypts");
  assert(
    Array.from(decryptedMedia as Uint8Array).join(",") ===
      Array.from(imageBytes).join(","),
    "media bytes match",
  );

  // 14. Balance is available.
  const balance = await ixblix.getBalance();
  assert(typeof balance.balanceCents === "number", "balance is available");

  // eslint-disable-next-line no-console
  console.log("E2E test passed ✓");
  // eslint-disable-next-line no-console
  console.log(`  Company: ${register.company.handle}`);
  // eslint-disable-next-line no-console
  console.log(`  Conversation: ${created.conversation.id}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
