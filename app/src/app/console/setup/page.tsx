"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/AppShell";
import { ChainLogo } from "@/components/ChainLogo";
import { Avatar, Hash } from "@/components/ui";
import { CHAINS, CHAIN_ORDER } from "@/lib/chains";
import { fmtAmount } from "@/lib/format";
import { useLedgerStore } from "@/store/useLedgerStore";

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {note && <p className="mt-0.5 text-fg-muted">{note}</p>}
      <div className="mt-3 rounded-lg border border-border">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center gap-4 border-b border-border px-4 py-2 last:border-b-0">
      <div className="w-44 shrink-0 text-fg-muted">{label}</div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export default function SetupPage() {
  const { ledger } = useLedgerStore();
  if (!ledger) {
    return (
      <>
        <PageHeader title="Setup" />
        <div className="p-6 text-fg-muted">Loading</div>
      </>
    );
  }
  const m = ledger.meta;
  const c = ledger.config;
  const link = (a?: string) => (a && m.mode === "devnet" ? CHAINS.solana.explorerAddress(a) : undefined);

  return (
    <>
      <PageHeader title="Setup" sub="Read only" />
      <div className="mx-auto max-w-3xl space-y-10 px-4 py-6 md:px-6 md:py-8">
        <Group title="Program" note={m.mode === "devnet" ? "Deployed on Solana devnet." : "Simulated. Addresses are illustrative except the program id."}>
          <Row label="Issuer ledger">
            <Hash value={m.programId} href={link(m.programId)} />
          </Row>
          <Row label="Asset">
            <Hash value={m.assetPda} href={link(m.assetPda)} />
          </Row>
          <Row label="dWallet authority">
            <Hash value={m.cpiAuthority} href={link(m.cpiAuthority)} />
          </Row>
          <Row label="Solana mint authority">
            <Hash value={m.mintAuthority} href={link(m.mintAuthority)} />
          </Row>
          <Row label="Ika program">
            <Hash value={m.ikaProgram} href={link(m.ikaProgram)} />
          </Row>
        </Group>

        {ledger.dwallets.map((dw) => (
          <Group key={dw.id} title={dw.id} note={`${dw.curve} · zero-trust DKG`}>
            <Row label="Public key">
              <Hash value={dw.publicKey} />
            </Row>
            {dw.identities.map((i) => (
              <Row key={i.label} label={i.label}>
                <Hash value={i.value} />
              </Row>
            ))}
            {dw.onChainAddress && (
              <Row label="dWallet account">
                <Hash value={dw.onChainAddress} href={CHAINS.solana.explorerAddress(dw.onChainAddress)} />
              </Row>
            )}
            <Row label="User share">{dw.userShareLocation}</Row>
            <Row label="Signs for">
              {dw.chains.map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <ChainLogo chain={k} size={14} /> {CHAINS[k].name}
                </span>
              ))}
            </Row>
          </Group>
        ))}

        <Group title="Policy" note="Enforced by the program at create_intent and again at execute_leg.">
          <Row label="Global cap">
            <span className="num">{fmtAmount(c.globalCap)}</span>
          </Row>
          <Row label="Approvals">
            {c.threshold} of {c.approvers.length}
          </Row>
          <Row label="Timelock">{c.timelockSeconds} seconds</Row>
          {c.approvers.map((a) => (
            <Row
              key={a.id}
              label={
                <span className="inline-flex items-center gap-2 text-fg">
                  <Avatar id={a.id} name={a.name} /> {a.name}
                </span>
              }
            >
              <Hash value={a.pubkey} />
            </Row>
          ))}
        </Group>

        <Group title="Chains" note="Per-chain cap and the only address each chain may mint to.">
          {CHAIN_ORDER.map((k) => (
            <Row
              key={k}
              label={
                <span className="inline-flex items-center gap-2 text-fg">
                  <ChainLogo chain={k} size={14} /> {CHAINS[k].name}
                </span>
              }
            >
              <span className="num w-28 text-fg-muted">cap {fmtAmount(c.chainCaps[k], { compact: true })}</span>
              {c.allowlist[k].map((e) => (
                <Hash key={e.address} value={e.address} />
              ))}
            </Row>
          ))}
        </Group>

        <Group title="Trust model">
          <div className="space-y-2 px-4 py-3 leading-relaxed text-fg-muted">
            <p>
              Each dWallet key is split between the issuer and the Ika network. The network signs only what this program approves through its CPI authority. In
              production the issuer keeps its share in an HSM, with a custodian backup; the Ika pre-alpha uses placeholder values for it.
            </p>
            <p>A stolen operator key cannot mint without passing policy. A compromised program cannot mint without the issuer&apos;s share.</p>
            <p>The Ika Solana pre-alpha signs with a single mock signer, not real MPC. The control flow is the same.</p>
          </div>
        </Group>
      </div>
    </>
  );
}
