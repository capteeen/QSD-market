/**
 * Spec §2: "the copy and visuals may not claim things quantum mechanics
 * doesn't say. Agent H checks every user-facing physics claim against
 * /docs/physics.md". Spec §8: "/how … Never paraphrase those files; render
 * them." — so physics.md IS user-facing copy and must itself be honest.
 *
 * Each FINDING test pins a sentence that overclaims or contradicts the
 * document's own trust-model section; it fails until the sentence is fixed.
 * The non-FINDING tests pin the sentences that are correct and must stay.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const doc = readFileSync(new URL('../../docs/physics.md', import.meta.url), 'utf8');
const flat = doc.replace(/\s+/g, ' ');

describe('/docs/physics.md — sentences that must stay (honest statements)', () => {
  it('says the coins are not quantum objects', () => {
    expect(flat).toContain('The coins are not quantum objects.');
  });
  it('says the resolver is deterministic and the only non-determinism is in the bytes', () => {
    expect(flat).toMatch(/The resolver is deterministic/);
    expect(flat).toMatch(/the only non-determinism is in the bytes/);
  });
  it('says what a witness-signed attestation does NOT prove', () => {
    expect(flat).toMatch(/It does \*\*not\*\* by itself prove the provider sent it/);
    expect(flat).toMatch(/you are trusting QSD's witness statement/);
  });
  it('says nobody downstream can verify the provider hardware is a QRNG', () => {
    expect(flat).toMatch(/cannot\*? verify from the bundle alone is that the provider's hardware is a working QRNG/);
  });
  it('names the dev provider and the production guard accurately', () => {
    expect(flat).toContain('`UNSAFE_DEV_RANDOM`');
    expect(flat).toMatch(/cannot be constructed or used when `NODE_ENV=production`/);
  });
  it('Zeno: cites the 1990 trapped-ion demonstration and the anti-Zeno effect', () => {
    expect(flat).toMatch(/trapped ions in 1990/);
    expect(flat).toMatch(/anti-Zeno/);
  });
});

describe('/docs/physics.md — overclaims and internal contradictions', () => {
  it('FINDING H-P1 (MEDIUM): "no trust in us" contradicts the witness-signed trust model stated later in the same document', () => {
    // §Measurement: "anyone can re-verify with verify() … with no account and no trust in us."
    // §QRNG: "you are trusting QSD's witness statement about what came over the TLS connection."
    expect(flat).not.toMatch(/no account and no trust in us/);
  });

  it('FINDING H-P2 (MEDIUM): the "What you cannot verify" list omits draw selection (grinding) and operator-asserted timestamps', () => {
    // A witness-signed bundle cannot show that the published draw was the only one requested for
    // those inputs, nor that requestedAt/receivedAt are truthful. physics.md must say so.
    expect(flat).toMatch(/only (draw|request)|more than one draw|discard|re-?draw|grind/i);
    expect(flat).toMatch(/timestamps? (are|is) (asserted|stated|recorded) by (QSD|the witness|us)/i);
  });

  it('FINDING H-P3 (LOW): "Nobody … could have predicted the bytes" ignores classical noise and the deterministic post-processing (extractor) in every real QRNG', () => {
    // A real device mixes quantum signal with classical detector/electronic noise and applies a
    // deterministic randomness extractor; its unpredictability rests on the device's entropy model,
    // not on quantum mechanics alone. The sentence as written is a device-independent claim.
    expect(flat).not.toMatch(/Nobody — not the operator, not the manufacturer — could have predicted the bytes before they were produced\./);
    expect(flat).toMatch(/extract(or|ion)|post-?process/i);
  });

  it('FINDING H-P4 (LOW): "no fact of the matter" / "irreducibly random" takes an interpretational position the document later disclaims', () => {
    // §Superposition: "there is no fact of the matter about which state it is 'really' in"
    // §Measurement: "QSD takes no position on interpretation" — Bohmian mechanics (a deterministic,
    // nonlocal hidden-variable theory) is not ruled out by Bell tests. Say "in the standard account".
    const noFact = /there is no fact of the matter about which state it is "really" in/;
    const hedged = /(in the standard|textbook|Copenhagen)[^.]*no fact of the matter|no fact of the matter[^.]*(in the standard|textbook|Copenhagen|interpretation)/i;
    expect(!noFact.test(flat) || hedged.test(flat)).toBe(true);
  });

  it('FINDING H-P5 (LOW): the headline bullet "every outcome ships with a proof bundle anyone can verify" needs the qualifier the body gives it', () => {
    // The body is careful ("what you verify is our record of the provider's response — not the photons");
    // the headline that every page "must agree with" is not.
    const headline = /every outcome ships with a proof bundle anyone can verify\./;
    expect(flat).not.toMatch(headline);
  });

  it('INFO: "one of two kinds" — there are three attestation kinds in the package (unsafe-dev is the third, dev-only)', () => {
    expect(flat).toMatch(/one of two kinds/);
  });
});
