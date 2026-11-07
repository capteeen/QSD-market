import { signWitnessAttestation, type Ed25519Signer } from '../attestation.js';
import { computeCommitment } from '../commitment.js';
import { hexToBytes, nowIso, sha256Hex } from '../encoding.js';
import { MeasurementUnavailableError, QuantumConfigError } from '../errors.js';
import type { CapturedHttpResponse, Draw, DrawBinding, DrawObserver, QrngProvider } from '../types.js';

/**
 * ANU Quantum Numbers (Australian National University, operated commercially
 * via AWS API Gateway). Source: continuous measurement of quantum vacuum
 * fluctuations of the electromagnetic field with lasers and high-speed
 * detectors.
 *
 * Documented API (https://quantumnumbers.anu.edu.au/documentation):
 *   GET https://api.quantumnumbers.anu.edu.au?length=N&type=hex8&size=K
 *   (older docs name api.quantumnumbers.com.au; it is tried when the first host cannot be reached)
 *   header: x-api-key: <key>
 *   200: { "success": true, "type": "hex8", "length": "N", "data": ["ab", ...] }
 *   403: { "message": "Forbidden" }           (missing/invalid key)
 *   429: { "message": "Limit Exceeded" }      (rate/quota)
 *
 * `type` may be uint8 | uint16 | hex8 | hex16. `length` is 1..1024. For the
 * hex types `size` (1..1024) is the number of bytes/words per hex block.
 * We request type=hex8 with length = number of bytes and size=1, so `data` is
 * an array of two-character lowercase hex strings, one per byte.
 *
 * ANU does NOT sign responses. This provider produces a 'witness-signed'
 * attestation: the raw response is captured verbatim and the QSD witness key
 * signs a statement over it, including the draw binding (inputsHash, nonce)
 * when one is supplied. See README "What the attestation proves".
 */
export const ANU_PROVIDER_ID = 'anu-quantum-numbers' as const;
export const ANU_DEFAULT_ENDPOINT = 'https://api.quantumnumbers.anu.edu.au';
/** Tried, in order, after ANU_DEFAULT_ENDPOINT when no endpoint is configured and the host cannot be reached. */
export const ANU_FALLBACK_ENDPOINTS = ['https://api.quantumnumbers.com.au'] as const;
export const ANU_MAX_BYTES_PER_REQUEST = 1024;

/** Response headers captured into the attestation. Never Authorization or anything key-like. */
export const CAPTURED_RESPONSE_HEADERS = [
  'date',
  'content-type',
  'content-length',
  'etag',
  'x-amzn-requestid',
  'x-amz-apigw-id',
  'x-amzn-trace-id',
  'x-request-id',
  'via',
] as const;

export interface AnuProviderOptions {
  /** API key. Never logged, never included in errors, attestations, JSON or inspect output. */
  apiKey: string;
  /** Witness signer (QSD protocol key). */
  witness: Ed25519Signer;
  /** Override the endpoint (e.g. for a proxy). Default ANU_DEFAULT_ENDPOINT. */
  endpoint?: string;
  /** Injectable fetch for tests. Default globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  /** Request timeout in ms. Default 10000. */
  timeoutMs?: number;
}

/** Documented success response shape. Exported so tests can type the fixture. */
export interface AnuSuccessResponse {
  success: true;
  type: 'uint8' | 'uint16' | 'hex8' | 'hex16';
  length: string | number;
  data: Array<string | number>;
}

/**
 * Reduce third-party text to something safe to place inside fixed UI copy:
 * letters, digits, space and a few punctuation marks only; no HTML-significant
 * characters (< > & " ' / \ = ( ) { }), no control characters; bounded length.
 */
