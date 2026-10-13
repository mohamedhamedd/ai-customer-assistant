// Ingest every supported file in a folder into a business's knowledge base.
//
//   npm run ingest -- ./data/sample-clinic            # uses DEMO_BUSINESS_SLUG
//   npm run ingest -- ./data/sample-clinic --business acme
//
// Runs with --conditions=react-server so the server-only modules load outside
// Next.js, and --env-file-if-exists=.env.local for configuration.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db/supabase";
import { env } from "@/lib/env";
import { ingestDocument } from "@/lib/rag/ingest";
import { fillServicesIfEmpty } from "@/lib/admin/services";
import { sourceTypeFromFilename } from "@/lib/rag/extract";

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error("Usage: npm run ingest -- <folder> [--business <slug>]");
    process.exit(2);
  }
  const slugFlag = args.indexOf("--business");
  const slug = slugFlag >= 0 ? args[slugFlag + 1] : env().DEMO_BUSINESS_SLUG;

  const { data: business, error } = await db().from("businesses").select("id, name").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!business) throw new Error(`No business with slug "${slug}". Run \`npm run db:reset\` to seed the demo business.`);

  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
  console.log(`Ingesting ${files.length} file(s) from ${dir} into "${business.name}"\n`);

  let failed = 0;
  for (const filename of files) {
    // README.md documents the folder; it is not business knowledge.
    if (!sourceTypeFromFilename(filename) || filename.toLowerCase() === "readme.md") {
      console.log(`  skip     ${filename}`);
      continue;
    }
    const started = Date.now();
    const result = await ingestDocument({ businessId: business.id, filename, data: await readFile(path.join(dir, filename)) });
    const ms = `${Date.now() - started}ms`.padStart(7);
    switch (result.status) {
      case "ready":
        console.log(`  ready    ${filename.padEnd(24)} ${String(result.chunkCount).padStart(3)} chunks ${ms}  "${result.title}"`);
        break;
      case "duplicate":
        console.log(`  same     ${filename.padEnd(24)} already in the knowledge base`);
        break;
      case "title_taken":
      case "failed":
        failed++;
        console.log(`  FAILED   ${filename.padEnd(24)} ${result.error}`);
        break;
    }
  }
  // A business with no services yet gets them suggested from these
  // documents (one model call); a list someone saved is left alone.
  const services = await fillServicesIfEmpty(business.id);
  if (services.length) console.log(`\nServices (suggested from the documents; check them in Admin > Services): ${services.length}`);
  if (failed) {
    console.error(`\n${failed} file(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
