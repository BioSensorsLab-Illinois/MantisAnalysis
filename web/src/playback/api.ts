// Typed wrappers around /api/playback/* — implemented in M2.
// M0 ships only the type shapes so the rest of the frontend can compile.

export interface RecordingDTO {
  rec_id: string;
  name: string;
  path: string;
  sample: number | null;
  view: number | null;
  exposure_s: number | null;
  n_frames: number;
  raw_shape: [number, number];
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
  | { type: 'workspace.tab.opened'; payload: { tab_id: string } }
  | { type: 'workspace.tab.closed'; payload: { tab_id: string } };

export async function fetchWorkspace(): Promise<WorkspaceDTO> {
  throw new Error('M2 will implement fetchWorkspace()');
}
