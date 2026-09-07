/**
 * Shared types for the ixblix SDK.
 *
 * These types mirror the ixblix public REST API. They are intentionally
 * self-contained (no dependency on any private package) so the SDK can be
 * published and consumed by any desk/CRM integration.
 */

/** Who sent a message. */
export type SenderType = "CONTACT" | "COMPANY" | "SYSTEM";

/** Lifecycle state of the E2EE key exchange for a conversation. */
export type ConversationKeyStatus =
  "AWAITING_OPERATOR" | "AWAITING_CUSTOMER" | "ACTIVE";

/** Lifecycle state of a conversation. */
export type ConversationStatus = "ACTIVE" | "CLOSED" | "EXPIRED";

/** Consent state of a contact (LGPD). */
export type ConsentStatus = "PENDING" | "GRANTED" | "DENIED" | "REVOKED";

/** A contact (customer) in a conversation. */
export interface Contact {
  id: string;
  externalId: string;
  name?: string;
  phone?: string;
  email?: string;
  consentStatus: ConsentStatus;
}

/** Payload used to create a conversation for a contact. */
export interface ContactInput {
  /** Unique identifier of the contact in the original channel. */
  externalId: string;
  name?: string;
  phone?: string;
  email?: string;
  /** Free-form metadata from the CRM. */
  metadata?: Record<string, unknown>;
}

/** A conversation as returned by the ixblix API. */
export interface Conversation {
  id: string;
  token: string;
  status: ConversationStatus;
  keyStatus: ConversationKeyStatus;
  sourceChannel: string;
  createdAt: string;
}

/** Company branding customizations (white-label). */
export interface CompanyCustomization {
  id: string;
  brandName?: string;
  logoUrl?: string;
  primaryColor?: string;
  faviconUrl?: string;
  welcomeMessage?: string;
}

/** Company summary returned when creating a conversation. */
export interface CompanySummary {
  id: string;
  name: string;
  customizations?: CompanyCustomization;
}

/** Result of creating a conversation. */
export interface CreateConversationResult {
  conversation: Conversation;
  contact: Contact;
  /** URL to share with the contact so they can join the secure chat. */
  deeplink: string;
  company: CompanySummary;
}

/** Current E2EE key state of a conversation (operator view). */
export interface ConversationKeys {
  conversationId: string;
  keyStatus: ConversationKeyStatus;
  operatorPublicKey: string | null;
  customerPublicKey: string | null;
}

/** Result of registering the customer's public key. */
export interface RegisterCustomerKeyResult {
  conversationId: string;
  keyStatus: ConversationKeyStatus;
}

/** Result of erasing a conversation's encrypted content. */
export interface EraseConversationResult {
  conversationId: string;
  deletedMessages: number;
}

/**
 * Cryptographic envelope attached to an encrypted message or media file.
 *
 * The ixblix backend only ever stores and relays these fields — it never sees the
 * plaintext content nor any private key. `content` holds the base64 AES-GCM
 * ciphertext; `encryptedKey` holds the per-message AES key wrapped to the
 * recipient's RSA-OAEP public key, and `selfEncryptedKey` holds the same AES
 * key wrapped to the sender's own public key so the sender can read back its
 * own sent messages.
 */
export interface MessageEnvelope {
  /** Base64 AES-256-GCM ciphertext of the plaintext content. */
  content: string;
  /** Base64 AES-GCM initialization vector (12 bytes). */
  iv: string;
  /** Base64 AES-GCM authentication tag (16 bytes). */
  authTag: string;
  /** Base64 RSA-OAEP-wrapped per-message AES key (to the recipient). */
  encryptedKey: string;
  /** Base64 RSA-OAEP-wrapped per-message AES key (to the sender, for self-read). */
  selfEncryptedKey: string;
  /** Identifier of the sender's public key. */
  keyId: string;
}

/** A message as returned by the ixblix API. */
export interface Message {
  id: string;
  conversationId: string;
  senderType: SenderType;
  /** Plaintext for legacy/system messages, or base64 ciphertext when encrypted. */
  content: string;
  contentType: string;
  /** True when `content` is ciphertext and the envelope fields are populated. */
  contentEncrypted: boolean;
  keyId?: string;
  iv?: string;
  authTag?: string;
  encryptedKey?: string;
  selfEncryptedKey?: string;
  /** Present when the message carries an attached media file. */
  mediaId?: string;
  media?: Media;
  sentAt: string;
}

/** Metadata of a media file attached to a message. */
export interface Media {
  id: string;
  companyId: string;
  conversationId: string;
  messageId?: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  iv?: string;
  authTag?: string;
  encryptedKey?: string;
  selfEncryptedKey?: string;
  keyId?: string;
  createdAt: string;
}

