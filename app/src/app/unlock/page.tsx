import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { UnlockForm } from "./UnlockForm";

export const metadata: Metadata = { title: "TBILL issuer ledger", robots: { index: false, follow: false } };

export default function UnlockPage() {
  return (
    <main className="site grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2.5">
          <LogoMark size={22} />
          <span className="font-display text-[17px] font-medium tracking-[-0.03em]">ledger</span>
        </div>
        <h1 className="mt-10 font-display text-[40px] font-medium leading-[0.95] tracking-[-0.05em]">A private demo.</h1>
        <p className="mt-3 font-serif text-[21px] italic leading-snug text-stone">Enter the password you were sent.</p>
        <Suspense>
          <UnlockForm />
        </Suspense>
      </div>
    </main>
  );
}
