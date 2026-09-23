"use client";

import { Plus } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { IntentList } from "@/components/IntentList";
import { useLedgerStore } from "@/store/useLedgerStore";

export default function IntentsPage() {
  const { ledger, setModalOpen } = useLedgerStore();
  return (
    <>
      <PageHeader title="Intents" sub={ledger ? `${ledger.intents.length}` : undefined}>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
          <Plus className="size-3.5" /> New intent
        </button>
      </PageHeader>
      {ledger ? <IntentList intents={ledger.intents} /> : <div className="p-6 text-fg-muted">Loading</div>}
    </>
  );
}
