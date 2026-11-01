import { getHistoryCompensation, getWorldHistoryIndex, WORLD_HISTORY_INDEX_KEY } from "@/lib/world-selection";

type HistoryState = Record<string, unknown>;

export type WorkspacePopResult =
  | { kind: "suppressed" | "untracked" | "mounted" }
  | { kind: "cancelled"; compensation: number }
  | { kind: "accepted"; destination: string | null };

/** Owns the workspace's index markers while leaving URL navigation to Next. */
export class WorkspaceHistoryCoordinator {
  private index = 0;
  private pushPending = false;
  private acceptedDestination: string | null | undefined;
  private returnIndex: number | null = null;
  private suppressNextPop = false;
  private cancelledDestination: string | null | undefined;

  /** Decorate initial/replaced state without removing Next's private fields. */
  initialize(state: unknown): HistoryState | null {
    const existing = getWorldHistoryIndex(state);
    if (existing !== null) {
      this.index = existing;
      return null;
    }
    this.index = 0;
    return { ...this.asRecord(state), [WORLD_HISTORY_INDEX_KEY]: this.index };
  }

  markPush(): void { this.pushPending = true; }

  /** Called after Next reflects a router.push in searchParams. */
  commitPendingPush(state: unknown): HistoryState | null {
    if (!this.pushPending) return null;
    this.pushPending = false;
    this.index += 1;
    return { ...this.asRecord(state), [WORLD_HISTORY_INDEX_KEY]: this.index };
  }

  onPop(
    state: unknown,
    destination: string | null,
    mountedWorldId: string | null,
    confirmLeave: () => boolean,
  ): WorkspacePopResult {
    if (this.suppressNextPop) {
      this.suppressNextPop = false;
      return { kind: "suppressed" };
    }
    const nextIndex = getWorldHistoryIndex(state);
    if (nextIndex === null) return { kind: "untracked" };

    const previousIndex = this.index;
    this.index = nextIndex;
    const destinationIsMounted = destination === mountedWorldId;
    if (previousIndex !== nextIndex && mountedWorldId && !destinationIsMounted && !confirmLeave()) {
      this.index = previousIndex;
      this.cancelledDestination = destination;
      this.suppressNextPop = true;
      return { kind: "cancelled", compensation: getHistoryCompensation(previousIndex, nextIndex) };
    }
    if (destinationIsMounted) {
      this.acceptedDestination = undefined;
      this.returnIndex = null;
      return { kind: "mounted" };
    }
    if (previousIndex !== nextIndex) {
      this.acceptedDestination = destination;
      this.returnIndex ??= previousIndex;
      return { kind: "accepted", destination };
    }
    return { kind: "untracked" };
  }

  /** Skip a stale URL update from a pop that was immediately compensated. */
  shouldSkipCancelledDestination(urlWorldId: string | null): boolean {
    if (this.cancelledDestination === undefined) return false;
    if (this.cancelledDestination === urlWorldId) return true;
    this.cancelledDestination = undefined;
    return false;
  }

  acceptedDestinationIs(destination: string | null): boolean {
    return this.acceptedDestination !== undefined && this.acceptedDestination === destination;
  }

  clearAcceptedDestination(): void { this.acceptedDestination = undefined; }
  get returnToIndex(): number | null { return this.returnIndex; }
  get returnOffset(): number | null { return this.returnIndex === null ? null : this.returnIndex - this.index; }
  clearReturnIndex(): void { this.returnIndex = null; }

  private asRecord(state: unknown): HistoryState {
    return state !== null && typeof state === "object" && !Array.isArray(state)
      ? state as HistoryState
      : {};
  }
}
