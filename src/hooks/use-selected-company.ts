import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "ajustae:selected-company";

let current: string | undefined =
  typeof window !== "undefined"
    ? (window.localStorage.getItem(STORAGE_KEY) ?? undefined)
    : undefined;

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return current;
}

function getServerSnapshot() {
  return undefined;
}

export function setSelectedCompanyId(id: string | undefined) {
  if (current === id) return;
  current = id;
  if (typeof window !== "undefined") {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  }
  listeners.forEach((l) => l());
}

/**
 * Empresa selecionada compartilhada por todas as páginas (persiste em localStorage),
 * para que trocar de página não troque a empresa.
 */
export function useSelectedCompany(): [
  string | undefined,
  (id: string | undefined) => void,
] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const set = useCallback((id: string | undefined) => setSelectedCompanyId(id), []);
  return [value, set];
}
