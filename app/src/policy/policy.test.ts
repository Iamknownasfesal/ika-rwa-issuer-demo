import { describe, expect, it } from "vitest";
import { buildSeed } from "@/seed";
import { IDS } from "@/seed";
import { toBase } from "@/lib/format";
import { evaluate, evaluateExecution, allOk, explainProgramError } from "./policy";
import type { Intent } from "@/types";

const ledger = () => {
  const s = buildSeed();
  return { asset: s.asset, config: s.config };
};
const rule = (rs: ReturnType<typeof evaluate>, id: string) => rs.find((r) => r.rule === id)!;

describe("evaluate: mint", () => {
  it("passes a valid mint on Base with every rule listed", () => {
    const rs = evaluate({ type: "mint", amount: toBase(2_500_000), dstChain: "base", recipient: IDS.treasuries.base, memo: "" }, ledger());
    expect(rs.map((r) => r.rule)).toEqual(["amount", "globalCap", "chainCap", "allowlist"]);
    expect(allOk(rs)).toBe(true);
    expect(rule(rs, "globalCap").detail).toBe("Global cap: 65,500,000 + 2,500,000 = 68,000,000 ≤ 100,000,000");
    expect(rule(rs, "chainCap").detail).toBe("Base cap: 7,500,000 + 2,500,000 = 10,000,000 ≤ 15,000,000");
  });

  it("reports both global and per-chain cap failures for a 40M Ethereum mint", () => {
    const rs = evaluate({ type: "mint", amount: toBase(40_000_000), dstChain: "ethereum", recipient: IDS.treasuries.ethereum, memo: "" }, ledger());
    expect(rule(rs, "globalCap").ok).toBe(false);
    expect(rule(rs, "globalCap").detail).toBe("Global cap: 65,500,000 + 40,000,000 = 105,500,000 > 100,000,000");
    expect(rule(rs, "chainCap").ok).toBe(false);
    expect(rule(rs, "chainCap").detail).toBe("Ethereum cap: 20,000,000 + 40,000,000 = 60,000,000 > 30,000,000");
    expect(rule(rs, "allowlist").ok).toBe(true);
    expect(allOk(rs)).toBe(false);
  });

  it("rejects a non-allowlisted recipient while other rules pass", () => {
    const rs = evaluate({ type: "mint", amount: toBase(1_000_000), dstChain: "ethereum", recipient: "0x" + "9".repeat(40), memo: "" }, ledger());
    expect(rule(rs, "allowlist").ok).toBe(false);
    expect(rule(rs, "allowlist").detail).toContain("not in the Ethereum allowlist");
    expect(rule(rs, "globalCap").ok).toBe(true);
    expect(rule(rs, "chainCap").ok).toBe(true);
  });

  it("flags a malformed address", () => {
    const rs = evaluate({ type: "mint", amount: toBase(1), dstChain: "sui", recipient: "0xabc", memo: "" }, ledger());
    expect(rule(rs, "allowlist").detail).toContain("not a valid Sui");
  });

  it("rejects zero and non-integer amounts", () => {
    expect(rule(evaluate({ type: "mint", amount: 0, dstChain: "base", recipient: IDS.treasuries.base, memo: "" }, ledger()), "amount").ok).toBe(false);
    expect(rule(evaluate({ type: "mint", amount: 1.5, dstChain: "base", recipient: IDS.treasuries.base, memo: "" }, ledger()), "amount").ok).toBe(false);
  });
});

describe("evaluate: burn", () => {
  it("checks sufficient supply and no cap rules", () => {
    const rs = evaluate({ type: "burn", amount: toBase(6_000_000), srcChain: "sui", source: IDS.treasuries.sui, memo: "" }, ledger());
    expect(rs.map((r) => r.rule)).toEqual(["amount", "supply"]);
    expect(rule(rs, "supply").ok).toBe(false);
    expect(rule(rs, "supply").detail).toBe("Sui supply: 5,000,000 < 6,000,000");
  });
  it("passes when supply is sufficient", () => {
    const rs = evaluate({ type: "burn", amount: toBase(5_000_000), srcChain: "sui", source: IDS.treasuries.sui, memo: "" }, ledger());
    expect(allOk(rs)).toBe(true);
  });
});

