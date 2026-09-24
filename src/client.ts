/**
 * Typed HTTP client for the ixblix public REST API.
 *
 * All methods that operate on behalf of a company authenticate with the
 * `X-API-Key` header. Company onboarding (register/activate) uses integrator
 * HTTP Basic Auth. The plans endpoint requires integrator authentication.
 */
import { IxblixError } from "./errors.js";
import { encryptToRecipient } from "./crypto.js";
import type { OperatorKeyPair } from "./crypto.js";
import type {
  ActivateCompanyResult,
  CompanyBalance,
  CompanyCustomization,
  CompanyCustomizationInput,
  CompanyEncryptionKey,
  CompanyProfile,
  ContactInput,
  ConversationKeys,
  CreateConversationResult,
  CreditPurchase,
  Media,
  Message,
  MessageEnvelope,
  OperatorInput,
  OriginalChannelMessageInput,
  PaymentChangeOptions,
  PaymentMethod,
  PaymentProvidersResult,
  Plan,
  PurchaseCreditsResult,
  RegisterCompanyEncryptionKeyInput,
  RegisterCompanyInput,
  RegisterCompanyResult,
  RegisterIntegratorInput,
  RegisterIntegratorResult,
  StartPaymentChangeInput,
  StartPaymentChangeResult,
  UpdateOperatorResult,
  IxblixErrorBody,
} from "./types.js";

/** Options for constructing an {@link IxblixClient}. */
export interface IxblixClientOptions {
  /** Base URL of the ixblix API, e.g. `https://api.ixblix.app`. */
  baseUrl: string;
  /** Company API key sent in the `X-API-Key` header. */
  apiKey?: string;
  /** Integrator ID for HTTP Basic Auth (used for company registration/activation). */
  integratorId?: string;
  /** Integrator access token for HTTP Basic Auth. */
  integratorAccessToken?: string;
  /** Operator RSA keypair used to encrypt outgoing messages/reactions. */
  operatorKey?: OperatorKeyPair;
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

/** A company branding asset (logo/icon) to upload. */
export interface BrandingFile {
  /** Raw file bytes (e.g. an SVG document). */
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
  private readonly integratorId?: string;
  private readonly integratorAccessToken?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly operatorKey?: OperatorKeyPair;

