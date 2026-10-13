import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyRow, parseServicesCsv, servicesToCsv, validateServices, type ServiceRow } from "./service-rows";

const braces: ServiceRow = { name: "Traditional braces (full treatment)", category: "Orthodontics", price: "$4,000 to $6,000", duration: "", description: "Metal braces.", requestable: true };
const gel: ServiceRow = { name: "Whitening touch-up gel (refill)", category: "Cosmetic", price: "$45", duration: "", description: "", requestable: false };

test("a valid list passes, trimmed; blank rows are dropped", () => {
  const result = validateServices([{ ...braces, name: "  Traditional braces (full treatment) " }, emptyRow(), gel]);
  assert.deepEqual(result, { ok: true, rows: [braces, gel] });
});

test("each bad row gets its own message, by row number; names must be unique ignoring case", () => {
  const result = validateServices([braces, { ...gel, name: "" , category: "x".repeat(61) }, { ...gel, name: "traditional BRACES (full treatment)" }]);
  assert.ok(!result.ok);
  assert.deepEqual(result.errors, [
    { row: 1, field: "name", message: "Enter the service's name." },
    { row: 1, field: "category", message: "Keep the category under 60 characters." },
    { row: 2, field: "name", message: "Already listed in row 1." },
  ]);
  assert.equal(validateServices(Array.from({ length: 201 }, (_, i) => ({ ...gel, name: `Service ${i}` }))).ok, false);
  assert.equal(validateServices("not a list").ok, false);
});

test("the CSV template round-trips, quotes and commas included", () => {
  const csv = servicesToCsv([braces, { ...gel, description: 'Gel, "refill" pack\nfor home' }]);
  assert.ok(csv.startsWith("Service,Category,Price,Duration,Description,Customers can request\r\n"));
  assert.deepEqual(parseServicesCsv(csv), { ok: true, rows: [braces, { ...gel, description: 'Gel, "refill" pack\nfor home' }] });
  assert.equal(servicesToCsv([]), "Service,Category,Price,Duration,Description,Customers can request\r\n", "an empty list is the template");
});

test("a CSV from any spreadsheet: columns in any order, only Service required, yes/no in many spellings", () => {
  const csv = "﻿Price,Service,Can request\n$95,Emergency exam,no\nFree,Orthodontic consultation,YES\n,Fluoride treatment,\n";
  assert.deepEqual(parseServicesCsv(csv), {
    ok: true,
    rows: [
      { ...emptyRow(), name: "Emergency exam", price: "$95", requestable: false },
      { ...emptyRow(), name: "Orthodontic consultation", price: "Free", requestable: true },
      { ...emptyRow(), name: "Fluoride treatment", requestable: false },
    ],
  });
  assert.deepEqual(parseServicesCsv("Name,Price\nGroup class trial,Free"), { ok: true, rows: [{ ...emptyRow(), name: "Group class trial", price: "Free" }] }, "no request column: requestable");
});

test("CSV problems are explained", () => {
  assert.deepEqual(parseServicesCsv(""), { ok: false, error: "The file is empty." });
  assert.ok(!parseServicesCsv("Price,Duration\n$5,1h").ok);
  const bad = parseServicesCsv("Service,Customers can request\nCleaning,maybe");
  assert.ok(!bad.ok && bad.error === 'Row 2: "Customers can request" must be yes or no.');
});
