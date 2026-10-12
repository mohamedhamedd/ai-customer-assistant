import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUpload, MAX_UPLOAD_BYTES, sourceTypeFromFilename } from "./file-types";

test("accepted types by extension, case-insensitive", () => {
  assert.equal(sourceTypeFromFilename("Pricing 2026.PDF"), "pdf");
  assert.equal(sourceTypeFromFilename("faq.markdown"), "md");
  assert.equal(sourceTypeFromFilename("notes.txt"), "txt");
  assert.equal(sourceTypeFromFilename("menu.docx"), null);
  assert.equal(sourceTypeFromFilename("README"), null);
});

test("an upload is refused before it is read: wrong type, empty, over 10 MB", () => {
  assert.match(checkUpload("menu.docx", 100)!, /Unsupported file type/);
  assert.equal(checkUpload("faq.md", 0), "The file is empty.");
  assert.equal(checkUpload("big.pdf", MAX_UPLOAD_BYTES + 1), "The file is larger than 10 MB.");
  assert.equal(checkUpload("big.pdf", MAX_UPLOAD_BYTES), null, "exactly 10 MB is allowed");
});
