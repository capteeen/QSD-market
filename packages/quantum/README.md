# @qsd/quantum

Attested quantum randomness for QSD: a pluggable QRNG client, a proof-bundle
format, and a browser-safe `verify()` that anyone can run on a bundle.

Read `/docs/physics.md` first. It is the ground truth for every physics claim
and it says, in public-facing language, exactly what an attestation from this
package does and does not prove.

## Provider chosen, and why

**ANU Quantum Numbers** (Australian National University; commercial API on AWS
API Gateway). Hardware: continuous measurement of quantum vacuum fluctuations
of the electromagnetic field with lasers and high-speed detectors.
Docs: <https://quantumnumbers.anu.edu.au/documentation>
AWS Marketplace listing (pricing, rate limits): <https://aws.amazon.com/marketplace/pp/prodview-246kyrfjo3bag>

Survey of commercial QRNG HTTP APIs, October 2026:

| Provider | Live HTTP API | Signs responses? | Notes |
|---|---|---|---|
| ANU Quantum Numbers (`api.quantumnumbers.com.au`) | yes, `x-api-key` | **no** | Documented JSON shape, self-serve keys, up to 1024 values/request, 100 req/s paid tier |
| Qrypt Entropy-as-a-Service (`api-eus.qrypt.com/api/v1/quantum-entropy`) | yes, bearer token by request | **no** | Base64 1 KiB blocks; docs say only "HTTPS" for integrity |
| Outshift / Cisco QRNG | yes, API key, evaluation-only | **no** | Pre-generated numbers stored in cloud; evaluation licence, 100 kbit/day |
| Quantinuum Quantum Origin | **no HTTP API** | n/a | Offline SDK/CLI/HSM connector; "verifiable" refers to Bell-test entropy bounds, not per-response signatures |
| ID Quantique Quantis | appliance / AWS AMI | **no** | REST on your own appliance; no published signature scheme |
| QuantumBlockchains QRNG API | yes, by registration | **no** stated | Docs behind registration |
| qrngapi.com ("Quantum Verified Corp") | claimed | claims "post-quantum signatures" | No public documentation of what is signed, which key, or how to verify; could not be evaluated |
| Random.org Signed API | yes | yes (RSA, JSON-RPC) | **Not quantum** (atmospheric noise). Not used. Referenced only as the pattern a signing QRNG provider would follow |

Conclusion: **no commercial QRNG API with public documentation returns a
verifiable cryptographic signature over its responses.** ANU is the most
established, best-documented, self-serve QRNG API with a real quantum source,
so it is the live provider, and this package attaches a **witness-signed**
attestation to every draw (see below). The `Attestation` type is a
discriminated union so that a `provider-signed` variant is already
expressible and verifiable; adding a signing provider later changes no bundle
format.

### ANU API, precisely

```
GET https://api.quantumnumbers.com.au?length=<1..1024>&type=hex8&size=1
x-api-key: <QSD_QRNG_API_KEY>
accept: application/json

200 {"success":true,"type":"hex8","length":"32","data":["2f","24",...]}
403 {"message":"Forbidden"}         missing or invalid key
429 {"message":"Limit Exceeded"}    rate / quota
```

`type` may be `uint8 | uint16 | hex8 | hex16`; `size` is the block size for
the hex types. We always request `type=hex8&size=1` so each element of `data`
is exactly one byte. `parseAnuResponse()` accepts `hex8` and `uint8` and
rejects everything else, any length mismatch, and any malformed value with a
`MeasurementUnavailableError` whose message is safe to show in the UI.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `QSD_QRNG_PROVIDER` | no | `anu-quantum-numbers` (default) or `UNSAFE_DEV_RANDOM` (refused when `NODE_ENV=production`) |
| `QSD_QRNG_API_KEY` | for ANU | ANU Quantum Numbers API key. Never logged, never in errors, never in attestations |
| `QSD_QRNG_ENDPOINT` | no | Endpoint override for ANU (e.g. a proxy). Default `https://api.quantumnumbers.com.au` |
| `QSD_WITNESS_SECRET_KEY` | for ANU | 64 hex chars: a 32-byte Ed25519 seed for the QSD witness key. Never logged. Publish the corresponding public key (`provider.witnessPublicKey`) |
| `NODE_ENV` | — | `production` makes `UNSAFE_DEV_RANDOM` impossible to construct or use |

Generate a witness seed once, keep it as a secret, and publish the public key:

