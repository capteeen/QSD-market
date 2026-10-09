import type { ReactElement } from 'react';
import { quantumStateColor, type QuantumState } from '../tokens.js';
import { Unavailable } from './Unavailable.js';

export interface LineageNode {
  /** Coin name or ticker. */
  label: string;
  /** Link target. Omit for the current coin. */
  href?: string;
  /** Generation number, 0 for the genesis coin. */
  generation: number;
  /** Quantum state, mapped to a colour dot. */
  state: QuantumState;
}

export interface LineageBreadcrumbProps {
  /** Mother → … → current. Empty or undefined → "no lineage yet". */
  nodes?: readonly LineageNode[] | undefined;
  /** Why there is no lineage. */
  unavailable?: { reason: string };
  /** Custom link renderer (e.g. Next.js Link). Default: <a>. */
  renderLink?: (node: LineageNode, children: ReactElement) => ReactElement;
  className?: string;
}

/**
 * The generation chain. Each node carries a circle (quantum object) in the
 * colour of its state. The last node is the current page.
 */
export function LineageBreadcrumb({ nodes, unavailable, renderLink, className }: LineageBreadcrumbProps): ReactElement {
  const cls = ['qsd-lineage', className].filter(Boolean).join(' ');

  if (!nodes || nodes.length === 0) {
    return (
      <nav className={cls} aria-label="lineage" data-empty="true">
        <Unavailable label="no lineage yet" reason={unavailable?.reason ?? 'this coin has not collapsed'} />
      </nav>
    );
  }

  return (
    <nav aria-label="lineage">
      <ol className={cls}>
        {nodes.map((node, i) => {
          const last = i === nodes.length - 1;
          const inner = (
            <span className="qsd-lineage__link">
              <span className="qsd-lineage__gen">g{node.generation}</span> {node.label}
            </span>
          );
          const content = node.href
            ? renderLink
              ? renderLink(node, inner)
              : (
                  <a className="qsd-lineage__link" href={node.href}>
                    <span className="qsd-lineage__gen">g{node.generation}</span> {node.label}
                  </a>
                )
            : inner;
          return (
            <li
              key={`${node.generation}-${node.label}`}
              className="qsd-lineage__item"
              aria-current={last ? 'page' : undefined}
              data-state={node.state}
            >
              {i > 0 ? (
                <span className="qsd-lineage__sep" aria-hidden="true">
                  →
                </span>
              ) : null}
              <span
                className="qsd-lineage__dot"
                style={{ background: quantumStateColor[node.state] }}
                title={node.state}
                aria-label={node.state}
                role="img"
              />
              {content}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
