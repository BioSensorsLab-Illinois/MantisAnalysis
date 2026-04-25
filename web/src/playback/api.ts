// Typed wrappers around /api/playback/*. M2 wires real fetch calls
// against the FastAPI surface in mantisanalysis/playback/api.py.

export interface RecordingDTO {
  rec_id: string;
  name: string;
  path: string;
  sample: number | null;
  view: number | null;
  exposure_s: number | null;
  n_frames: number;
  raw_shape: [number, number];
  timestamp_start_s: number | null;
  timestamp_end_s: number | null;
}

export interface DarkDTO {
  dark_id: string;
  name: string;
  exposure_s: number;
  n_source_frames: number;
  strategy: 'mean' | 'median' | 'sigma_clip';
}

export interface StreamDTO {
  stream_id: string;
  name: string;
  rec_ids: string[];
  fps_override: number | null;
  total_frames: number;
}

export interface ViewDTO {
  view_id: string;
  name: string;
  type: 'single' | 'rgb' | 'overlay';
  channel: string;
  channels: string[];
  locked_frame: number | null;
  sync_to_global: boolean;
  export_include: boolean;
  dark_on: boolean;
  dark_id: string | null;
  gain: number;
  offset: number;
  normalize: boolean;
  low: number;
  high: number;
  colormap: string;
  invert: boolean;
  show_clipped: boolean;
}

export interface TabDTO {
  tab_id: string;
  stream_id: string;
  layout: 'single' | 'side' | 'stack' | '2x2' | '3plus1';
  views: ViewDTO[];
  active_frame: number;
  selected_view_id: string | null;
}

export interface WorkspaceDTO {
  library: {
    recordings: RecordingDTO[];
    darks: DarkDTO[];
  };
  streams: StreamDTO[];
  tabs: TabDTO[];
  active_tab_id: string | null;
}

export type PlaybackEvent =
  | { type: 'library.recording.added'; payload: { rec_id: string } }
  | {
      type: 'library.recording.deleted';
      payload: {
        rec_id: string;
        deleted_streams: string[];
        shrunk_streams: string[];
        closed_tabs: string[];
      };
    }
  | { type: 'library.dark.added'; payload: { dark_id: string } }
  | { type: 'library.dark.deleted'; payload: { dark_id: string; cleared_views: string[] } }
  | { type: 'workspace.stream.built'; payload: { stream_id: string; rec_ids: string[] } }
  | { type: 'workspace.stream.deleted'; payload: { stream_id: string; closed_tabs: string[] } }
  | { type: 'workspace.tab.opened'; payload: { tab_id: string; stream_id: string } }
  | { type: 'workspace.tab.closed'; payload: { tab_id: string } };

const BASE = '/api/playback';

async function _json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let detail = '';
    try {
      detail = (await r.json())?.detail ?? '';
    } catch {
      detail = await r.text();
    }
    throw new Error(`${r.status} ${r.statusText}: ${detail}`);
  }
  return r.json() as Promise<T>;
}

export async function fetchWorkspace(): Promise<WorkspaceDTO> {
  return _json(await fetch(`${BASE}/workspace`));
}

export async function registerRecordingFromPath(
  path: string,
  name?: string
): Promise<RecordingDTO> {
  return _json(
    await fetch(`${BASE}/recordings/from-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name: name ?? null }),
    })
  );
}

export async function uploadRecording(file: File): Promise<RecordingDTO> {
  const fd = new FormData();
  fd.append('file', file);
  return _json(await fetch(`${BASE}/recordings/upload`, { method: 'POST', body: fd }));
}

export async function deleteRecording(rec_id: string): Promise<{
  deleted_streams: string[];
  shrunk_streams: string[];
  closed_tabs: string[];
}> {
  return _json(await fetch(`${BASE}/recordings/${rec_id}`, { method: 'DELETE' }));
}

export async function registerRecordingsFromFolder(
  root: string
): Promise<{ added: RecordingDTO[]; errors: Array<{ path: string; error: string }> }> {
  return _json(
    await fetch(`${BASE}/recordings/from-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    })
  );
}

export async function buildStream(rec_ids: string[], name?: string): Promise<StreamDTO> {
  return _json(
    await fetch(`${BASE}/streams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rec_ids, name: name ?? null }),
    })
  );
}

export async function deleteStream(stream_id: string): Promise<unknown> {
  return _json(await fetch(`${BASE}/streams/${stream_id}`, { method: 'DELETE' }));
}

export async function openTab(
  stream_id: string,
  layout: TabDTO['layout'] = 'single'
): Promise<TabDTO> {
  return _json(
    await fetch(`${BASE}/tabs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream_id, layout }),
    })
  );
}

export async function closeTab(tab_id: string): Promise<unknown> {
  return _json(await fetch(`${BASE}/tabs/${tab_id}`, { method: 'DELETE' }));
}

/**
 * Subscribe to the SSE event stream. Returns an unsubscribe function.
 */
export function subscribeEvents(onEvent: (e: PlaybackEvent) => void): () => void {
  const src = new EventSource(`${BASE}/events`);

  // Each event type comes through as its own named event from the
  // server (event: <type>\ndata: …). Listen on every type the
  // PlaybackEvent union enumerates.
  const types = [
    'library.recording.added',
    'library.recording.deleted',
    'library.dark.added',
    'library.dark.deleted',
    'workspace.stream.built',
    'workspace.stream.deleted',
    'workspace.tab.opened',
    'workspace.tab.closed',
  ];
  const handlers: Array<[string, (m: MessageEvent) => void]> = types.map((t) => {
    const h = (m: MessageEvent) => {
      try {
        const parsed = JSON.parse(m.data);
        onEvent(parsed as PlaybackEvent);
      } catch {
        // ignore malformed payloads
      }
    };
    src.addEventListener(t, h as EventListener);
    return [t, h];
  });

  return () => {
    for (const [t, h] of handlers) src.removeEventListener(t, h as EventListener);
    src.close();
  };
}
