"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createReadResolver,
  FileAccessError,
  type FileAccess,
  type ReadPurpose,
  type ReadUrl,
} from "@/lib/file-access";

type ReadContext = {
  read: (fileId: string, purpose: ReadPurpose, force?: boolean) => Promise<ReadUrl>;
  denied: ReadonlySet<string>;
};
const Context = createContext<ReadContext | null>(null);

export function FileAccessProvider({
  access,
  children,
}: {
  access?: FileAccess;
  children: ReactNode;
}) {
  const [denied, setDenied] = useState<ReadonlySet<string>>(new Set());
  const deniedRef = useRef(denied);
  const transferId = access?.transferId;
  const token = access?.token;
  const resolver = useMemo(
    () => (transferId && token ? createReadResolver({ transferId, token }) : null),
    [transferId, token],
  );
  const read = useCallback<ReadContext["read"]>(
    async (fileId, purpose, force = false) => {
      if (!resolver || deniedRef.current.has(fileId)) throw new FileAccessError(404);
      try {
        return await resolver.resolve(fileId, purpose, force);
      } catch (error) {
        if (error instanceof FileAccessError && error.denied) {
          resolver.clear(fileId);
          const next = new Set([...deniedRef.current, fileId]);
          deniedRef.current = next;
          setDenied(next);
        }
        throw error;
      }
    },
    [resolver],
  );
  const value = useMemo<ReadContext>(() => ({ denied, read }), [denied, read]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useFileAccess() {
  const context = useContext(Context);
  if (!context) throw new Error("FileAccessProvider is required");
  return context;
}