```ts
import { ed25519SignerFromSeed, bytesToHex } from '@qsd/quantum';
const seed = crypto.getRandomValues(new Uint8Array(32));
console.log('QSD_WITNESS_SECRET_KEY=' + bytesToHex(seed));           // secret
console.log('witness public key:', ed25519SignerFromSeed(seed).publicKey); // publish
```

## Public API

```ts
import {
  // client
  createQrngClient, createProviderFromEnv, ENV,
  // providers
  AnuQuantumNumbersProvider, UnsafeDevRandomProvider, UNSAFE_DEV_RANDOM_ID,
  // bundles
  verify, verifyBundle, buildProofBundle, serializeBundle, parseBundle, bundleHash,
  serializeDraw, deserializeDraw,
  // attestations
  verifyAttestation, signWitnessAttestation, ed25519SignerFromSeed, ephemeralEd25519Signer,
  // commitment & encoding
  computeCommitment, canonicalJson, hashJson, sha256Hex, bytesToHex, hexToBytes,
  // events
  QuantumEventBus, recordEvents,
  // errors
  MeasurementUnavailableError, ProductionGuardError, QuantumConfigError, NotImplementedError,
} from '@qsd/quantum';
```

### Types

```ts
interface QrngProvider {
  readonly id: string;
  readonly attestationKind: 'provider-signed' | 'witness-signed' | 'unsafe-dev';
  draw(nBytes: number, observer?: DrawObserver): Promise<Draw>;
}

interface Draw {
  bytes: Uint8Array;
  providerId: string;
  requestedAt: IsoTimestamp;
  receivedAt: IsoTimestamp;
  attestation: Attestation;
  commitment: Hex;   // sha256(LP(domain)||LP(providerId)||LP(requestedAt)||LP(bytes)||LP(canonical(attestation)))
}

type Attestation = ProviderSignedAttestation | WitnessSignedAttestation | UnsafeDevAttestation;

interface OutcomeResolver<I extends JsonValue> {
  readonly id: string;                                // embedded in the bundle as resolverId
  resolve(bytes: Uint8Array, inputs: I): { value: JsonValue; label: string };
}

interface ProofBundle<I> {
  version: 1;
  resolverId: string;
  draw: SerializedDraw;          // bytes as hex
  inputs: { value: I; hash: Hex };   // hash = sha256(canonical(value))
  outcome: { value: JsonValue; label: string };
  resolvedAt: IsoTimestamp;
}

type VerifyResult = { ok: true } | { ok: false; reason: string };
```

### Measuring

```ts
const provider = createProviderFromEnv();           // throws if misconfigured; never falls back
const client = createQrngClient({ provider });

client.subscribe((e) => scene.handle(e));           // entropyRequested → entropyArrived → commitmentComputed → outcomeResolved

try {
  const { bundle, outcome } = await client.measure(inputs, protocolResolver);
  // anchor bundleHash(bundle) on-chain; show bundle on the collapse screen
} catch (e) {
  if (e instanceof MeasurementUnavailableError) ui.show(e.message); // "Measurement unavailable: ..."
  else throw e;
}
```

`measure()` draws 32 bytes by default (`{ nBytes }` to change), applies the
resolver, emits `outcomeResolved`, and returns a bundle that `verify()` accepts.

### Events

`QuantumEvent` is a discriminated union with a monotonic `seq` (per bus) and
an `at` timestamp:

| `type` | payload | emitted when |
|---|---|---|
| `entropyRequested` | `providerId, nBytes, requestedAt` | immediately before the HTTP request |
| `entropyArrived` | `bytes, attestation` | after the response is parsed and the attestation is signed |
| `commitmentComputed` | `hash` | after the commitment is hashed |
| `outcomeResolved` | `value, outcomeLabel` | after the resolver returns |

`recordEvents(bus)` collects events for replay/tests; pass a shared
`QuantumEventBus` to `createQrngClient({ bus })` to keep one `seq` across
draws.

### Dev provider

`UNSAFE_DEV_RANDOM` draws from `crypto.getRandomValues` and signs an
`unsafe-dev` attestation with an ephemeral key. Guards:

- constructor throws `ProductionGuardError` when `NODE_ENV=production`;
- `draw()` re-checks, so a provider constructed earlier refuses once the
  environment flips;
- `createProviderFromEnv()` only constructs it when
  `QSD_QRNG_PROVIDER=UNSAFE_DEV_RANDOM` *and* `NODE_ENV !== 'production'`, and
  reads `NODE_ENV` from the real process, not from any injected env;
