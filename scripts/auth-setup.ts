import { PrismaClient } from "@prisma/client";
import { newToken, tokenHash } from "../src/lib/passwords";
const db = new PrismaClient();
async function main() {
  const args = process.argv.slice(2).filter(argument => argument !== "--");
  const create = args[0] === "--create";
  const email = (create ? args[1] : args[0])?.trim().toLowerCase();
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
    throw new Error("Pass a valid email address.");
  }
  if (create && (!email || args.length !== 2)) {
    throw new Error("To create an account, run auth:setup -- --create email@example.com.");
  }
  if (!create && args.length > 1) throw new Error("Pass one email address, or use --create to add a new account.");
  let user = create ? null : email ? await db.user.findUnique({ where: { email } }) : (await db.world.findFirst({ orderBy: { createdAt: "asc" }, select: { owner: true } }))?.owner;
  if (create) {
    if (await db.user.findUnique({ where: { email: email! } })) throw new Error(`An account already exists for ${email}. Run auth:setup -- ${email} to recover it.`);
    user = await db.user.create({ data: { name: email!.split("@")[0], email: email!, role: "AUTHOR" } });
  } else if (!user && await db.user.count() === 0) {
    user = await db.user.create({ data: { name: "Lorekeeper", email: email || "lorekeeper@worldforge.dev", role: "GM" } });
  }
  if (!user) throw new Error(email
    ? `No user found with email ${email}. Run auth:setup -- --create ${email} to add a new account.`
    : "No world owner found. Pass an existing user's email, or use --create to add a new account.");
  const token = newToken();
  await db.$transaction(async tx => {
    await tx.accountSetup.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.accountSetup.create({ data: { tokenHash: tokenHash(token), userId: user.id, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
  });
  console.log(`Set up or recover ${user.name}'s account within 24 hours:\n${process.env.WORLDFORGE_ORIGIN || "http://localhost:3033"}/setup#token=${token}`);
}
main().finally(() => db.$disconnect());
