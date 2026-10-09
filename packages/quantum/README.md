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
| `QSD_WITNESS_SECRET_KEY` | for ANU (producer side) | 64 hex chars: a 32-byte Ed25519 seed for the QSD witness key. Never logged. Publish the corresponding public key (`provider.witnessPublicKey`) |
| `QSD_WITNESS_PUBLIC_KEYS` | verifier side | Comma-separated published witness public keys (64 hex each). Read with `trustedWitnessKeysFromEnv()` and passed to `verify()`. The app must also ship this list to the browser (e.g. as a build-time constant) so in-browser verification is fail-closed |
| `QSD_ALLOW_UNSAFE_DEV` | dev only | Must be exactly `1`, together with `NODE_ENV=development`, to permit `UNSAFE_DEV_RANDOM` |
| `NODE_ENV` | — | Only `test` (alone) or `development` (with `QSD_ALLOW_UNSAFE_DEV=1`) permit the dev provider. Anything else, including unset, `prod`, `Production`, or no `process` object at all, is production |

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
  createQrngClient, createProviderFromEnv, ENV, trustedWitnessKeysFromEnv,
  // providers
  AnuQuantumNumbersProvider, UnsafeDevRandomProvider, UNSAFE_DEV_RANDOM_ID,
  // bundles
  verify, verifyBundle, bundleBinding, buildProofBundle, serializeBundle, parseBundle, bundleHash,
  serializeDraw, deserializeDraw,
  // attestations
  verifyAttestation, signWitnessAttestation, ed25519SignerFromSeed, ephemeralEd25519Signer,
  // commitment & encoding
  computeCommitment, canonicalJson, hashJson, sha256Hex, bytesToHex, hexToBytes,
  // events
  QuantumEventBus, recordEvents,
  // errors & guard
  MeasurementUnavailableError, ProductionGuardError, QuantumConfigError, NotImplementedError,
  unsafeDevPermission, isProduction,
} from '@qsd/quantum';
```

### Types

```ts
interface QrngProvider {
  readonly id: string;
  readonly attestationKind: 'provider-signed' | 'witness-signed' | 'unsafe-dev';
  draw(nBytes: number, observer?: DrawObserver, binding?: DrawBinding): Promise<Draw>;
}

interface DrawBinding { inputsHash: Hex; nonce: Hex }   // see "Draw binding and grinding"

interface Draw {
  bytes: Uint8Array;
  providerId: string;
  requestedAt: IsoTimestamp;
  receivedAt: IsoTimestamp;
  attestation: Attestation;
  commitment: Hex;   // sha256(LP(domain)||LP(providerId)||LP(requestedAt)||LP(bytes)||LP(inputsHash||"")||LP(nonce||"")||LP(canonical(attestation)))
}

// every attestation kind also carries: providerId, requestedAt, receivedAt, bytesSha256,
// and (for witness/provider kinds, when drawn via measure()) inputsHash + nonce

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

type VerifyResult =
  | { ok: true }                                   // under a trusted key
  | { ok: true; trust: 'self-consistent-only' }    // ONLY with trustAnyKey: true — never render as "verified"
  | { ok: false; reason: string };
```

### Measuring

```ts
const provider = createProviderFromEnv();           // throws if misconfigured; never falls back
const client = createQrngClient({ provider });

client.subscribe((e) => scene.handle(e));           // entropyRequested → entropyArrived → commitmentComputed → outcomeResolved

