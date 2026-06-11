import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { requirePetRole } from "../src/middleware/pet-access";
import { requireSession } from "../src/middleware/session";
import { seedPet, seedUserWithSession, withMember } from "./helpers";

const probe = new Hono<AppEnv>();
probe.get(
  "/api/pets/:petId/probe",
  requireSession,
  requirePetRole("viewer"),
  (c) => c.json({ data: { role: c.get("petRole"), name: c.get("pet").name } }),
);
probe.post(
  "/api/pets/:petId/probe",
  requireSession,
  requirePetRole("editor"),
  (c) => c.json({ data: { ok: true } }),
);
probe.delete(
  "/api/pets/:petId/probe",
  requireSession,
  requirePetRole("owner"),
  (c) => c.json({ data: { ok: true } }),
);

function req(path: string, cookie: string, method = "GET") {
  return probe.request(path, { method, headers: { Cookie: cookie } }, env);
}

describe("requirePetRole", () => {
  it("404 not_found for a pet that does not exist", async () => {
    const { cookie } = await seedUserWithSession();
    const res = await req("/api/pets/01HZZZZZZZZZZZZZZZZZZZZZZZ/probe", cookie);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("404 (not 403) for a non-member, even though the pet exists", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const outsider = await seedUserWithSession({ email: "eve@example.com" });
    const res = await req(`/api/pets/${petId}/probe`, outsider.cookie);
    expect(res.status).toBe(404);
  });

  it("attaches petRole and the pet row for a member", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId, "viewer", { name: "Hana" });
    const res = await req(`/api/pets/${petId}/probe`, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { role: "viewer", name: "Hana" },
    });
  });

  it("403 forbidden when a viewer hits an editor route", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId, "viewer");
    const res = await req(`/api/pets/${petId}/probe`, cookie, "POST");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });

  it("403 when an editor hits an owner route", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId, "editor");
    const res = await req(`/api/pets/${petId}/probe`, cookie, "DELETE");
    expect(res.status).toBe(403);
  });

  it("owner passes viewer, editor, and owner routes", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId, "owner");
    for (const method of ["GET", "POST", "DELETE"]) {
      const res = await req(`/api/pets/${petId}/probe`, cookie, method);
      expect(res.status).toBe(200);
    }
  });

  it("withMember grants a second user access at the given role", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const editor = await seedUserWithSession({ email: "ed@example.com" });
    await withMember(petId, editor.userId, "editor");
    const res = await req(`/api/pets/${petId}/probe`, editor.cookie, "POST");
    expect(res.status).toBe(200);
  });
});
