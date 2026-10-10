export type ReservationResult =
  | { accepted: true; id: string }
  | { accepted: false; reason: "capacity_exceeded" | "root_already_active" };


export class SessionManager {
  private readonly sessions = new Map<string, string>();
  private nextId = 1;


  public constructor(private readonly capacity: number) {
    if (capacity < 1) {
      throw new Error("Session capacity must be at least one.");
    }
  }


  public reserve(root: string): ReservationResult {
    if ([...this.sessions.values()].includes(root)) {
      return { accepted: false, reason: "root_already_active" };
    }
    if (this.sessions.size >= this.capacity) {
      return { accepted: false, reason: "capacity_exceeded" };
    }

    const id = `terminal-${this.nextId++}`;
    this.sessions.set(id, root);
    return { accepted: true, id };
  }


  public release(id: string): void {
    this.sessions.delete(id);
  }


  public list(): Array<{ id: string; root: string }> {
    return [...this.sessions.entries()].map(([id, root]) => ({ id, root }));
  }
}