try {
  const { bundle, outcome, binding } = await client.measure(inputs, protocolResolver, {
    nonce: measurementId,                            // hex; the protocol's measurement id
    beforeDraw: (b) => chain.anchorBinding(b),       // anchor (inputsHash, nonce) BEFORE the draw
  });
  // then anchor bundleHash(bundle); show bundle on the collapse screen
} catch (e) {
  if (e instanceof MeasurementUnavailableError) ui.show(e.message); // fixed copy + sanitised excerpt; e.detail is raw, not for UI
  else throw e;
}
```

`measure()` computes `inputsHash = sha256(canonical(inputs))`, derives or takes
a `nonce`, awaits `beforeDraw(binding)` (if it throws, no draw is made), draws
32 bytes by default (`{ nBytes }` to change) bound to that pair, applies the
resolver, emits `outcomeResolved`, and returns a bundle that `verify()` accepts
under the published witness key.

### Draw binding and grinding

The witness key holder is the operator. Without binding, it could request N
draws for one measurement and publish the favourable one, and every bundle
would verify. Binding makes that *detectable*, not impossible:

1. `measure()` puts `inputsHash` and `nonce` into the draw request. The ANU
   provider includes both in the witness statement, so they are signed and
   are part of the commitment.
2. The chain package anchors `(inputsHash, nonce)` on-chain in `beforeDraw`,
   i.e. before the provider is contacted, and anchors `bundleHash(bundle)`
   after. `bundleBinding(bundle)` returns the pair for comparison.
3. `verify()` rejects a bundle whose `attestation.inputsHash` differs from
   `inputs.hash`, so a draw cannot be re-applied to different inputs. With
   `requireInputBinding: true` it also rejects unbound draws; production
   verifiers should pass it.
4. A second draw for the same inputs needs a second anchor (public) or a
   bundle that does not match the anchor. `verify()` itself cannot see other
   draws; the anchor comparison is what catches grinding.

The dev provider deliberately produces unbound attestations.

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
`unsafe-dev` attestation with an ephemeral key. The guard is **fail-closed**
(`unsafeDevPermission()`): the provider is permitted only with positive
evidence of a non-production environment, read from the real process:

| `NODE_ENV` (trimmed, lower-cased) | `QSD_ALLOW_UNSAFE_DEV` | result |
|---|---|---|
| `test` | any | allowed |
| `development` | `1` | allowed |
| `development` | anything else | denied |
| unset, empty, `production`, `prod`, `staging`, anything else | any | denied |
| no `process` object (browser bundle) | — | denied |

- constructor throws `ProductionGuardError` when denied;
- `draw()` re-checks, so a provider constructed earlier refuses once the
  environment changes;
- `createProviderFromEnv()` only constructs it when
  `QSD_QRNG_PROVIDER=UNSAFE_DEV_RANDOM` *and* the guard permits, and reads
  `NODE_ENV`/`QSD_ALLOW_UNSAFE_DEV` from the real process, never from an
  injected env object;
- `verify()` rejects `unsafe-dev` bundles unless `{ allowUnsafeDev: true }` is
  passed, so a dev bundle can never pass as a real one by accident;
- dev attestations carry no draw binding, so they also fail
  `requireInputBinding`.

There is no retry, cache, or fallback anywhere in this package.

## What the attestation proves

Every draw carries one of:

**`witness-signed`** (what ANU draws carry today). Contents: provider id,
`requestedAt`, `receivedAt`, `bytesSha256`, `inputsHash`, `nonce`,
`transport: 'https'`, the
verbatim HTTP response (`status`, allow-listed headers such as `date`,
`x-amzn-requestid`, `etag`; the raw `body`; `bodySha256`; the request `url`
with no key), the witness public key, and an Ed25519 signature over
`sha256("qsd.market/quantum/attestation/v1\n" + canonical(attestation minus signature))`.

A valid witness signature proves: *the holder of the QSD witness key attests
that this exact response body, with these headers, was received over TLS
from this provider at this time, for the measurement identified by
(inputsHash, nonce), and that these bytes are what it decoded.*
It does **not** prove that ANU sent the body (a dishonest witness key holder
could fabricate one), that the timestamps are truthful (they are asserted by
the witness), or that this was the only draw requested (see "Draw binding
and grinding"). The published witness key, the captured AWS request id, the
on-chain anchors and ANU's own logs are what a dispute would be settled
with. This is a witness attestation, not a provider signature, and the UI
must label it as such.

**Fail closed.** `verify()` accepts a witness-signed attestation only if its
key is in `trustedWitnessKeys`. With no key set, every witness-signed (and
provider-signed) attestation is rejected: the key embedded in the
attestation is never trusted on its own. `trustAnyKey: true` exists for
diagnostics and returns `{ ok: true, trust: 'self-consistent-only' }`, which a
UI must never render as "verified".

**`provider-signed`** (expressible now; no evaluated provider offers it).
Contents: scheme (`ed25519` only today), the provider's public key, the exact
signed message, the signature, and the captured response. `verify()` requires
`signedMessage` to be bound to the draw: it must be exactly the UTF-8 bytes of
`response.body`, or its decoded text must contain `bytesSha256`; a signature
over anything else is rejected. A valid, bound signature against a key in
`trustedProviderKeys` proves the bytes came from the provider.

**`unsafe-dev`**: proves nothing. Carries a warning string in every bundle.

The **commitment** binds `providerId`, `requestedAt`, the bytes and the entire
attestation (including its signature) into one hash. This hash is what the
protocol anchors on-chain *before* the outcome is revealed to the UI, so a
draw cannot be swapped after the fact.

## How a third party verifies a bundle

No account, no network, runs in a browser:

```ts
import { verify, parseBundle, bundleBinding, bundleHash } from '@qsd/quantum';
import { measurementResolver } from '@qsd/protocol'; // the pure rule, by id

