/**
 * ixblix SDK — official client for desk/CRM integrations.
 *
 * Create overflow conversations, exchange end-to-end encrypted messages and
 * media, and manage company onboarding.
 *
 * ```ts
 * import { IxblixClient, generateOperatorKeyPair } from "ixblix-sdk-js";
 *
 * const ixblix = new IxblixClient({
 *   baseUrl: "https://api.ixblix.app",
 *   apiKey: process.env.IXBLIX_API_KEY,
 * });
 * ```
 */
export { IxblixClient } from "./client.js";
export type {
  IxblixClientOptions,
  MediaUpload,
  MediaDownload,
  BrandingFile,
} from "./client.js";

export { IxblixError } from "./errors.js";

export {
  generateOperatorKeyPair,
  importPublicKey,
  encryptToRecipient,
  decryptEnvelope,
  encryptMediaToRecipient,
  decryptMediaEnvelope,
} from "./crypto.js";
export type { OperatorKeyPair, GenerateKeyPairOptions } from "./crypto.js";

export { loadOrCreateOperatorKey } from "./keypair.js";

export { parseWebhook, verifyWebhook } from "./webhooks.js";
export type { ParsedWebhook } from "./webhooks.js";
export {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_ID_HEADER,
  WEBHOOK_EVENT_HEADER,
} from "./webhooks.js";

export type {
  SenderType,
  ConversationKeyStatus,
  ConversationStatus,
  ConsentStatus,
  Contact,
  ContactInput,
  Conversation,
  CompanyCustomization,
  CompanyCustomizationInput,
  CompanyEncryptionKey,
  RegisterCompanyEncryptionKeyInput,
  CompanySummary,
  CompanyProfile,
  CreateConversationResult,
  ConversationKeys,
  RegisterCustomerKeyResult,
  EraseConversationResult,
  Operator,
  OperatorInput,
  UpdateOperatorResult,
  MessageEnvelope,
  Message,
  MessageReaction,
  MessageReactionResult,
  Media,
  Plan,
  RegisterCompanyInput,
  PaymentInstructions,
  RegisterCompanyResult,
  ActivateCompanyResult,
  CompanyBalance,
  CreditPurchase,
  PurchaseCreditsResult,
  PaymentProvidersResult,
  OriginalChannelMessageInput,
  WebhookEvent,
  CompanyActivatedEvent,
  MessageReceivedEvent,
  MessageReadEvent,
  MessageReactionEvent,
  CustomerJoinedEvent,
  ConversationClosedEvent,
  PresenceEvent,
  BalanceLowEvent,
  IxblixErrorBody,
} from "./types.js";
