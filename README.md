# ixblix SDK

Official TypeScript SDK for integrating desk/CRM systems with **ixblix**.
ixblix lets customer-service platforms
transfer conversations from original channels (WhatsApp, Instagram, etc.) to a
white-labeled web/mobile experience — with **end-to-end encryption** so the ixblix
backend never sees message content.

This SDK is the **operator (desk/CRM) side** of the integration. It provides:

- A typed HTTP client for the ixblix REST API (conversations, messages, media,
  keys, company onboarding, credits, webhook registration).
- End-to-end encryption helpers (RSA-OAEP + AES-256-GCM) so you can encrypt
  messages to your customers and decrypt theirs.
- Webhook parsing/verification helpers (HMAC-SHA256) so you can receive
  incoming messages and conversation events in real time without polling.

## Installation

```bash
npm install @ixblix/sdk-js
```

Requires Node.js >= 18.

## Quick start

```ts
import {
  IxblixClient,
  generateOperatorKeyPair,
  loadOrCreateOperatorKey,
  encryptToRecipient,
  decryptEnvelope,
} from "@ixblix/sdk-js";

// 1. Configure the client with your company API key.
const ixblix = new IxblixClient({
  baseUrl: "https://api.ixblix.app",
  apiKey: process.env.IXBLIX_API_KEY,
});

// 2. Hold a persistent RSA keypair. The private key never leaves your side.
//    Persist it once (e.g. loadOrCreateOperatorKey("./.keys")) and reuse it.
const operatorKey = generateOperatorKeyPair();

// 3. Create an overflow conversation for a contact.
const { conversation, deeplink } = await ixblix.createConversation({
  contact: {
    externalId: "whatsapp_5511999999999",
    name: "John Doe",
    phone: "+55 11 99999-9999",
  },
  channel: "whatsapp",
  operatorPublicKey: operatorKey.publicKeySpki,
});

// 4. Share `deeplink` with the contact. When they open it, their browser
//    generates a keypair and registers its public key with ixblix.

// 5. Wait for the customer to join. Prefer a webhook (`CUSTOMER_JOINED`) so
//    you don't poll. If you must poll, use getConversationKeys:
let keys = await ixblix.getConversationKeys(conversation.id);
while (keys.keyStatus !== "ACTIVE" || !keys.customerPublicKey) {
  await new Promise((r) => setTimeout(r, 2000));
  keys = await ixblix.getConversationKeys(conversation.id);
}

// 6. Encrypt and send a message to the customer.
const envelope = encryptToRecipient(
  "Hello! How can we help?",
  keys.customerPublicKey,
  operatorKey.keyId,
  operatorKey.publicKeySpki,
);
await ixblix.sendCompanyMessage(conversation.id, envelope);

// 7. Read incoming messages (decrypt with your private key). Prefer receiving
//    a `MESSAGE_RECEIVED` webhook and fetching the message, rather than
//    polling listMessages.
const messages = await ixblix.listMessages(conversation.id);
for (const message of messages) {
  if (!message.contentEncrypted) continue;
  const plaintext = decryptEnvelope(message, operatorKey.privateKey);
  console.log(plaintext);
}
```

## Company onboarding

Register a company (keyless), then activate it after payment to obtain the API
key:

```ts
const { company, payment } = await ixblix.registerCompany({
  name: "Acme CRM",
  slug: "acme-crm",
  paymentProvider: "dummy",
});

// After the payment is confirmed:
const { apiKey } = await ixblix.activateCompany(
  company.id,
  payment.transactionId,
);
```

## End-to-end encryption

ixblix uses a hybrid scheme:

- **RSA-OAEP** (2048-bit, SHA-256) to wrap a fresh per-message **AES-256-GCM**
  key.
- Each message's AES key is wrapped **twice**: to the recipient
  (`encryptedKey`) and to the sender's own public key (`selfEncryptedKey`), so
  each side can read back its own sent messages.

The SDK exposes:

| Function                                                               | Purpose                                     |
| ---------------------------------------------------------------------- | ------------------------------------------- |
| `generateOperatorKeyPair()`                                            | Generate a fresh RSA keypair.               |
| `loadOrCreateOperatorKey(dir)`                                         | Load-or-create a persisted keypair on disk. |
| `encryptToRecipient(text, recipientPub, senderKeyId, senderPub)`       | Encrypt an outgoing text message.           |
| `decryptEnvelope(message, privateKey)`                                 | Decrypt an incoming (or your own) message.  |
| `encryptMediaToRecipient(bytes, recipientPub, senderKeyId, senderPub)` | Encrypt an outgoing media file.             |
| `decryptMediaEnvelope(media, privateKey)`                              | Decrypt a media file.                       |

> **Security:** never send your private key to ixblix. Only the public key
> (`publicKeySpki`) is registered. Store the private key securely (the
> `loadOrCreateOperatorKey` helper writes it with mode `0600`).

## Webhooks

ixblix pushes events to your webhook URL so you can receive incoming messages and
conversation events in real time **without polling**. Configure your endpoint
and verify incoming payloads:

```ts
import { IxblixClient, verifyWebhook, WEBHOOK_SIGNATURE_HEADER } from "@ixblix/sdk-js";

// 1. Register your webhook URL. The returned secret is shown only once.
const ixblix = new IxblixClient({
  baseUrl: "https://api.ixblix.app",
  apiKey: process.env.IXBLIX_API_KEY,
});
const { webhookSecret } = await ixblix.updateWebhook({
  webhookUrl: "https://desk.example.com/ixblix/webhook",
});
// Store webhookSecret securely (e.g. process.env.IXBLIX_WEBHOOK_SECRET).

// 2. In your Express webhook handler, verify the HMAC signature:
app.post("/ixblix/webhook", (req, res) => {
  const signature = req.header(WEBHOOK_SIGNATURE_HEADER);
  const { event } = verifyWebhook(
    req.body,
    process.env.IXBLIX_WEBHOOK_SECRET,
    signature,
  );

  if (event.event === "MESSAGE_RECEIVED") {
    // A contact sent a message. Fetch and decrypt it:
    //   const messages = await ixblix.listMessages(event.conversationId);
    //   const message = messages.find((m) => m.id === event.messageId);
    //   const plaintext = decryptEnvelope(message, operatorKey.privateKey);
  } else if (event.event === "CUSTOMER_JOINED") {
    // The customer registered its public key; you can now encrypt to them.
  }
  res.status(200).end();
});
```

Webhook payloads are signed with HMAC-SHA256 using your webhook secret. Each
delivery also carries `X-Ixblix-Event-Id` (deduplicate on it — delivery is
at-least-once) and `X-Ixblix-Event`. See
[`docs/integrator/05-webhooks.md`](../docs/integrator/05-webhooks.md) for the
full event reference.

## Read receipts and presence

When your agents have displayed a customer-sent message, mark it as read so the
customer's chat app shows a read receipt:

```ts
await ixblix.markMessageReadByCompany(conversationId, messageId);
```

When the customer reads one of your messages, ixblix pushes a `MESSAGE_READ`
webhook to your endpoint (see the webhook handler above).

Report operator typing/recording so the customer's chat app can show an
indicator, or send `stopped` to clear it immediately:

```ts
await ixblix.reportCompanyPresence(conversationId, "typing"); // or "recording"
await ixblix.reportCompanyPresence(conversationId, "stopped");
```

## License

MIT