describe("evaluate: move", () => {
  it("evaluates supply on the source and cap + allowlist on the destination, global total unchanged", () => {
    const rs = evaluate(
      { type: "move", amount: toBase(5_000_000), srcChain: "ethereum", dstChain: "sui", recipient: IDS.treasuries.sui, source: IDS.treasuries.ethereum, memo: "" },
      ledger(),
    );
    expect(rs.map((r) => r.rule)).toEqual(["amount", "supply", "chainCap", "allowlist"]);
    expect(allOk(rs)).toBe(true);
    expect(rule(rs, "supply").detail).toBe("Ethereum supply: 20,000,000 ≥ 5,000,000");
    expect(rule(rs, "chainCap").detail).toBe("Sui cap: 5,000,000 + 5,000,000 = 10,000,000 ≤ 15,000,000");
  });
  it("fails destination cap on a move even though the global total is unchanged", () => {
    const rs = evaluate(
      { type: "move", amount: toBase(12_000_000), srcChain: "ethereum", dstChain: "sui", recipient: IDS.treasuries.sui, source: IDS.treasuries.ethereum, memo: "" },
      ledger(),
    );
    expect(rule(rs, "chainCap").ok).toBe(false);
    expect(rule(rs, "supply").ok).toBe(true);
  });
  it("rejects same-chain moves", () => {
    const rs = evaluate({ type: "move", amount: 1, srcChain: "sui", dstChain: "sui", recipient: IDS.treasuries.sui, source: IDS.treasuries.sui, memo: "" }, ledger());
    expect(rule(rs, "chainCap").ok).toBe(false);
  });
});

describe("evaluateExecution", () => {
  const base: Intent = {
    id: "INT-1",
    index: 0,
    type: "mint",
    legs: [],
    amount: 1,
    memo: "",
    proposer: "alice",
    status: "pending_approval",
    policyResults: [],
    approvals: [],
    createdAt: new Date().toISOString(),
  };
  const cfg = ledger().config;

  it("requires distinct approvers that are not the proposer", () => {
    const rs = evaluateExecution({ ...base, approvals: [{ approver: "bob", at: "" }, { approver: "bob", at: "" }] }, cfg);
    expect(rule(rs, "threshold").ok).toBe(false);
    const rs2 = evaluateExecution({ ...base, approvals: [{ approver: "alice", at: "" }, { approver: "bob", at: "" }] }, cfg);
    expect(rule(rs2, "threshold").ok).toBe(false);
    expect(rule(rs2, "threshold").detail).toContain("proposer cannot approve");
    const rs3 = evaluateExecution({ ...base, approvals: [{ approver: "bob", at: "" }, { approver: "carol", at: "" }] }, cfg);
    expect(rule(rs3, "threshold").ok).toBe(true);
  });

  it("enforces the timelock from approvedAt", () => {
    const approvedAt = new Date(1_000_000).toISOString();
    const early = evaluateExecution({ ...base, approvedAt }, cfg, 1_000_000 + 2000);
    expect(rule(early, "timelock").ok).toBe(false);
    expect(rule(early, "timelock").detail).toBe("Timelock: 3s remaining of 5s");
    const late = evaluateExecution({ ...base, approvedAt }, cfg, 1_000_000 + 5000);
    expect(rule(late, "timelock").ok).toBe(true);
  });
});

describe("explainProgramError", () => {
  it("maps custom error codes", () => {
    expect(explainProgramError(4)).toContain("not allowlisted");
    expect(explainProgramError("InstructionError(0, Custom(1))")).toContain("Global cap exceeded");
    expect(explainProgramError("custom program error: 0x9")).toContain("Timelock");
  });
});
