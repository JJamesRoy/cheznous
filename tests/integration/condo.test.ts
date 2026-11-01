import { describe, expect, it, beforeAll } from "vitest";
import { expectError, run } from "./helpers";
import { createCouple, type Couple } from "./fixtures";
import * as condo from "@/server/usecases/condo";
import * as keydates from "@/server/usecases/keydates";
import { addDays, todayIn } from "@/domain/dates";

const today = () => todayIn("America/Toronto");

describe("condo: property, mortgage, documents, capital, key dates", () => {
  let c: Couple;
  let other: Couple;

  beforeAll(async () => {
    c = await createCouple(["Camille", "Alex"]);
    other = await createCouple(["Noé", "Zoé"]);
  });

  it("returns property: null gracefully before anything is entered", async () => {
    const res = await run(c.a, condo.getProperty, {});
    expect(res.property).toBeNull();
    expect(res.mortgage).toBeNull();
    const sum = await run(c.a, condo.getMortgageSummary, {});
    expect(sum.schedule).toBeNull();
    expect(sum.reason).toBe("Ajoute d'abord les infos de ton hypothèque.");
  });

  it("upsertMortgage creates the property row; schedule comes from the original principal, flagged", async () => {
    const { mortgage, created } = await run(c.a, condo.upsertMortgage, {
      lender: "Desjardins",
      originalPrincipal: "400 000",
      rate: "4,79",
      rateType: "fixed",
      startDate: "2025-06-01",
      termYears: 5,
      amortizationYears: 25,
      paymentFrequency: "monthly",
      prepaymentPrivilegePct: "15 %",
    });
    expect(created).toBe(true);
    expect(mortgage.ratePct).toBeCloseTo(4.79);
    expect(mortgage.termMonths).toBe(60);
    expect(mortgage.renewalDate).toBe("2030-06-01");
    expect(mortgage.renewalEstimated).toBe(true);
    expect(mortgage.prepaymentPrivilegeBp).toBe(1500);

    const prop = await run(c.b, condo.getProperty, {});
    expect(prop.property).not.toBeNull();
    expect(prop.mortgage?.lender).toBe("Desjardins");
    expect(prop.privilege?.allowedCents).toBe(6_000_000);

    const sum = await run(c.a, condo.getMortgageSummary, {});
    expect(sum.balance?.source).toBe("original");
    expect(sum.compounding).toBe("semiannual");
    expect(sum.approximation).toBe(false);
    expect(sum.schedule?.paymentSource).toBe("computed");
    expect(sum.schedule?.next).toHaveLength(12);
    expect(sum.schedule!.next[0].date > today()).toBe(true);
    expect(sum.schedule!.estimatedBalanceCents).toBeLessThan(40_000_000);
    expect(sum.schedule!.projectedPayoffDate! > "2049-01-01").toBe(true);
  });

  it("a lender statement overrides the computed balance; variable rate is flagged as an approximation", async () => {
    await run(c.a, condo.addStatement, { balance: "380 000", asOf: addDays(today(), -10) });
    await run(c.a, condo.upsertMortgage, { payment: "2 300", rateType: "variable" });
    const sum = await run(c.b, condo.getMortgageSummary, {});
    expect(sum.balance).toMatchObject({ source: "statement", balanceCents: 38_000_000 });
    expect(sum.compounding).toBe("monthly");
    expect(sum.approximation).toBe(true);
    expect(sum.schedule?.paymentSource).toBe("entered");
    expect(sum.latestStatement?.balanceCents).toBe(38_000_000);
    await expectError(run(c.a, condo.addStatement, { balance: "1", asOf: addDays(today(), 3) }), "VALIDATION");
  });

  it("prepayments are idempotent and reduce the remaining privilege", async () => {
    const input = { amount: "5 000", paidBy: "moi", idempotencyKey: "prepay-0001-abc" };
    const r1 = await run(c.a, condo.addPrepayment, input);
    const r2 = await run(c.a, condo.addPrepayment, input);
    expect(r2.replayed).toBe(true);
    expect(r2.prepayment.id).toBe(r1.prepayment.id);
    expect(r1.privilege).toMatchObject({ allowedCents: 6_000_000, usedCents: 500_000, remainingCents: 5_500_000 });
    const sum = await run(c.a, condo.getMortgageSummary, {});
    expect(sum.prepayments).toHaveLength(1);
    expect(sum.schedule?.prepaymentsSinceReferenceCents).toBe(500_000);
    expect(sum.schedule?.estimatedBalanceCents).toBeLessThanOrEqual(37_500_000);
  });

  it("ownership shares must total 100 % and are only shown when entered", async () => {
    let cap = await run(c.a, condo.listCapitalContributions, {});
    expect(cap.ownershipShares).toBeNull();
    await expectError(run(c.a, condo.upsertProperty, { ownershipShares: { moi: 60, Alex: 30 } }), "VALIDATION");
    const { property } = await run(c.a, condo.upsertProperty, {
      ownershipShares: { moi: "60", Alex: 40 },
      postalCode: "h2x1y4",
      insurer: "Intact",
      insurancePremium: "450",
    });
    expect(property.postalCode).toBe("H2X 1Y4");
    expect(property.insurance.premiumCents).toBe(45_000);
    cap = await run(c.b, condo.listCapitalContributions, {});
    expect(cap.ownershipShares?.map((s) => s.bp).sort()).toEqual([4000, 6000]);
  });

  it("documents: Google Drive links are detected; storage paths must be in the household's folder", async () => {
    const { document } = await run(c.a, condo.addDocument, {
      title: "Déclaration de copropriété",
      docType: "declaration",
      externalUrl: "https://drive.google.com/file/d/abc123/view",
    });
    expect(document.provider).toBe("google_drive");
    expect(document.docTypeLabel).toBe("Déclaration de copropriété");
    const url = await run(c.b, condo.documentUrl, { id: document.id });
    expect(url.url).toContain("drive.google.com");

    await expectError(
      run(c.a, condo.addDocument, { title: "x", storagePath: `${other.householdId}/documents/x.pdf` }),
      "FORBIDDEN",
    );
    await expectError(run(c.a, condo.addDocument, { title: "x" }), "VALIDATION");
    const list = await run(c.b, condo.listDocuments, { docType: "declaration" });
    expect(list.documents.map((d) => d.id)).toContain(document.id);

    // Another household can neither read nor delete it.
    await expectError(run(other.a, condo.documentUrl, { id: document.id }), "NOT_FOUND");
    await expectError(run(other.a, condo.deleteDocument, { id: document.id }), "NOT_FOUND");
    await run(c.a, condo.deleteDocument, { id: document.id });
    expect((await run(c.a, condo.listDocuments, {})).documents).toHaveLength(0);
  });

  it("documents: uploaded files get a short-lived signed URL on demand; delete removes the file", async () => {
    const path = `${c.householdId}/documents/reglements.txt`;
    const up = await c.a.db.storage.from("household-files").upload(path, new Blob(["Règlements"], { type: "text/plain" }), { contentType: "text/plain" });
    expect(up.error).toBeNull();
    const { document } = await run(c.a, condo.addDocument, { title: "Règlements", docType: "reglements", storagePath: path, mimeType: "text/plain" });
    expect(document).toMatchObject({ kind: "file", provider: "storage" });
    const url = await run(c.b, condo.documentUrl, { id: document.id });
    expect(url.expiresInSeconds).toBe(300);
    expect(url.url).toContain("token=");
    const del = await run(c.b, condo.deleteDocument, { id: document.id });
    expect(del.fileRemoved).toBe(true);
  });

  it("capital contributions: per-partner totals and a semicolon CSV with fr-CA amounts", async () => {
    await run(c.a, condo.addCapitalContribution, { kind: "down_payment", source: "celiapp", amount: "40 000", contributedOn: "2025-05-15" });
    await run(c.a, condo.addCapitalContribution, { kind: "notary", source: "cash", amount: "1234,56", contributedOn: "2025-06-01", note: "Me Tremblay; frais" });
    await run(c.b, condo.addCapitalContribution, { kind: "down_payment", source: "rap_reer", amount: "35 000", contributedOn: "2025-05-15" });
    const cap = await run(c.a, condo.listCapitalContributions, {});
    expect(cap.note).toBe("Ceci est un registre, pas un avis juridique. Les parts de propriété ne sont jamais présumées.");
    expect(cap.totalCents).toBe(7_623_456);
    const camille = cap.members.find((m) => m.name === "Camille")!;
    expect(camille.totalCents).toBe(4_123_456);
    expect(camille.byKind.find((k) => k.key === "down_payment")?.label).toBe("Mise de fonds");
    expect(camille.bySource.map((s) => s.label)).toContain("CELIAPP");

    const all = await run(c.b, condo.capitalContributionsCsv, {});
    const lines = all.csv.trim().split("\r\n");
    expect(lines[0]).toBe("date;partenaire;type;source;montant;note");
    expect(lines).toHaveLength(4);
    expect(lines).toContain('2025-06-01;Camille;Notaire;Épargne / comptant;1234,56;"Me Tremblay; frais"');
    const mine = await run(c.b, condo.capitalContributionsCsv, { member: "moi" });
    expect(mine.filename).toMatch(/^apports-capital-alex-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(mine.rowCount).toBe(1);

    await expectError(run(other.a, condo.deleteCapitalContribution, { id: cap.contributions[0].id }), "NOT_FOUND");
  });

  it("key dates merge every source within the window, sorted by date", async () => {
    const t = today();
    await run(c.a, condo.upsertMortgage, { renewalDate: addDays(t, 30) });
    await run(c.a, condo.upsertSpecialAssessment, { title: "Toiture", amount: "2 500", dueOn: addDays(t, 10) });
    await run(c.a, condo.upsertSpecialAssessment, { title: "Déjà payée", amount: "100", dueOn: addDays(t, 11), markPaid: true });
    await run(c.a, condo.upsertAppliance, { name: "Lave-vaisselle", purchasedOn: addDays(t, -305), warrantyEndsOn: addDays(t, 60) });
    await run(c.a, condo.upsertProperty, { agmDate: addDays(t, 200) }); // outside the default window
    const bill = await c.a.db
      .from("recurring_rules")
      .insert({ household_id: c.householdId, kind: "bill", title: "Taxes municipales", amount_cents: 150_000, frequency: "installments", anchor_date: addDays(t, 1), installment_dates: [addDays(t, 20), addDays(t, 140)] })
      .select("id")
      .single();
    expect(bill.error).toBeNull();
    const task = await c.a.db.from("tasks").insert({ household_id: c.householdId, title: "Changer le filtre de la hotte", kind: "maintenance", due_on: addDays(t, 5) });
    expect(task.error).toBeNull();

    const res = await run(c.b, keydates.keyDates, {});
    const kinds = res.items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["mortgage_renewal", "special_assessment", "warranty_end", "bill", "maintenance"]));
    expect(kinds).not.toContain("agm");
    expect(res.items.filter((i) => i.kind === "bill")).toHaveLength(1);
    expect(res.items.find((i) => i.title.includes("Déjà payée"))).toBeUndefined();
    const dates = res.items.map((i) => i.date);
    expect([...dates].sort()).toEqual(dates);
    expect(res.items.every((i) => i.date >= t && i.date <= addDays(t, 120))).toBe(true);
    const sa = res.items.find((i) => i.kind === "special_assessment")!;
    expect(sa).toMatchObject({ daysUntil: 10, amountCents: 250_000 });

    const wide = await run(c.a, keydates.keyDates, { days: 365 });
    expect(wide.items.map((i) => i.kind)).toContain("agm");
    expect(wide.items.filter((i) => i.kind === "bill")).toHaveLength(2);
  });

  it("maintenance: open tasks first, history with an existing expense link only", async () => {
    const appliances = await run(c.a, condo.listAppliances, {});
    const dw = appliances.appliances.find((a) => a.name === "Lave-vaisselle")!;
    expect(dw.warranty.status).toBe("active");
    const { record } = await run(c.a, condo.addMaintenanceRecord, { title: "Nettoyage du filtre", applianceId: dw.id, cost: "0" });
    expect(record.appliance?.name).toBe("Lave-vaisselle");
    await expectError(run(other.a, condo.addMaintenanceRecord, { title: "x", applianceId: dw.id }), "NOT_FOUND");
    const m = await run(c.b, condo.listMaintenance, {});
    expect(m.openCount).toBe(1);
    expect(m.tasks[0].title).toBe("Changer le filtre de la hotte");
    expect(m.history[0].id).toBe(record.id);
  });

  it("another household sees none of it", async () => {
    const res = await run(other.a, condo.getProperty, {});
    expect(res.property).toBeNull();
    expect(res.assessments).toHaveLength(0);
    expect((await run(other.a, keydates.keyDates, { days: 365 })).items).toHaveLength(0);
  });
});
