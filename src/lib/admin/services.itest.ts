// Integration tests: a business's services table, against the local
// database. Run with `npm run test:integration`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/supabase";
import { emptyRow, type ServiceRow } from "./service-rows";
import { listServices, saveServices, ServicesError } from "./services";

const businesses: string[] = [];
after(async () => {
  await db().from("businesses").delete().in("id", businesses);
});

async function business() {
  const { data, error } = await db().from("businesses").insert({ slug: `itest-${randomUUID().slice(0, 8)}`, name: "Acme Fitness", timezone: "America/Chicago" }).select("id").single();
  assert.ifError(error);
  businesses.push(data!.id);
  return data!.id;
}

const training: ServiceRow = { ...emptyRow(), name: "Personal training session", category: "Sessions", price: "$60", duration: "60 minutes" };
const trial: ServiceRow = { ...emptyRow(), name: "Group class trial", price: "Free" };

test("the list is saved in order, replaced as a whole, and kept per business", async () => {
  const mine = await business();
  const theirs = await business();
  await saveServices(theirs, [trial]);

  assert.deepEqual(await saveServices(mine, [training, { ...trial, requestable: false }]), [training, { ...trial, requestable: false }]);
  assert.deepEqual(await saveServices(mine, [trial]), [trial], "replaced, not added to");
  assert.deepEqual(await listServices(mine), [trial]);
  assert.deepEqual(await listServices(theirs), [trial], "another business's list is untouched");
});

test("a list with problems is refused with each one on its row, and nothing changes", async () => {
  const mine = await business();
  await saveServices(mine, [training]);
  await assert.rejects(
    saveServices(mine, [trial, { ...trial, name: "group CLASS trial" }, { ...training, price: "x".repeat(61) }]),
    (err: unknown) =>
      err instanceof ServicesError &&
      err.status === 400 &&
      JSON.stringify(err.rows) ===
        JSON.stringify([
          { row: 1, field: "name", message: "Already listed in row 1." },
          { row: 2, field: "price", message: "Keep the price under 60 characters." },
        ]),
  );
  assert.deepEqual(await listServices(mine), [training]);
});
