export const CONTEXT_REQUEST_EVENT = "meteo-context-request";

export type ContextProvision<T> = {
  getValue(): T;
  subscribe(listener: () => void): () => void;
};

type ContextRequestDetail = {
  key: string;
  callback: (provision: ContextProvision<unknown>) => void;
};

export function requestContext<T>(from: Element, key: string): ContextProvision<T> | null {
  let provision: ContextProvision<T> | null = null;
  from.dispatchEvent(
    new CustomEvent<ContextRequestDetail>(CONTEXT_REQUEST_EVENT, {
      bubbles: true,
      composed: false,
      detail: {
        key,
        callback: (answered) => {
          provision = answered as ContextProvision<T>;
        },
      },
    }),
  );
  return provision;
}

export function provideContext<T>(
  host: Element,
  key: string,
  provision: ContextProvision<T>,
): () => void {
  const handler = (event: Event) => {
    const request = event as CustomEvent<ContextRequestDetail>;
    if (request.detail?.key !== key || event.target === host) return;
    event.stopPropagation();
    request.detail.callback(provision as ContextProvision<unknown>);
  };
  host.addEventListener(CONTEXT_REQUEST_EVENT, handler);
  return () => host.removeEventListener(CONTEXT_REQUEST_EVENT, handler);
}
