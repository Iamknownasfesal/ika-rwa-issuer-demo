import { create } from "zustand";
import { demoConfig, type ApproverId } from "@/demoConfig";
import { getExecutor } from "@/executor";
import type { Intent, IntentDraft, LedgerState, StepEvent } from "@/types";

interface LedgerStore {
  ledger: LedgerState | null;
  loading: boolean;
  error: string | null;
  approver: ApproverId;
  selectedIntentId: string | null;
  modalOpen: boolean;
  /** Mobile navigation sheet. */
  navOpen: boolean;
  setNavOpen(open: boolean): void;
  executing: Record<string, boolean>;
  lastEvents: Record<string, StepEvent[]>;
  notice: string | null;
  notify(message: string | null): void;
  init(): Promise<void>;
  refresh(): Promise<void>;
  reset(): Promise<void>;
  setApprover(id: ApproverId): void;
  openIntent(id: string | null): void;
  setModalOpen(open: boolean): void;
  createIntent(draft: IntentDraft): Promise<Intent>;
  approveIntent(id: string): Promise<void>;
  executeIntent(id: string): Promise<void>;
  dismissError(): void;
}

function upsert(ledger: LedgerState, intent: Intent): LedgerState {
  const idx = ledger.intents.findIndex((i) => i.id === intent.id);
  const intents = idx >= 0 ? ledger.intents.map((i, k) => (k === idx ? intent : i)) : [intent, ...ledger.intents];
  return { ...ledger, intents };
}

export const useLedgerStore = create<LedgerStore>((set, get) => ({
  ledger: null,
  loading: false,
  error: null,
  approver: demoConfig.approvers[0].id,
  selectedIntentId: null,
  modalOpen: false,
  navOpen: false,
  executing: {},
  lastEvents: {},
  notice: null,

  async init() {
    if (get().ledger || get().loading) return;
    await get().refresh();
  },

  async refresh() {
    set({ loading: true });
    try {
      const ledger = await getExecutor().getLedger();
      set({ ledger, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  async reset() {
    const ledger = await getExecutor().reset();
    set({ ledger, selectedIntentId: null, modalOpen: false, executing: {}, lastEvents: {}, error: null });
  },

  setApprover: (approver) => {
    if (approver === get().approver) return;
    const name = demoConfig.approvers.find((a) => a.id === approver)?.name ?? approver;
    set({ approver });
    get().notify(
      demoConfig.mode === "devnet"
        ? `Now acting as ${name}. This demo signs with ${name}'s key on the server. In production ${name} would approve from their own Solana wallet.`
        : `Now acting as ${name}. Simulated mode, nothing is signed.`,
    );
  },
  notify: (notice) => set({ notice }),
  openIntent: (selectedIntentId) => set({ selectedIntentId }),
  setModalOpen: (modalOpen) => set({ modalOpen }),
  setNavOpen: (navOpen) => set({ navOpen }),
  dismissError: () => set({ error: null }),

  async createIntent(draft) {
    const intent = await getExecutor().createIntent(draft, get().approver);
    set((s) => ({ ledger: s.ledger ? upsert(s.ledger, intent) : s.ledger, modalOpen: false, selectedIntentId: intent.id }));
    return intent;
  },

  async approveIntent(id) {
    try {
      const intent = await getExecutor().approve(id, get().approver);
      set((s) => ({ ledger: s.ledger ? upsert(s.ledger, intent) : s.ledger }));
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  async executeIntent(id) {
    if (get().executing[id]) return;
    set((s) => ({ executing: { ...s.executing, [id]: true }, lastEvents: { ...s.lastEvents, [id]: [] } }));
    try {
      const final = await getExecutor().execute(id, (e) => {
        set((s) => {
          let ledger = s.ledger;
          if (ledger && e.intent) ledger = upsert(ledger, e.intent);
          else if (ledger && e.execution) {
            // Devnet events carry one leg's state; fold it into the intent so the stepper moves live.
            const it = ledger.intents.find((i) => i.id === id);
            if (it) {
              const legs = it.legs.map((_, k) => it.execution?.legs[k] ?? { status: "pending" as const });
              legs[e.leg] = e.execution;
              ledger = upsert(ledger, { ...it, status: "executing", execution: { legs } });
            }
          }
          if (ledger && e.asset) ledger = { ...ledger, asset: e.asset };
          return { ledger, lastEvents: { ...s.lastEvents, [id]: [...(s.lastEvents[id] ?? []), e] } };
        });
      });
      set((s) => ({ ledger: s.ledger ? upsert(s.ledger, final) : s.ledger }));
      // Pull the authoritative ledger after execution (devnet re-reads on-chain state),
      // keeping the transaction hashes the live run reported but the chain snapshot lacks.
      if (demoConfig.mode === "devnet") {
        await get().refresh();
        set((s) => {
          const fresh = s.ledger?.intents.find((i) => i.id === id);
          if (!s.ledger || !fresh?.execution || !final.execution) return {};
          const legs = fresh.execution.legs.map((l, k) => ({ ...final.execution!.legs[k], ...Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)) }));
          return { ledger: upsert(s.ledger, { ...fresh, execution: { legs } }) };
        });
      }
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set((s) => ({ executing: { ...s.executing, [id]: false } }));
    }
  },
}));
