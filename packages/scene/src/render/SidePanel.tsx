/**
 * The HTML side panel: the real values as the geometry produces them. Every
 * row is a ui-tokens component, so a missing value renders the unavailable
 * state and never a placeholder.
 */
import { useMemo, type CSSProperties, type ReactElement } from 'react';
import { DataRow, HashDisplay, Panel, ProofBadge, colors, fonts, type ProofStatus } from '@qsd/ui-tokens';
import { authHash, chainLinkHash, fusedHash, leafHash, stopHash, toHex } from '../model/reducer.js';
import { STAGE_NAMES, type SceneState, type Stage } from '../model/types.js';
import { useHover, useSceneSnapshot, type Hover } from './context.js';

export interface SidePanelProps {
  onSkip?: (() => void) | undefined;
  /** Which stages to show rows for (MeasurementScene shows only the draw). */
  sections?: readonly PanelSection[];
  sound?: { enabled: boolean; toggle: () => void } | undefined;
  style?: CSSProperties;
}

export type PanelSection = 'stage' | 'keygen' | 'merkle' | 'superposition' | 'draw' | 'signing' | 'anchor' | 'lineage';
const ALL: readonly PanelSection[] = ['stage', 'keygen', 'merkle', 'superposition', 'draw', 'signing', 'anchor', 'lineage'];

