/**
 * Typed HTTP client for the ixblix public REST API.
 *
 * All methods that operate on behalf of a company authenticate with the
 * `X-API-Key` header. Company onboarding (register/activate) and public
 * endpoints (plans, payment providers) do not require an API key.
 */
import { IxblixError } from "./errors.js";
import type {
  ActivateCompanyResult,
  CompanyBalance,
  CompanyCustomization,
  CompanyCustomizationInput,
  ContactInput,
  ConversationKeys,
  CreateConversationResult,
  CreditPurchase,
  Media,
  Message,
  MessageEnvelope,
  OriginalChannelMessageInput,
  PaymentProvidersResult,
  Plan,
  PurchaseCreditsResult,
  RegisterCompanyInput,
  RegisterCompanyResult,
  IxblixErrorBody,
} from "./types.js";

/** Options for constructing an {@link IxblixClient}. */
export interface IxblixClientOptions {
  /** Base URL of the ixblix API, e.g. `https://api.ixblix.app`. */
  baseUrl: string;
  /** Company API key sent in the `X-API-Key` header. */
  apiKey?: string;
  /** Optional custom fetch implementation (e.g. for testing or proxies). */
  fetch?: typeof fetch;
}

/** A media file to upload, with its plaintext bytes and metadata. */
export interface MediaUpload {
  /** Plaintext file bytes. The SDK encrypts them before upload. */
  data: Uint8Array;
  fileName: string;
  mimeType: string;
}

/** A media file downloaded from ixblix, still encrypted. */
export interface MediaDownload {
  /** Encrypted (ciphertext) bytes as stored by ixblix. */
  data: Uint8Array;
  media: Media;
}

/**
 * Client for the ixblix API.
 *
 * ```ts
 * const ixblix = new IxblixClient({
 *   baseUrl: "https://api.ixblix.app",
 *   apiKey: process.env.IXBLIX_API_KEY,
 * });
 * ```
 */