- `verify()` rejects `unsafe-dev` bundles unless `{ allowUnsafeDev: true }` is
  passed, so a dev bundle can never pass as a real one by accident.

There is no retry, cache, or fallback anywhere in this package.

## What the attestation proves

Every draw carries one of:

**`witness-signed`** (what ANU draws carry today). Contents: provider id,
`requestedAt`, `receivedAt`, `bytesSha256`, `transport: 'https'`, the
verbatim HTTP response (`status`, allow-listed headers such as `date`,
`x-amzn-requestid`, `etag`; the raw `body`; `bodySha256`; the request `url`
with no key), the witness public key, and an Ed25519 signature over
`sha256("qsd.market/quantum/attestation/v1\n" + canonical(attestation minus signature))`.

A valid witness signature proves: *the holder of the QSD witness key attests
that this exact response body, with these headers, was received over TLS
from this provider at this time, and that these bytes are what it decoded.*
It does **not** prove that ANU sent the body; a dishonest witness key holder
could fabricate a body. The published witness key, the captured AWS request
id, and ANU's own logs are what a dispute would be settled with. This is a
witness attestation, not a provider signature, and the UI must label it as
such.

**`provider-signed`** (expressible now; no evaluated provider offers it).
Contents: scheme (`ed25519` only today), the provider's public key, the exact
signed message, the signature, and the captured response. A valid signature
against the provider's published key proves the bytes came from the provider.

**`unsafe-dev`**: proves nothing. Carries a warning string in every bundle.

The **commitment** binds `providerId`, `requestedAt`, the bytes and the entire
attestation (including its signature) into one hash. This hash is what the
protocol anchors on-chain *before* the outcome is revealed to the UI, so a
draw cannot be swapped after the fact.

## How a third party verifies a bundle

No account, no network, runs in a browser:

```ts
import { verify, parseBundle } from '@qsd/quantum';
import { measurementResolver } from '@qsd/protocol'; // the pure rule, by id

const bundle = parseBundle(jsonText);
const result = verify(bundle, measurementResolver, {
  trustedWitnessKeys: ['<published QSD witness public key hex>'],
});
// { ok: true } or { ok: false, reason: '...' } — never throws
```

`verify()` checks, in order: bundle shape and version; that the draw's
`providerId`/`requestedAt`/`receivedAt` match the attestation; that
`attestation.bytesSha256` equals `sha256(bytes)`; the attestation signature
(per kind, against the trusted key set if given); that the commitment
recomputes; that `inputs.hash` equals `sha256(canonical(inputs.value))`; that
the supplied resolver's `id` equals `bundle.resolverId`; and that
`resolver.resolve(bytes, inputs)` reproduces `outcome.value` and
`outcome.label` exactly. Any failure returns `{ ok: false, reason }`.

To compare against the on-chain anchor, compute `bundleHash(bundle)`
(sha256 of the canonical JSON) and compare with the anchored value.

## Tests

`pnpm --filter @qsd/quantum test`

- attestation rejection on bad signature (witness, provider-signed, dev), key
  substitution, trusted-key enforcement, body edits with and without hash
  recomputation
- production guards: constructor, draw-time, `createProviderFromEnv`, and
  that injected env cannot override the real `NODE_ENV`
- bundle round trip through `JSON.stringify`/`parse` and canonical
  serialisation; stable `bundleHash` regardless of key order
- `verify()` rejects tampering of bytes, commitment, inputs (with and without
  hash recomputation), outcome value and label, attestation signature and
  key, providerId, requestedAt, receivedAt, resolverId, version, resolvedAt,
  attestation kind; never throws on garbage or a throwing resolver
- event order, monotonic `seq`, payloads equal to the real draw values
- ANU parser against `test/fixtures/anu-documented-response.json` (a
  documented example, not live data); full draw through a mocked `fetch`
  including header capture, key non-leakage, 403/429/network/timeout/bad-shape
  handling, endpoint override
- live ANU test runs only when `QSD_QRNG_API_KEY` is set; otherwise it is
  skipped with a printed notice and the suite still passes

## Limits and known gaps

- Max 1024 bytes per ANU request; `draw(nBytes)` enforces it.
- Only Ed25519 is implemented for `provider-signed`. Other schemes return
  `{ ok: false, reason: 'unsupported provider signature scheme' }` rather than
  being skipped.
- The witness key must be kept in a secret store; if it leaks, witness
  attestations lose their value until the published key is rotated.