// prettier-ignore
const panelStyle: CSSProperties = { position: 'absolute', top: 16, right: 16, width: 340, maxHeight: 'calc(100% - 32px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, fontFamily: fonts.mono, fontSize: 12, color: colors.text, pointerEvents: 'auto' };
// prettier-ignore
const btn: CSSProperties = { fontFamily: fonts.mono, fontSize: 11, background: 'transparent', color: colors.probability, border: `1px solid ${colors.border}`, padding: '4px 8px', cursor: 'pointer' };

function hex(b: Uint8Array | null): string | undefined {
  return b ? toHex(b, 0, b.length) : undefined;
}

export function hoverDescription(s: SceneState, h: Hover): { label: string; hash: string | undefined; reason: string } | null {
  if (!h) return null;
  switch (h.kind) {
    case 'link': {
      const v = chainLinkHash(s, h.chainIdx, h.depth);
      return { label: `leaf ${s.keygen.currentLeaf} chain ${h.chainIdx} depth ${h.depth}`, hash: hex(v), reason: 'this link has not been computed yet' };
    }
    case 'leaf':
      return { label: `leaf ${h.leaf}`, hash: hex(leafHash(s, h.leaf)), reason: 'leafFormed has not arrived for this leaf' };
    case 'node':
      return { label: `fused node level ${h.level + 1} index ${h.index}`, hash: hex(fusedHash(s, h.level, h.index)), reason: 'treeLevelFused has not arrived for this node' };
    case 'stop': {
      const d = s.signature.stopDepths[h.chainIdx] ?? -1;
      return { label: `signature element chain ${h.chainIdx}${d >= 0 ? ` depth ${d}` : ''}`, hash: hex(stopHash(s, h.chainIdx)), reason: 'signChainStop has not arrived for this chain' };
    }
    case 'auth':
      return { label: `auth path level ${h.level}`, hash: hex(authHash(s, h.level)), reason: 'authPathNode has not arrived for this level' };
  }
}

/**
 * Denominators come from the stream: keygenStart carries leaves / chains /
 * links. Before it has arrived every total is 0 — "0 / 0" is the truth (zero
 * of zero announced); "0 / 274432" would be a constant of the construction
 * presented as if the stream had announced it.
 */
export function announcedTotals(s: SceneState): { announced: boolean; leaves: number; chains: number; links: number; fused: number; height: number } {
  const k = s.keygen;
  if (!k.started || k.leaves <= 0 || k.chains <= 0 || k.links <= 0) return { announced: false, leaves: 0, chains: 0, links: 0, fused: 0, height: 0 };
  return {
    announced: true,
    leaves: k.leaves,
    chains: k.leaves * k.chains,
    links: k.leaves * k.chains * k.links,
    fused: k.leaves - 1,
    height: Math.round(Math.log2(k.leaves)),
  };
}

function proofStatus(s: SceneState): { status: ProofStatus; reason: string } {
  const d = s.draw;
  if (d.phase === 'idle') return { status: 'unavailable', reason: 'no draw requested' };
  if (d.phase === 'requested') return { status: 'pending', reason: `waiting for ${d.providerId ?? 'provider'}` };
  const a = d.attestation;
  if (!a) return { status: 'unavailable', reason: 'no attestation' };
  if (a.kind === 'unsafe-dev') return { status: 'invalid', reason: 'UNSAFE_DEV_RANDOM — proves nothing' };
  return { status: 'unverified', reason: `${a.kind} attestation received; verify the proof bundle` };
}

export function SidePanel({ onSkip, sections = ALL, sound, style }: SidePanelProps): ReactElement {
  const s = useSceneSnapshot();
  const hover = useHover();
  const has = useMemo(() => new Set(sections), [sections]);
  const hov = hoverDescription(s, hover);
  const stage = s.stage as Stage;
  const d = s.draw;
  const a = d.attestation;
  const proof = proofStatus(s);
  const totals = announcedTotals(s);

  return (
    <div style={{ ...panelStyle, ...style }} data-qsd-scene-panel>
      {has.has('stage') ? (
        <Panel eyebrow="STAGE" title={`${stage} · ${STAGE_NAMES[stage]}`} computing={stage === 2 || stage === 3 || (stage === 6 && !s.signature.ready)}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: colors.muted }}>{s.skipped.length ? `skipped ${s.skipped.join(', ')}` : 'every stage event-driven'}</span>
            <span style={{ display: 'flex', gap: 6 }}>
              {sound ? (
                <button type="button" style={btn} onClick={sound.toggle} aria-pressed={sound.enabled}>
                  sound {sound.enabled ? 'on' : 'off'}
                </button>
              ) : null}
              {onSkip && stage < 8 ? (
                <button type="button" style={btn} onClick={onSkip}>
                  skip ›
                </button>
              ) : null}
            </span>
          </div>
          {s.events.rejected > 0 ? (
            <DataRow label="rejected events" value={s.events.rejected} unit={s.events.lastRejectedReason ?? ''} />
          ) : null}
        </Panel>
      ) : null}

      {hov ? (
        <Panel eyebrow="HOVER" title={hov.label}>
          <HashDisplay hash={hov.hash} full unavailable={{ reason: hov.reason }} />
        </Panel>
      ) : null}

      {has.has('keygen') ? (
        <Panel eyebrow="KEY GENERATION" title="WOTS+ chains">
          <DataRow label="leaf in view" value={s.keygen.currentLeaf >= 0 ? s.keygen.currentLeaf : undefined} unavailable={{ reason: 'no chainStep yet' }} />
          <DataRow label="chain" value={s.keygen.lastChainIdx >= 0 ? s.keygen.lastChainIdx : undefined} unavailable={{ reason: 'no chainStep yet' }} />
          <DataRow label="depth" value={s.keygen.lastDepth >= 0 ? s.keygen.lastDepth : undefined} unavailable={{ reason: 'no chainStep yet' }} />
          <div style={{ padding: '2px 0 6px' }}>
            <HashDisplay hash={hex(s.keygen.lastHash)} unavailable={{ reason: 'no hash computed yet' }} />
          </div>
          {/* denominators come from keygenStart (leaves, chains, links); before it announces them they are 0 — never a constant of the construction */}
          <DataRow label="links shown" value={`${s.keygen.chainSteps - s.keygen.duplicateSteps} / ${totals.links}`} />
          <DataRow label="chains complete" value={`${s.keygen.chainsComplete} / ${totals.chains}`} />
          <DataRow label="leaves formed" value={`${s.keygen.leavesFormed} / ${totals.leaves}`} />
        </Panel>
      ) : null}

      {has.has('merkle') ? (
        <Panel eyebrow="MERKLE" title="tree of height 8">
          <DataRow label="fused level" value={s.merkle.highestLevel >= 0 ? s.merkle.highestLevel + 1 : undefined} {...(totals.announced ? { unit: `/ ${totals.height}` } : {})} unavailable={{ reason: 'no treeLevelFused yet' }} />
          <DataRow label="fused pairs" value={`${s.merkle.fusedTotal} / ${totals.fused}`} />
          <div style={{ padding: '2px 0' }}>
            <span style={{ color: colors.muted }}>root </span>
            <HashDisplay hash={hex(s.merkle.root)} unavailable={{ reason: 'rootReady has not arrived' }} />
          </div>
        </Panel>
      ) : null}

      {has.has('superposition') ? (
        <Panel eyebrow="SUPERPOSITION" title="ranges" {...(s.cloud.input ? {} : { unavailable: { reason: 'no superposition ranges provided' } })}>
          <DataRow label="supply min" value={s.cloud.input?.supplyMin.toString()} />
          <DataRow label="supply max" value={s.cloud.input?.supplyMax.toString()} />
          <DataRow label="width" value={s.cloud.input ? s.cloud.width.toFixed(4) : undefined} />
          <DataRow label="half-life" value={s.cloud.halfLifeSec > 0 ? s.cloud.halfLifeSec : undefined} unit="s" unavailable={{ reason: 'half-life is not a finite positive number' }} />
          {s.cloud.channels.map((c) => (
            <DataRow key={c.id} label={c.label} value={c.percentLabel} />
          ))}
        </Panel>
      ) : null}

      {has.has('draw') ? (
        <Panel eyebrow="QUANTUM DRAW" title="measurement" computing={d.phase === 'requested' || d.phase === 'arrived'}>
          <div style={{ padding: '0 0 6px' }}>
            <ProofBadge status={proof.status} reason={proof.reason} />
          </div>
          <DataRow label="provider" value={d.providerId ?? undefined} unavailable={{ reason: 'no entropy requested' }} />
          <DataRow label="requested at" value={d.requestedAt ?? undefined} unavailable={{ reason: 'no entropy requested' }} />
          <DataRow label="bytes" value={d.entropy ? d.entropy.length : undefined} unavailable={{ reason: 'no entropy arrived' }} />
          <div style={{ padding: '2px 0', wordBreak: 'break-all' }}>
            <span style={{ color: colors.muted }}>entropy </span>
            <HashDisplay hash={hex(d.entropy)} full unavailable={{ reason: 'no entropy arrived' }} />
          </div>
          <DataRow label="arrived at" value={d.arrivedAt ?? undefined} unavailable={{ reason: 'no entropy arrived' }} />
          <DataRow label="attestation" value={a ? a.kind : undefined} unavailable={{ reason: 'no entropy arrived' }} />
          {a ? <DataRow label="received at" value={a.receivedAt} /> : null}
          {a ? (
            <div style={{ padding: '2px 0' }}>
              <span style={{ color: colors.muted }}>inputs hash </span>
              <HashDisplay hash={a.inputsHash} unavailable={{ reason: 'draw made without a binding' }} />
            </div>
          ) : null}
          {a ? (
            <div style={{ padding: '2px 0' }}>
              <span style={{ color: colors.muted }}>nonce </span>
              <HashDisplay hash={a.nonce} unavailable={{ reason: 'draw made without a binding' }} />
            </div>
          ) : null}
          {a && a.kind === 'witness-signed' ? (
            <div style={{ padding: '2px 0' }}>
              <span style={{ color: colors.muted }}>witness key </span>
              <HashDisplay hash={a.witnessPublicKey} />
            </div>
          ) : null}
          {a && a.kind === 'provider-signed' ? (
            <div style={{ padding: '2px 0' }}>
              <span style={{ color: colors.muted }}>provider key </span>
              <HashDisplay hash={a.publicKey} />
            </div>
          ) : null}
          {a ? (
            <div style={{ padding: '2px 0' }}>
              <span style={{ color: colors.muted }}>signature </span>
              <HashDisplay hash={a.signature} />
            </div>
          ) : null}
          <div style={{ padding: '2px 0' }}>
            <span style={{ color: colors.muted }}>commitment </span>
            <HashDisplay hash={d.commitment ?? undefined} unavailable={{ reason: 'commitmentComputed has not arrived' }} />
          </div>
          <DataRow label="outcome" value={d.outcome?.label} unavailable={{ reason: 'outcomeResolved has not arrived' }} />
          <DataRow label="resolved at" value={d.resolvedAt ?? undefined} unavailable={{ reason: 'outcomeResolved has not arrived' }} />
        </Panel>
      ) : null}

      {has.has('signing') ? (
        <Panel eyebrow="SIGNING" title="WOTS+ · XMSS" computing={s.signature.started && !s.signature.ready}>
          <DataRow label="one-time key" value={s.signature.index >= 0 ? s.signature.index : undefined} unavailable={{ reason: 'signStart has not arrived' }} />
          <div style={{ padding: '2px 0' }}>
            <span style={{ color: colors.muted }}>digest </span>
            <HashDisplay hash={hex(s.signature.digest)} unavailable={{ reason: 'signStart has not arrived' }} />
          </div>
          <DataRow
            label="chain stops"
            value={`${s.signature.stopsSeen} / ${s.keygen.chains}`}
          />
          <DataRow
            label="auth path nodes"
            value={`${s.signature.authCount} / ${totals.height}`}
          />
          <DataRow label="signature size" value={s.signature.bytesLength ?? undefined} unit="bytes" unavailable={{ reason: 'signatureReady has not arrived' }} />
        </Panel>
      ) : null}

      {has.has('anchor') ? (
        <Panel eyebrow="ANCHORING" title="on-chain">
          <div style={{ padding: '2px 0' }}>
            <span style={{ color: colors.muted }}>tx </span>
            <HashDisplay hash={s.anchor.txSignature ?? undefined} unavailable={{ reason: s.anchor.submitted ? 'submitted, signature not yet known' : 'nothing anchored' }} />
          </div>
          <DataRow label="status" value={s.anchor.anchored ? 'anchored' : s.anchor.submitted ? 'submitted' : undefined} unavailable={{ reason: 'nothing anchored' }} />
          <DataRow label="slot" value={s.anchor.slot ?? undefined} unavailable={{ reason: 'slot not reported' }} />
        </Panel>
      ) : null}

      {has.has('lineage') ? (
        <Panel eyebrow="LINEAGE" title="chain of coins" {...(s.lineage ? {} : { unavailable: { reason: 'no lineage provided' } })}>
          <DataRow label="coin" value={s.lineage?.ca} />
          <DataRow label="generation" value={s.lineage?.generation} />
          <DataRow label="mother" value={s.lineage?.mother?.ca} unavailable={{ reason: 'genesis coin — no mother' }} />
          {s.lineage?.mother ? <DataRow label="mother final state" value={s.lineage.mother.finalState} /> : null}
          {s.lineage?.mother?.channelLabel ? <DataRow label="channel" value={s.lineage.mother.channelLabel} /> : null}
        </Panel>
      ) : null}
    </div>
  );
}
