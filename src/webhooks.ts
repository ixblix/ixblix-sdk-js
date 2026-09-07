/**
 * Helpers for receiving ixblix webhooks.
 *
 * ixblix signs webhook payloads with HMAC-SHA256 using the company's webhook
 * secret. The signature is sent in the `X-Ixblix-Signature` header. Integrations
 * should call {@link verifyWebhook} with the raw body and the secret to
 * authenticate the request before acting on it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEvent } from "./types.js";

/** Header carrying the HMAC-SHA256 signature of the raw body. */
export const WEBHOOK_SIGNATURE_HEADER = "X-Ixblix-Signature";
/** Header carrying the event id (for idempotent receivers). */
export const WEBHOOK_ID_HEADER = "X-Ixblix-Event-Id";
/** Header carrying the event type. */
export const WEBHOOK_EVENT_HEADER = "X-Ixblix-Event";

/** Result of parsing a webhook payload. */
export interface ParsedWebhook<T extends WebhookEvent = WebhookEvent> {
  /** The parsed, validated event. */
  event: T;
  /** The raw payload as received. */
  raw: unknown;
}

/**
 * Parse and validate an ixblix webhook payload.
 *
 * @param body The raw request body (already JSON-parsed).
 * @returns The typed event.
 * @throws {Error} When the payload is not a recognized ixblix webhook event.
 */
export function parseWebhook(body: unknown): ParsedWebhook {
  if (typeof body !== "object" || body === null) {
    throw new Error("ixblix webhook payload must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  const event = record.event;
  if (typeof event !== "string") {
    throw new Error("ixblix webhook payload is missing the 'event' field");
  }

  switch (event) {
    case "COMPANY_ACTIVATED":
    case "MESSAGE_RECEIVED":
    case "MESSAGE_READ":
    case "CUSTOMER_JOINED":
    case "CONVERSATION_CLOSED":
    case "TYPING":
    case "STOPPED_TYPING":
    case "RECORDING":
    case "CHAT_CLOSED":
    case "BALANCE_LOW":
      return { event: body as WebhookEvent, raw: body };
    default:
      throw new Error(`Unknown ixblix webhook event: ${event}`);
  }
}

/**
 * Verify an ixblix webhook request.
 *
 * Computes the HMAC-SHA256 signature of the raw body using the shared secret
 * and compares it (in constant time) against the `X-Ixblix-Signature` header.
 * Throws when the signature is missing or does not match.
 *
 * @param body The raw request body (already JSON-parsed).
 * @param secret The company's webhook secret (from `whsec_...`).
 * @param signature The signature from the `X-Ixblix-Signature` header.
 * @returns The typed, validated event.
 */
export function verifyWebhook(
  body: unknown,
  secret: string,
  signature?: string,
): ParsedWebhook {
  if (!signature) {
    throw new Error(
      "ixblix webhook is missing the X-Ixblix-Signature header; cannot verify authenticity",
    );
  }
  if (!secret) {
    throw new Error(
      "A webhook secret is required to verify ixblix webhook signatures",
    );
  }

  const expected = createHmac("sha256", secret)
    .update(JSON.stringify(body))
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(signature, "hex");
  if (
    expectedBuf.length !== receivedBuf.length ||
    !timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    throw new Error("ixblix webhook signature verification failed");
  }

  return parseWebhook(body);
}
