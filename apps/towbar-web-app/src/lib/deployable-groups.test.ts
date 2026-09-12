import assert from "node:assert/strict";
import { test } from "node:test";
import { groupDeployableInstances } from "./deployable-groups";

void test("inventory groups stable logical identities and preserves instance links", () => {
  const instance = (
    id: string,
    entityId: string | null,
    sourceId: string,
    name: string,
  ) => ({
    id,
    entityId,
    sourceId,
    manifestId: "website",
    environment: { name },
  });
  const staging = instance("staging-id", "entity-one", "source-one", "staging");
  const production = instance(
    "production-id",
    "entity-one",
    "source-one",
    "production",
  );
  const foreign = instance(
    "foreign-id",
    "entity-one",
    "source-two",
    "production",
  );
  const other = instance("other-id", "entity-two", "source-one", "production");
  const input = [staging, foreign, production, other];
  const groups = groupDeployableInstances(input);
  assert.deepEqual(
    groups.map((group) => group.items.map((item) => item.id)),
    [["production-id", "staging-id"], ["foreign-id"], ["other-id"]],
  );
  assert.equal(groups[0]!.items[1], staging);
  assert.equal(input[0], staging);
  assert.deepEqual(groupDeployableInstances([staging])[0]!.items, [staging]);
  assert.equal(
    groupDeployableInstances([
      instance("unlinked-one", null, "source-one", "production"),
      instance("unlinked-two", null, "source-one", "staging"),
    ]).length,
    2,
  );
  assert.deepEqual(groupDeployableInstances([]), []);
});