  constructor(options: IxblixClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.integratorId = options.integratorId;
    this.integratorAccessToken = options.integratorAccessToken;
    this.operatorKey = options.operatorKey;
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
    if (this.integratorId && this.integratorAccessToken) {
      const credentials = `${this.integratorId}:${this.integratorAccessToken}`;
      const base64 = Buffer.from(credentials).toString("base64");
      headers["Authorization"] = `Basic ${base64}`;
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
  // Integrator onboarding
  // ---------------------------------------------------------------------------

  /**
   * Register a new integrator platform. The backend performs a three-phase
   * verification:
   * 1. Accepts the registration payload.
   * 2. POSTs `{ challenge: <hostname> }` to the callback URL; the callback must
   *    respond with the exact registration payload to prove it controls the
   *    hostname.
   * 3. POSTs the credentials (`integratorId` and `accessToken`) to the callback,
   *    which must echo them back with status 200.
   */
  registerIntegrator(
    input: RegisterIntegratorInput,
  ): Promise<RegisterIntegratorResult> {
    return this.request<RegisterIntegratorResult>("/api/integrators/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
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

  /**
   * Fetch the authenticated company's profile, including its white-label
   * customization (brand name, logo URLs, primary color, welcome message).
   */
  getProfile(): Promise<CompanyProfile> {
    return this.request<CompanyProfile>("/api/companies/profile");
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

  /** List the authenticated company's stored payment methods, default first. */
  listPaymentMethods(): Promise<PaymentMethod[]> {
    return this.request<PaymentMethod[]>("/api/companies/payment-methods");
  }

  /**
   * Fetch the available payment instruments for a company wanting to
   * re-subscribe or switch payment methods.
   */
  getPaymentChangeOptions(): Promise<PaymentChangeOptions> {
    return this.request<PaymentChangeOptions>(
      "/api/companies/payment-change/options",
    );
  }

  /**
   * Start a payment change checkout for the authenticated company. Returns
   * a transaction id and hosted checkout URL to redirect the company owner.
   */
  startPaymentChange(
    input?: StartPaymentChangeInput,
  ): Promise<StartPaymentChangeResult> {
    return this.request<StartPaymentChangeResult>(
      "/api/companies/payment-change/start",
      {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      },
    );
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
   * Register or rotate the authenticated company's RSA public key used for
   * end-to-end encryption. The previous active key is retired (kept for
   * decrypting existing conversations) and new conversations snapshot the
   * fresh key.
   */
  registerEncryptionKey(
    input: RegisterCompanyEncryptionKeyInput,
  ): Promise<CompanyEncryptionKey> {
    return this.request<CompanyEncryptionKey>("/api/companies/encryption-key", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  /** Fetch the currently active company encryption key. */
  getEncryptionKey(): Promise<CompanyEncryptionKey> {
    return this.request<CompanyEncryptionKey>("/api/companies/encryption-key");
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

  /**
   * Upload company branding assets (a square icon and/or a rectangular logo,
   * typically SVG) as multipart/form-data. Each file is stored in the public
   * branding bucket and the corresponding customization URL is updated.
   * Returns the updated customization record.
   *
   * @param assets Map of asset name -> file. Supported keys: `squareIcon` and
   *   `rectangularLogo`. At least one must be provided.
   */
  async uploadBranding(assets: {
    squareIcon?: BrandingFile;
    rectangularLogo?: BrandingFile;
  }): Promise<CompanyCustomization> {
    const form = new FormData();
    if (assets.squareIcon) {
      form.append(
        "squareIcon",
        new Blob([assets.squareIcon.data as BlobPart], {
          type: assets.squareIcon.mimeType,
        }),
        assets.squareIcon.fileName,
      );
    }
    if (assets.rectangularLogo) {
      form.append(
        "rectangularLogo",
        new Blob([assets.rectangularLogo.data as BlobPart], {
          type: assets.rectangularLogo.mimeType,
        }),
        assets.rectangularLogo.fileName,
      );
    }

    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/companies/branding`,
      { method: "POST", headers, body: form },
    );
    const data = (await response.json()) as
      CompanyCustomization | IxblixErrorBody;
    if (!response.ok) {
      const body = data as IxblixErrorBody;
      throw new IxblixError(body?.error ?? "ixblix branding upload failed", {
        status: response.status,
        code: body?.code,
        details: body?.errors,
      });
    }
    return data as CompanyCustomization;
  }

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  /**
   * Create an overflow conversation for a contact. Uses the company's
   * currently active encryption key so the customer can encrypt messages to it.
   * Optionally attach the operator's identity (uuid, name, image and/or
   * gravatar hash) so the customer's client can display who is handling the
   * conversation.
   */
  createConversation(input: {
    contact: ContactInput;
    operator?: {
      uuid?: string;
      name?: string;
      image?: string;
      gravatarHash?: string;
    };
  }): Promise<CreateConversationResult> {
    return this.request<CreateConversationResult>("/api/conversations", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Update the operator identity (uuid, name, image and/or gravatar hash)
   * attached to a conversation. Only the provided fields are updated; omitted
   * fields keep their current value. Pass `null` to clear a field. The
   * operator can be updated at any moment during the conversation.
   */
  updateOperator(
    conversationId: string,
    operator: OperatorInput,
  ): Promise<UpdateOperatorResult> {
    return this.request<UpdateOperatorResult>(
      `/api/conversations/${conversationId}/operator`,
      {
        method: "PUT",
        body: JSON.stringify({ operator }),
      },
    );
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
   * Optionally pass the operator uuid so it is attributed to the message,
   * and `replyToId` to send it as a reply to another message.
   *
   * The operator's display name, avatar and Gravatar hash are embedded by the
   * sender in the encrypted `attachments` JSON so the customer client can
   * decrypt and render the correct avatar per message.
   */
  sendCompanyMessage(
    conversationId: string,
    envelope: MessageEnvelope,
    contentType = "text",
    operatorUuid?: string,
    replyToId?: string | null,
    attachments?: string | null,
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
        operatorUuid,
        replyToId: replyToId ?? undefined,
        attachments: attachments ?? undefined,
      }),
    });
  }

  /**
   * List all messages of a conversation (content is always ciphertext).
   * Each message includes its replied-to message (one level deep) and its
   * emoji reactions.
   */
  listMessages(conversationId: string): Promise<Message[]> {
    return this.request<Message[]>(`/api/messages/${conversationId}`);
  }

  /**
   * React to a message as the operator. The emoji is encrypted to the
   * customer's public key and sent as a regular message with
   * contentType="react" and replyToId pointing to the target message. Pass an
   * empty `emoji` to clear the operator's reaction. The caller's SDK instance
   * must hold an operator keypair (see `loadOrCreateOperatorKey`).
   */
  async reactToMessage(
    conversationId: string,
    messageId: string,
    emoji: string,
    operatorUuid?: string,
  ): Promise<Message> {
    const keys = await this.getConversationKeys(conversationId);
    if (!keys.customerPublicKey) {
      throw new IxblixError(
        "Customer has not joined the secure conversation yet",
        { status: 409, code: "KEYS_NOT_ACTIVE" },
      );
    }
    if (!this.operatorKey) {
      throw new IxblixError(
        "Operator keypair is required to send encrypted reactions",
        { status: 400, code: "MISSING_OPERATOR_KEY" },
      );
    }
    const envelope = encryptToRecipient(
      emoji,
      keys.customerPublicKey,
      this.operatorKey.keyId,
      this.operatorKey.publicKeySpki,
    );
    return this.sendCompanyMessage(
      conversationId,
      envelope,
      "react",
      operatorUuid,
      messageId,
    );
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
   * ciphertext bytes produced by the media encryption helper. Optionally pass
   * the operator uuid so the media message is attributed to the operator,
   * `replyToId` to send it as a reply to another message, and `attachments`
   * for rich message attachments (encrypted JSON string).
   */
  /**
   * Upload an encrypted media file from the company to the contact. The file
   * bytes and the optional attachments JSON must already be encrypted to the
   * customer's public key.
   *
   * The operator's display name, avatar and Gravatar hash are embedded by the
   * sender in the encrypted `attachments` JSON so the customer client can
   * decrypt and render the correct avatar per message.
   */
  async sendCompanyMedia(
    conversationId: string,
    file: MediaUpload,
    envelope: MessageEnvelope,
    operatorUuid?: string,
    replyToId?: string | null,
    attachments?: string | null,
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
    if (operatorUuid) {
      form.append("operatorUuid", operatorUuid);
    }
    if (replyToId) {
      form.append("replyToId", replyToId);
    }
    if (attachments) {
      form.append("attachments", attachments);
    }

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