export class IxblixClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IxblixClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  private buildHeaders(init?: HeadersInit): Record<string, string> {
    const headers: Record<string, string> = {};
    const source = new Headers(init);
    source.forEach((value, key) => {
      headers[key] = value;
    });
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }
    return headers;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.buildHeaders(init.headers),
    });

    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const data = isJson
      ? ((await response.json()) as T | IxblixErrorBody)
      : null;

    if (!response.ok) {
      const body = data as IxblixErrorBody | null;
      throw new IxblixError(
        body?.error ?? `ixblix ${path} failed with status ${response.status}`,
        {
          status: response.status,
          code: body?.code,
          details: body?.errors,
        },
      );
    }
    return data as T;
  }

  // ---------------------------------------------------------------------------
  // Company onboarding
  // ---------------------------------------------------------------------------

  /**
   * Register a company (keyless). Returns payment instructions; call
   * {@link activateCompany} once the payment is confirmed.
   */
  registerCompany(input: RegisterCompanyInput): Promise<RegisterCompanyResult> {
    return this.request<RegisterCompanyResult>("/api/companies/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Activate a company after payment confirmation and obtain its API key.
   */
  activateCompany(
    companyId: string,
    transactionId: string,
  ): Promise<ActivateCompanyResult> {
    return this.request<ActivateCompanyResult>(
      `/api/companies/${companyId}/activate/${transactionId}`,
      { method: "POST" },
    );
  }

  /** List available subscription plans. */
  listPlans(): Promise<Plan[]> {
    return this.request<Plan[]>("/api/plans");
  }

  /** List available payment providers. */
  listPaymentProviders(): Promise<PaymentProvidersResult> {
    return this.request<PaymentProvidersResult>("/api/payment/providers");
  }

  /** Fetch the authenticated company's balance and plan state. */
  getBalance(): Promise<CompanyBalance> {
    return this.request<CompanyBalance>("/api/companies/balance");
  }

  /** Purchase prepaid credits for the authenticated company. */
  purchaseCredits(input: {
    amountCents: number;
    currency?: string;
    provider: string;
    metadata?: Record<string, unknown>;
  }): Promise<PurchaseCreditsResult> {
    return this.request<PurchaseCreditsResult>(
      "/api/companies/credits/purchase",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  /** List the authenticated company's credit purchases. */
  listCreditPurchases(): Promise<CreditPurchase[]> {
    return this.request<CreditPurchase[]>("/api/companies/credits/purchases");
  }

  /**
   * Set or update the webhook endpoint where ixblix delivers events (incoming
   * messages, customer joined, conversation closed, presence metadata). When
   * the URL changes (or `rotateSecret` is true) a fresh HMAC secret is
   * generated and returned once — store it to verify webhook signatures.
   */
  updateWebhook(input: {
    webhookUrl?: string | null;
    rotateSecret?: boolean;
  }): Promise<{ webhookUrl: string | null; webhookSecret: string | null }> {
    return this.request<{
      webhookUrl: string | null;
      webhookSecret: string | null;
    }>("/api/companies/webhook", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  /**
   * Update the authenticated company's white-label customization (brand name,
   * logos, primary color, favicon, welcome message, website URL). Returns the
   * updated customization record.
   */
  updateCustomization(
    input: CompanyCustomizationInput,
  ): Promise<CompanyCustomization> {
    return this.request<CompanyCustomization>("/api/companies/customization", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  /**
   * Create an overflow conversation for a contact. Supply the operator's RSA
   * public key (base64 SPKI DER) so the customer can encrypt messages to it.
   */
  createConversation(input: {
    contact: ContactInput;
    channel: string;
    operatorPublicKey: string;
  }): Promise<CreateConversationResult> {
    return this.request<CreateConversationResult>("/api/conversations", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Fetch the current E2EE key state of a conversation so the operator can
   * detect when the customer has joined (`keyStatus === "ACTIVE"`).
   */
  getConversationKeys(conversationId: string): Promise<ConversationKeys> {
    return this.request<ConversationKeys>(
      `/api/conversations/${conversationId}/keys`,
    );
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * Send an encrypted message from the company to the contact. The message must
   * already be encrypted to the customer's public key (see the crypto helpers).
   */
  sendCompanyMessage(
    conversationId: string,
    envelope: MessageEnvelope,
    contentType = "text",
  ): Promise<Message> {
    return this.request<Message>("/api/messages/company", {
      method: "POST",
      body: JSON.stringify({
        conversationId,
        content: envelope.content,
        contentType,
        iv: envelope.iv,
        authTag: envelope.authTag,
        encryptedKey: envelope.encryptedKey,
        selfEncryptedKey: envelope.selfEncryptedKey,
        keyId: envelope.keyId,
      }),
    });
  }

  /** List all messages of a conversation (content is always ciphertext). */
  listMessages(conversationId: string): Promise<Message[]> {
    return this.request<Message[]>(`/api/messages/${conversationId}`);
  }

  /**
   * Mark a contact-sent message as read by the operator. Emits a
   * `message_read` Socket.io event to the customer's chat app so the customer
   * sees the read receipt.
   */
  markMessageReadByCompany(
    conversationId: string,
    messageId: string,
  ): Promise<{ messageId: string; readAt: string }> {
    return this.request<{ messageId: string; readAt: string }>(
      "/api/messages/company/read",
      {
        method: "POST",
        body: JSON.stringify({ conversationId, messageId }),
      },
    );
  }

  /**
   * Relay an operator presence event (typing, stopped typing, or recording)
   * to the customer's chat app via Socket.io.
   */
  reportCompanyPresence(
    conversationId: string,
    type: "typing" | "stopped" | "recording",
  ): Promise<{ status: string }> {
    return this.request<{ status: string }>(
      `/api/conversations/${conversationId}/presence`,
      {
        method: "POST",
        body: JSON.stringify({ type }),
      },
    );
  }

  /**
   * Relay a message received on the original channel (WhatsApp, Instagram,
   * etc.) into ixblix. The message must be encrypted to the operator's public key.
   */
  relayOriginalChannelMessage(
    input: OriginalChannelMessageInput,
  ): Promise<Message> {
    return this.request<Message>("/api/webhooks/original-channel", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // ---------------------------------------------------------------------------
  // Media
  // ---------------------------------------------------------------------------

  /**
   * Upload an encrypted media file from the company. `file.data` must be the
   * ciphertext bytes produced by the media encryption helper.
   */
  async sendCompanyMedia(
    conversationId: string,
    file: MediaUpload,
    envelope: MessageEnvelope,
  ): Promise<Message> {
    const form = new FormData();
    form.append("conversationId", conversationId);
    form.append(
      "file",
      new Blob([file.data as BlobPart], { type: file.mimeType }),
      file.fileName,
    );
    form.append("iv", envelope.iv);
    form.append("authTag", envelope.authTag);
    form.append("encryptedKey", envelope.encryptedKey);
    form.append("selfEncryptedKey", envelope.selfEncryptedKey);
    form.append("keyId", envelope.keyId);

    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }
    const response = await this.fetchImpl(`${this.baseUrl}/api/media/company`, {
      method: "POST",
      headers,
      body: form,
    });
    const data = (await response.json()) as Message | IxblixErrorBody;
    if (!response.ok) {
      const body = data as IxblixErrorBody;
      throw new IxblixError(body?.error ?? "ixblix media upload failed", {
        status: response.status,
        code: body?.code,
        details: body?.errors,
      });
    }
    return data as Message;
  }

  /** Fetch the metadata (envelope + file info) of a media file. */
  getMedia(mediaId: string): Promise<Media> {
    return this.request<Media>(`/api/media/${mediaId}`);
  }

  /**
   * Download the raw (encrypted) bytes of a media file as the operator, along
   * with its metadata so it can be decrypted.
   */
  async downloadCompanyMedia(mediaId: string): Promise<MediaDownload> {
    const media = await this.getMedia(mediaId);
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/media/${mediaId}/content`,
      { headers },
    );
    if (!response.ok) {
      throw new IxblixError(
        `ixblix media download failed with status ${response.status}`,
        {
          status: response.status,
        },
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    return { data: new Uint8Array(arrayBuffer), media };
  }
}