/** A subscription plan offered by ixblix. */
export interface Plan {
  id: string;
  name: string;
  description?: string;
  billingType: "MESSAGES" | "CONVERSATIONS" | "COMPANY" | "TIME" | "CHANNEL";
  includedConversations?: number | null;
  includedMessages?: number | null;
  durationDays?: number | null;
  priceCents: number;
  overagePriceCents?: number | null;
  isActive: boolean;
  isPublic: boolean;
  createdAt: string;
}

/** Company registration payload (keyless onboarding). */
export interface RegisterCompanyInput {
  name: string;
  slug: string;
  planId?: string;
  paymentProvider?: string;
  confirmationWebhookUrl?: string;
}

/** Payment instructions returned when registering a company. */
export interface PaymentInstructions {
  transactionId: string;
  provider: string;
  amountCents: number;
  currency: string;
  confirmationUrl: string;
  status: string;
}

/** Result of registering a company. */
export interface RegisterCompanyResult {
  company: {
    id: string;
    name: string;
    slug: string;
    status: string;
    planId?: string;
    createdAt: string;
  };
  payment: PaymentInstructions;
}

/** Result of activating a company (payment confirmed). */
export interface ActivateCompanyResult {
  apiKey: string;
  status: string;
}

/** Company balance / plan state. */
export interface CompanyBalance {
  id: string;
  name: string;
  balanceCents: number;
  planId?: string;
  planExpiresAt?: string;
}

/** A credit purchase record. */
export interface CreditPurchase {
  id: string;
  companyId: string;
  amountCents: number;
  currency: string;
  provider: string;
  providerTransactionId?: string;
  status: "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED";
  metadata?: Record<string, unknown>;
  purchasedAt: string;
  createdAt: string;
}

/** Result of purchasing credits. */
export interface PurchaseCreditsResult {
  purchase: CreditPurchase;
  result: {
    success: boolean;
    transactionId?: string;
    provider?: string;
  };
}

/** Available payment providers. */
export interface PaymentProvidersResult {
  providers: string[];
}

/** Payload relayed from the original channel via webhook. */
export interface OriginalChannelMessageInput {
  conversationId: string;
  /** Base64 AES-GCM ciphertext (end-to-end encrypted). */
  content: string;
  iv: string;
  authTag: string;
  encryptedKey: string;
  selfEncryptedKey: string;
  keyId: string;
  /** Free-form metadata from the original channel (e.g. channelMessageId). */
  metadata?: Record<string, unknown>;
}

/** Webhook event payloads ixblix may deliver to a company. */
export type WebhookEvent =
  | CompanyActivatedEvent
  | MessageReceivedEvent
  | MessageReadEvent
  | CustomerJoinedEvent
  | ConversationClosedEvent
  | PresenceEvent
  | BalanceLowEvent;

/** Delivered when a company is activated after payment confirmation. */
export interface CompanyActivatedEvent {
  event: "COMPANY_ACTIVATED";
  companyId: string;
  transactionId: string;
  apiKey: string;
}

/** Delivered when a contact sends a message (text or media). */
export interface MessageReceivedEvent {
  event: "MESSAGE_RECEIVED";
  companyId: string;
  conversationId: string;
  messageId: string;
  sentAt: string;
}

/** Delivered when the customer reads a company-sent message. */
export interface MessageReadEvent {
  event: "MESSAGE_READ";
  companyId: string;
  conversationId: string;
  messageId: string;
  readAt: string;
}

/** Delivered when the customer joins the secure conversation and registers its public key. */
export interface CustomerJoinedEvent {
  event: "CUSTOMER_JOINED";
  companyId: string;
  conversationId: string;
  customerPublicKey: string;
}

/** Delivered when a conversation is closed. */
export interface ConversationClosedEvent {
  event: "CONVERSATION_CLOSED";
  companyId: string;
  conversationId: string;
}

/** Presence/metadata event reported by the customer's chat window. */
export interface PresenceEvent {
  event: "TYPING" | "STOPPED_TYPING" | "RECORDING" | "CHAT_CLOSED";
  companyId: string;
  conversationId: string;
  /** Human-readable presence type. */
  type: "typing" | "stopped" | "recording" | "chat_closed";
}

/** Delivered when the company credit balance is low. */
export interface BalanceLowEvent {
  event: "BALANCE_LOW";
  companyId: string;
  balanceCents: number;
}

/** Standard ixblix error payload. */
export interface IxblixErrorBody {
  error: string;
  code: string;
  errors?: Array<{ path: string; message: string }>;
}
