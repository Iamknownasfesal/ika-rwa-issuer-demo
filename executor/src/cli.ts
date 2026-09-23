#!/usr/bin/env tsx
/**
 * CLI: `pnpm executor run --intent 3 [--leg 0] [--deliver mock|live]`
 */
import { resolve } from 'node:path';
import { configFromDeployment, loadDeployment, loadKeypair, repoRoot, runIntent, runLeg, type DeliverMode, type StepEvent } from './index.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function print(e: StepEvent): void {
  const icon = e.status === 'ok' ? '✓' : e.status === 'error' ? '✗' : '…';
  const parts = [`[leg ${e.leg}] ${icon} ${e.step}`, e.detail ?? ''];
  if (e.txHash) parts.push(`tx=${e.txHash}`);
  if (e.explorer) parts.push(e.explorer);
  if (e.messageApproval) parts.push(`messageApproval=${e.messageApproval}`);
  if (e.signature) parts.push(`sig=${e.signature.slice(0, 32)}…`);
  console.log(parts.filter(Boolean).join('  '));
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd !== 'run') {
    console.error('usage: executor run --intent <index> [--leg <n>] [--deliver mock|live] [--keypair keys/executor.json]');
    process.exit(1);
  }
  const intentIndex = BigInt(arg('intent') ?? (() => { throw new Error('--intent required'); })());
  const leg = arg('leg');
  const deliver = (arg('deliver') ?? process.env.DELIVER ?? 'mock') as DeliverMode;
  const deployment = loadDeployment();
  const executor = await loadKeypair(arg('keypair') ?? resolve(repoRoot(), 'keys/executor.json'));
  if (executor.address !== deployment.executor) throw new Error(`keypair ${executor.address} is not the deployment executor ${deployment.executor}`);
  const cfg = await configFromDeployment(deployment, executor, deliver);
  const gen = leg !== undefined ? runLeg(cfg, intentIndex, Number(leg)) : runIntent(cfg, intentIndex);
  for await (const e of gen) print(e);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