export function sanitizeExcerpt(text: unknown, max = 80): string {
  if (typeof text !== 'string') return '';
  const cleaned = text
    .replace(/[^A-Za-z0-9 .,:;!?_%+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? cleaned.slice(0, max - 1).trimEnd() + '…' : cleaned;
}

/**
 * Parse a documented ANU response body into bytes. Pure; throws
 * MeasurementUnavailableError('bad-response') with a UI-safe message on any
 * deviation from the documented shape or from the requested length.
 */
export function parseAnuResponse(body: string, expectedBytes: number): Uint8Array {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw badResponse('the quantum provider returned a response that was not valid JSON');
  }
  if (!json || typeof json !== 'object') throw badResponse('the quantum provider returned a non-object response');
  const r = json as Partial<AnuSuccessResponse> & { message?: unknown };
  if (r.success !== true) {
    const excerpt = sanitizeExcerpt(r.message);
    throw badResponse(
      excerpt
        ? `the quantum provider reported an error: ${excerpt}`
        : 'the quantum provider did not report success',
      typeof r.message === 'string' ? r.message : undefined,
    );
  }
  if (!Array.isArray(r.data)) throw badResponse('the quantum provider response had no data array');
  if (r.data.length !== expectedBytes) {
    throw badResponse(`the quantum provider returned ${r.data.length} values but ${expectedBytes} were requested`);
  }
  if (r.type === 'hex8') {
    const out = new Uint8Array(expectedBytes);
    for (let i = 0; i < r.data.length; i++) {
      const v = r.data[i];
      if (typeof v !== 'string' || !/^[0-9a-fA-F]{2}$/.test(v)) {
        throw badResponse('the quantum provider returned a malformed hex8 value');
      }
      out[i] = hexToBytes(v.toLowerCase())[0]!;
    }
    return out;
  }
  if (r.type === 'uint8') {
    const out = new Uint8Array(expectedBytes);
    for (let i = 0; i < r.data.length; i++) {
      const v = r.data[i];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255) {
        throw badResponse('the quantum provider returned a malformed uint8 value');
      }
      out[i] = v;
    }
    return out;
  }
  throw badResponse('the quantum provider returned an unexpected data type', String(r.type));
}

function badResponse(message: string, detail?: string): MeasurementUnavailableError {
  return new MeasurementUnavailableError(ANU_PROVIDER_ID, 'bad-response', `Measurement unavailable: ${message}.`, {
    ...(detail !== undefined ? { detail } : {}),
  });
}

export class AnuQuantumNumbersProvider implements QrngProvider {
  readonly id = ANU_PROVIDER_ID;
  readonly attestationKind = 'witness-signed' as const;
  readonly endpoint: string;
  readonly timeoutMs: number;
  /** endpoint first, then the fallbacks (only when no endpoint was configured). */
  readonly #endpoints: string[];
  // ES private fields: invisible to JSON.stringify, util.inspect, Object.keys and reflection.
  readonly #apiKey: string;
  readonly #witness: Ed25519Signer;
  readonly #fetch: typeof globalThis.fetch;

