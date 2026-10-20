import { PrismaClient } from "@prisma/client";
import { newToken, tokenHash } from "../src/lib/passwords";
const db = new PrismaClient();
async function main() {
  const email = process.argv.slice(2).find(argument => argument !== "--");
  const user = email ? await db.user.findUnique({ where: { email } }) : (await db.world.findFirst({ orderBy: { createdAt: "asc" }, select: { owner: true } }))?.owner;
  if (!user) throw new Error("No existing owner found. Pass an existing user's email to auth:setup.");
  const token = newToken();
  await db.$transaction(async tx => {
    await tx.accountSetup.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.accountSetup.create({ data: { tokenHash: tokenHash(token), userId: user.id, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
  });
  console.log(`Set up or recover ${user.name}'s account within 24 hours:\n${process.env.WORLDFORGE_ORIGIN || "http://localhost:3033"}/setup#token=${token}`);
}
main().finally(() => db.$disconnect());
