import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";

const db = new PrismaClient();
const stamp = Date.now();

const user = await db.user.create({ data: { name: "Manual Test", email: `manual-${stamp}@example.invalid` } });
console.log("Created user:", user.id);

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
await db.authSession.create({ data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + 60000) } });
console.log("Token:", token);
console.log("Hash:", hash);

// Verify session exists
const found = await db.authSession.findUnique({ where: { tokenHash: hash } });
console.log("Found session:", !!found);

// Test API call
const res = await fetch("http://localhost:3033/api/worlds", {
  headers: { Cookie: `worldforge_session=${token}` }
});
console.log("API response:", res.status);

await db.$disconnect();
