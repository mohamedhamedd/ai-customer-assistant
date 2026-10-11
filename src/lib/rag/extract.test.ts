import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveTitle, ExtractError, extractText, sourceTypeFromFilename } from "./extract";

test("source type comes from the extension, case-insensitively", () => {
  assert.equal(sourceTypeFromFilename("Pricing.PDF"), "pdf");
  assert.equal(sourceTypeFromFilename("notes.markdown"), "md");
  assert.equal(sourceTypeFromFilename("a.txt"), "txt");
  assert.equal(sourceTypeFromFilename("policies.html"), null);
  assert.equal(sourceTypeFromFilename("README"), null);
});

test("title: markdown H1, else a short first line, else the file name", () => {
  assert.equal(deriveTitle("# Lakeside Dental Clinic — Services\n\ntext", "services.md", "md"), "Lakeside Dental Clinic — Services");
  assert.equal(deriveTitle("no heading here", "opening-hours_2026.md", "md"), "Opening hours 2026");
  assert.equal(deriveTitle("Patient Policies\nEffective 2026.", "policies.pdf", "pdf"), "Patient Policies");
  // A first line that is a sentence or too long is not a title.
  assert.equal(deriveTitle("This document explains our fees.", "fees.txt", "txt"), "Fees");
  assert.equal(deriveTitle("x".repeat(101), "long.txt", "txt"), "Long");
});

test("text files: UTF-8 is normalised and hashed; identical content hashes the same", async () => {
  const a = await extractText(Buffer.from("﻿Hello\r\nworld  \r\n"), "txt");
  const b = await extractText(Buffer.from("Hello\nworld"), "txt");
  assert.equal(a.text, "Hello\nworld");
  assert.equal(a.contentHash, b.contentHash);
});

test("text files: UTF-16 with a BOM is decoded, other encodings are refused", async () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Prix £10", "utf16le")]);
  assert.equal((await extractText(utf16, "txt")).text, "Prix £10");

  const latin1 = Buffer.from("Prix \xa310 pour le blanchiment des dents", "latin1");
  await assert.rejects(extractText(latin1, "txt"), (err: unknown) => err instanceof ExtractError && err.code === "unsupported_encoding");
});

test("an empty or whitespace-only file is an error", async () => {
  await assert.rejects(extractText(Buffer.from("  \n\n"), "md"), (err: unknown) => err instanceof ExtractError && err.code === "empty");
});

test("a non-PDF byte stream with a .pdf name fails as parse_failed", async () => {
  await assert.rejects(extractText(Buffer.from("not a pdf"), "pdf"), (err: unknown) => err instanceof ExtractError && err.code === "parse_failed");
});