const bundle = parseBundle(jsonText);
const result = verify(bundle, measurementResolver, {
  trustedWitnessKeys: QSD_WITNESS_PUBLIC_KEYS,   // the published list; [] rejects everything
  requireInputBinding: true,
});
// { ok: true } or { ok: false, reason: '...' } — never throws

// then compare with the chain:
bundleBinding(bundle);  // { inputsHash, nonce } — must equal the pair anchored BEFORE the draw
bundleHash(bundle);     // must equal the hash anchored AFTER the draw
```

`verify()` checks, in order: bundle shape and version; that the draw's
`providerId`/`requestedAt`/`receivedAt` match the attestation; that
`attestation.bytesSha256` equals `sha256(bytes)`; the attestation signature
and key trust (per kind); that the commitment recomputes; that `inputs.hash`
equals `sha256(canonical(inputs.value))`; that `attestation.inputsHash`, when
present, equals `inputs.hash` (and is present if `requireInputBinding`); that
the supplied resolver's `id` equals `bundle.resolverId`; and that
`resolver.resolve(bytes, inputs)` reproduces `outcome.value` and
`outcome.label` exactly. Any failure returns `{ ok: false, reason }`.

Unknown **top-level** bundle fields are accepted (documented decision): they
change `bundleHash()`, so the anchor comparison catches them, and rejecting
them would break forward-compatible readers. Unknown fields inside the
attestation are covered by its signature and are rejected.

To compare against the on-chain anchor, compute `bundleHash(bundle)`
(sha256 of the canonical JSON) and compare with the anchored value.

## Tests

`pnpm --filter @qsd/quantum test`

- attestation rejection on bad signature (witness, provider-signed, dev), key
  substitution, fail-closed default (no trusted keys → rejected),
  `trustAnyKey` labelling, provider `signedMessage` binding, draw-binding
  signing, body edits with and without hash recomputation
- production guards: constructor, draw-time, `createProviderFromEnv`;
  `NODE_ENV` unset / missing `process` / case and whitespace variants /
  `development` without the flag all denied; injected env cannot override
  the real process
- bundle round trip through `JSON.stringify`/`parse` and canonical
  serialisation; stable `bundleHash` regardless of key order
- `verify()` rejects tampering of bytes, commitment, inputs (with and without
  hash recomputation), outcome value and label, attestation signature and
  key, providerId, requestedAt, receivedAt, resolverId, version, resolvedAt,
  attestation kind; a bound ANU draw rejects inputs substitution even when
  the outcome would be identical; `requireInputBinding` rejects dev bundles;
  never throws on garbage or a throwing resolver
- event order, monotonic `seq`, payloads equal to the real draw values
- ANU parser against `test/fixtures/anu-documented-response.json` (a
  documented example, not live data); full draw through a mocked `fetch`
  including `beforeDraw` ordering, binding echo, header capture, key
  non-leakage (JSON, inspect, errors, scrubbed `cause`), sanitised provider
  text with raw `detail`, 403/429/network/timeout/bad-shape handling,
  endpoint override
- live ANU test runs only when `QSD_QRNG_API_KEY` is set; otherwise it is
  skipped with a printed notice and the suite still passes

## Limits and known gaps

- Max 1024 bytes per ANU request; `draw(nBytes)` enforces it.
- Only Ed25519 is implemented for `provider-signed`. Other schemes return
  `{ ok: false, reason: 'unsupported provider signature scheme' }` rather than
  being skipped.
- The witness key must be kept in a secret store; if it leaks, witness
  attestations lose their value until the published key is rotated. Rotation
  is a list change in `QSD_WITNESS_PUBLIC_KEYS`; old bundles stay verifiable
  as long as the old key stays listed.
- Grinding is made detectable by anchoring, not impossible; `verify()` alone
  cannot see other draws. A provider that signs per-request nonces, or a
  public randomness beacon, would close this fully and would slot into the
  `provider-signed` variant.