  constructor(opts: AnuProviderOptions) {
    if (!opts.apiKey || typeof opts.apiKey !== 'string') {
      throw new QuantumConfigError('AnuQuantumNumbersProvider: apiKey is required (env QSD_QRNG_API_KEY)');
    }
    if (!opts.witness) {
      throw new QuantumConfigError('AnuQuantumNumbersProvider: a witness signer is required (env QSD_WITNESS_SECRET_KEY)');
    }
    this.#apiKey = opts.apiKey;
    this.#witness = opts.witness;
    this.endpoint = (opts.endpoint ?? ANU_DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.#endpoints = opts.endpoint ? [this.endpoint] : [this.endpoint, ...ANU_FALLBACK_ENDPOINTS];
    const f = opts.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') {
      throw new QuantumConfigError('AnuQuantumNumbersProvider: no fetch implementation available');
    }
    this.#fetch = f;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** Witness public key, so the integrator can publish it. */
  get witnessPublicKey(): string {
    return this.#witness.publicKey;
  }

  /** What loggers see. Never the key. */
  toJSON(): { id: string; attestationKind: string; endpoint: string; witnessPublicKey: string } {
    return {
      id: this.id,
      attestationKind: this.attestationKind,
      endpoint: this.endpoint,
      witnessPublicKey: this.witnessPublicKey,
    };
  }

  async draw(nBytes: number, observer?: DrawObserver, binding?: DrawBinding): Promise<Draw> {
    if (!Number.isInteger(nBytes) || nBytes <= 0 || nBytes > ANU_MAX_BYTES_PER_REQUEST) {
      throw new QuantumConfigError(
        `ANU provider: nBytes must be an integer in 1..${ANU_MAX_BYTES_PER_REQUEST}, got ${String(nBytes)}`,
      );
    }
    const requestedAt = nowIso();
    observer?.emit({ type: 'entropyRequested', providerId: this.id, nBytes, requestedAt });

    // Only an unreachable host moves on to the next endpoint; any HTTP answer (even an error) is final.
    let res: Response | undefined;
    let url = '';
    for (let i = 0; !res; i++) {
      url = `${this.#endpoints[i]}?length=${nBytes}&type=hex8&size=1`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        res = await this.#fetch(url, {
          method: 'GET',
          headers: { 'x-api-key': this.#apiKey, accept: 'application/json' },
          signal: controller.signal,
        });
      } catch (cause) {
        const timedOut = controller.signal.aborted;
        if (i + 1 < this.#endpoints.length) continue;
        throw new MeasurementUnavailableError(
          this.id,
          'network',
          timedOut
            ? `Measurement unavailable: the quantum provider did not respond within ${this.timeoutMs / 1000}s.`
            : `Measurement unavailable: the quantum provider could not be reached (${this.#endpoints.map((e) => new URL(e).host).join(', ')}: ${networkReason(cause)}).`,
          { cause: scrubCause(cause, this.#apiKey) },
        );
      } finally {
        clearTimeout(timer);
      }
    }

    let body: string;
    try {
      body = await res.text();
    } catch (cause) {
      throw new MeasurementUnavailableError(
        this.id,
        'network',
        'Measurement unavailable: the quantum provider response could not be read.',
        { cause: scrubCause(cause, this.#apiKey) },
      );
    }
    const receivedAt = nowIso();

    if (!res.ok) {
      throw new MeasurementUnavailableError(
        this.id,
        'http-status',
        res.status === 403
          ? 'Measurement unavailable: the quantum provider rejected our credentials.'
          : res.status === 429
            ? 'Measurement unavailable: the quantum provider rate limit was reached. Try again shortly.'
            : `Measurement unavailable: the quantum provider returned HTTP ${res.status}.`,
        { detail: body.slice(0, 2048) },
      );
    }

    const bytes = parseAnuResponse(body, nBytes);

    const headers: Record<string, string> = {};
    for (const h of CAPTURED_RESPONSE_HEADERS) {
      const v = res.headers.get(h);
      if (v !== null) headers[h] = v;
    }
    const response: CapturedHttpResponse = {
      status: res.status,
      headers,
      body,
      bodySha256: sha256Hex(new TextEncoder().encode(body)),
      url,
    };

    const attestation = signWitnessAttestation(
      {
        kind: 'witness-signed',
        providerId: this.id,
        requestedAt,
        receivedAt,
        bytesSha256: sha256Hex(bytes),
        ...(binding ? { inputsHash: binding.inputsHash, nonce: binding.nonce } : {}),
        transport: 'https',
        response,
      },
      this.#witness,
    );
    observer?.emit({ type: 'entropyArrived', bytes, attestation });

    const commitment = computeCommitment({ providerId: this.id, requestedAt, bytes, attestation });
    observer?.emit({ type: 'commitmentComputed', hash: commitment });

    return { bytes, providerId: this.id, requestedAt, receivedAt, attestation, commitment };
  }
}

/** A fetch implementation may put anything in its error; never let the key ride along as `cause`. */
function scrubCause(cause: unknown, apiKey: string): unknown {
  if (cause instanceof Error) {
    const msg = cause.message.includes(apiKey) ? cause.message.split(apiKey).join('[redacted]') : cause.message;
    const scrubbed = new Error(msg);
    scrubbed.name = cause.name;
    return scrubbed;
  }
  if (typeof cause === 'string') return cause.split(apiKey).join('[redacted]');
  return undefined;
}

/** A short, key-free reason for a failed fetch (e.g. ENOTFOUND), from undici's nested cause. */
function networkReason(cause: unknown): string {
  const inner = (cause as { cause?: { code?: unknown } } | undefined)?.cause;
  if (inner && typeof inner.code === 'string') return inner.code;
  const code = (cause as { code?: unknown } | undefined)?.code;
  if (typeof code === 'string') return code;
  return cause instanceof Error ? cause.name : 'network error';
}
