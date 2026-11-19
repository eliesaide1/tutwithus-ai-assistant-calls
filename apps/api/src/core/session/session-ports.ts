// A server event from the Realtime API. Only `type` is relied on up front;
// handlers read the other fields defensively because the payload is external.
export type RealtimeServerEvent = { type: string } & Record<string, unknown>;

// The server-side control connection attached to one call ("sideband").
export interface RealtimeSideband {
  send(event: Record<string, unknown>): void;
  close(): void;
}

export type SidebandCloseInfo = {
  closeCode?: number;
  reasonLength?: number;
  errorName?: string;
};

export type SidebandHandlers = {
  onEvent: (event: RealtimeServerEvent) => void;
  // Called once if the connection closes or fails after it opened.
  onClosed: (details?: SidebandCloseInfo) => void;
};

// Result of verifying the caller's account through the active call channel.
export type AccountCheckOutcome = 'verified' | 'not_registered' | 'unavailable';
