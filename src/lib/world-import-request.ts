import { AccountEligibilityError, AccountLifecycleConflictError } from "@/lib/account-lifecycle";

export async function createDurableImportRequest<T>(create: () => Promise<T>, find: () => Promise<T | null>): Promise<T | null> {
  try { return await create(); }
  catch (error) {
    if (error instanceof AccountEligibilityError || error instanceof AccountLifecycleConflictError) throw error;
    return find();
  }
}
