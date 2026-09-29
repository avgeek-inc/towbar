import assert from "node:assert/strict";

export type DnsRecord = {
  id: string;
  name: string;
  type: string;
  content: string;
  comment?: string;
  proxied: boolean;
  ttl: number;
};

export function dnsFixture(initial: DnsRecord[] = []) {
  const records = new Map(initial.map((record) => [record.id, { ...record }]));
  const mutations: Array<{ method: string; name: string }> = [];
  const json = (result: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify({ result, success: status < 400 }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  let nextId = 0;
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-token",
    );
    if (url.pathname === "/client/v4/zones")
      return json(
        url.searchParams.get("name") === "example.com"
          ? [{ id: "zone", name: "example.com" }]
          : [],
      );
    if (url.pathname.endsWith("/settings/ssl"))
      return json({ value: "strict" });
    if (!init?.method)
      return json(
        [...records.values()].filter(
          ({ name }) => name === url.searchParams.get("name"),
        ),
      );
    const id = url.pathname.split("/").at(-1)!;
    if (init.method === "DELETE") {
      const record = records.get(id);
      assert(record);
      mutations.push({ method: "DELETE", name: record.name });
      records.delete(id);
      return json({ id });
    }
    const body = JSON.parse(String(init.body)) as Omit<DnsRecord, "id">;
    mutations.push({ method: init.method, name: body.name });
    const recordId = init.method === "POST" ? `created-${++nextId}` : id;
    const record = { ...records.get(recordId), ...body, id: recordId };
    records.set(recordId, record);
    return json(record);
  };
  return { records, mutations, fetcher };
}
