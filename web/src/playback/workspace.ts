// useWorkspace() — single source of truth for the Playback UI.
// M2: 2-second polling of /api/playback/workspace. Cheap (~1 KB
// per poll) + correct (no diff bugs). SSE was prototyped but
// caused connection-pool starvation under StrictMode + uvicorn
// single-process; revisit in a later milestone if needed.

import React from 'react';

import { WorkspaceDTO, fetchWorkspace } from './api';

const { useEffect, useState, useCallback, useRef } = React;

const POLL_MS = 2000;

export interface WorkspaceState {
  workspace: WorkspaceDTO | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useWorkspace(): WorkspaceState {
  const [workspace, setWorkspace] = useState<WorkspaceDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const w = await fetchWorkspace();
      if (!aliveRef.current) return;
      setWorkspace(w);
      setError(null);
    } catch (e) {
      if (!aliveRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => {
      aliveRef.current = false;
      window.clearInterval(id);
    };
  }, [refresh]);

  return { workspace, loading, error, refresh };
}
