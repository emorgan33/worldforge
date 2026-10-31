import { PrismaClient } from "@prisma/client";
import { createAccount, issueRecovery } from "../src/lib/admin-accounts";
import { normalizeEmail } from "../src/lib/admin-policy";

const db = new PrismaClient();
const LOCAL_OPERATOR = { type: "LOCAL_OPERATOR" as const };

async function printSetupUrl(email: string, token: string) {
  const origin = process.env.WORLDFORGE_ORIGIN || "http://localhost:3033";
  console.log(`Set up or recover ${email}'s account within 24 hours:\n${origin}/setup#token=${token}`);
}

async function main() {
  const args = process.argv.slice(2).filter(argument => argument !== "--");
  const create = args[0] === "--create";
  const emailArg = (create ? args[1] : args[0])?.trim().toLowerCase();
  if (emailArg && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailArg) || emailArg.length > 254)) {
    throw new Error("Pass a valid email address.");
  }
  if (create && (!emailArg || args.length !== 2)) {
    throw new Error("To create an account, run auth:setup -- --create email@example.com.");
  }
  if (!create && args.length > 1) throw new Error("Pass one email address, or use --create to add a new account.");

  if (create) {
    const result = await createAccount(db, LOCAL_OPERATOR, {
      email: emailArg,
      name: emailArg!.split("@")[0],
      role: "AUTHOR",
    });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.error}`);
    await printSetupUrl(emailArg!, result.value.token);
    return;
  }

  const normalizedEmail = emailArg ? normalizeEmail(emailArg) : null;
  const user = normalizedEmail ? await db.user.findUnique({ where: { email: normalizedEmail } }) : (await db.world.findFirst({ orderBy: { createdAt: "asc" }, select: { owner: true } }))?.owner;
  if (!user && normalizedEmail && (await db.user.count()) === 0) {
    const result = await createAccount(db, LOCAL_OPERATOR, {
      email: normalizedEmail,
      name: normalizedEmail.split("@")[0],
      role: "AUTHOR",
    });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.error}`);
    await printSetupUrl(normalizedEmail, result.value.token);
    return;
  }
  if (!user) throw new Error(emailArg
    ? `No user found with email ${emailArg}. Run auth:setup -- --create ${emailArg} to add a new account.`
    : "No world owner found. Pass an existing user's email, or use --create to add a new account.");
  if (user.disabledAt !== null) {
    throw new Error("This account is disabled. Use the local recovery command before issuing a setup link.");
  }

  const result = await issueRecovery(db, LOCAL_OPERATOR, { userId: user.id });
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.error}`);
  await printSetupUrl(user.email, result.value.token);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
