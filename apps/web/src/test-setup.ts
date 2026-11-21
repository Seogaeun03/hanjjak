// happy-dom sends real requests to its default origin, http://localhost:3000. Screens rendered
// without a mock would reach for the API and the chat socket there, and each refused connection
// printed a stack trace into the test log. Unmocked traffic now fails the way a browser reports
// an unreachable server, without leaving the process. Tests that stub fetch or WebSocket still
// replace these, and vi.unstubAllGlobals() restores them rather than the network versions.

globalThis.fetch = async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  throw new TypeError(`Failed to fetch: ${url} is not mocked in this test`);
};

class UnreachableWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly url: string;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  send() {}

  close() {
    this.readyState = 3;
  }
}

globalThis.WebSocket = UnreachableWebSocket as unknown as typeof WebSocket;
